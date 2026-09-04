const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Chống crash Server do lỗi không mong muốn
process.on('uncaughtException', (err) => console.error('[SERVER CRASH PREVENTED]', err));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));

const APP_ID = process.env.AGORA_APP_ID || "f8b9cc77ff234823b6e4685127ebf475";
const APP_CERTIFICATE = process.env.APP_CERTIFICATE || "74fafa51c6714624bd251133041297d6";

app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) return res.status(400).json({ error: 'channelName is required' });

  const uid = 0; 
  const role = RtcRole.PUBLISHER;
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpiredTs);
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: "Failed to generate token" });
  }
});

const rooms = {};

// Hàm làm sạch dữ liệu phòng gửi về Client (Tránh lỗi Socket Serialization & giấu Role)
function sanitizeRoomForPlayer(room, recipientUserId) {
  const cleanPlayers = {};
  const recipientPlayer = room.players[recipientUserId];

  Object.values(room.players).forEach(p => {
    const isSelf = p.userId === recipientUserId;
    const isBothWolves = recipientPlayer && recipientPlayer.role === 'WOLF' && p.role === 'WOLF';
    const isGameOver = room.phase === 'END';

    cleanPlayers[p.userId] = {
      ...p,
      // Chỉ tiết lộ Role nếu là chính mình, cùng phe Sói, hoặc game đã kết thúc
      role: (isSelf || isBothWolves || isGameOver) ? p.role : null
    };
  });

  // Tạo bản sao room loại bỏ thuộc tính Timer (tránh lỗi JSON khi gửi socket)
  const { phaseTimer, disconnectTimeouts, ...cleanRoom } = room;
  cleanRoom.players = cleanPlayers;

  return cleanRoom;
}

// Hàm gửi dữ liệu phòng được lọc riêng cho từng Socket
function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  if (!socketsInRoom) return;

  socketsInRoom.forEach(socketId => {
    const clientSocket = io.sockets.sockets.get(socketId);
    if (clientSocket && clientSocket.userId) {
      const sanitizedData = sanitizeRoomForPlayer(room, clientSocket.userId);
      clientSocket.emit('room_state_update', sanitizedData);
    }
  });
}

// Cập nhật quyền Mic & Cam (Chỉ người sống / Sói đêm mới bật được)
function updateMediaPermissions(room) {
  const isNight = room.phase === 'NIGHT';

  Object.values(room.players).forEach(player => {
    if (room.phase === 'LOBBY' || room.phase === 'END') {
      player.canSpeak = true;
      player.canCam = true;
    } else if (isNight) {
      const isWolf = (player.role === 'WOLF');
      player.canSpeak = (isWolf && player.isAlive);
      player.canCam = (isWolf && player.isAlive);
    } else {
      player.canSpeak = player.isAlive;
      player.canCam = player.isAlive;
    }
  });
}

// Kiểm tra điều kiện thắng/thua chính xác
function checkWinCondition(room) {
  const players = Object.values(room.players);
  const alivePlayers = players.filter(p => p.isAlive);
  
  const aliveWolves = alivePlayers.filter(p => p.role === 'WOLF');
  const aliveVillagers = alivePlayers.filter(p => p.role !== 'WOLF');

  if (aliveWolves.length === 0) return 'VILLAGER_WIN';
  if (aliveWolves.length >= aliveVillagers.length) return 'WOLF_WIN';
  return null;
}

function clearRoomTimer(room) {
  if (room.phaseTimer) {
    clearInterval(room.phaseTimer);
    room.phaseTimer = null;
  }
}

function startPhaseTimer(roomId, durationSeconds, nextPhaseCallback) {
  const room = rooms[roomId];
  if (!room) return;

  clearRoomTimer(room);
  room.timeLeft = durationSeconds;

  room.phaseTimer = setInterval(() => {
    if (!rooms[roomId]) {
      clearRoomTimer(room);
      return;
    }

    room.timeLeft--;
    io.to(roomId).emit('timer_update', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearRoomTimer(room);
      nextPhaseCallback(roomId);
    }
  }, 1000);
}

// Xử lý Hết giờ Ban ngày (Treo cổ)
function handleDayTimeout(roomId) {
  const room = rooms[roomId];
  if (!room || room.phase !== 'DAY') return;

  const votes = room.votes || {};
  const voteCounts = {};

  Object.values(votes).forEach(targetSeat => {
    voteCounts[targetSeat] = (voteCounts[targetSeat] || 0) + 1;
  });

  let maxVotes = 0;
  let targetSeatToExecute = null;
  let isTie = false;

  for (const [seat, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      targetSeatToExecute = parseInt(seat);
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }

  if (targetSeatToExecute !== null && !isTie && maxVotes > 0) {
    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeatToExecute);
    if (targetPlayer) {
      targetPlayer.isAlive = false;
      
      io.to(roomId).emit('player_killed_fx', { 
        victimSeat: targetSeatToExecute, 
        cause: 'VOTE' 
      });

      io.to(roomId).emit('notification', { message: `⚖️ Làng đã quyết định treo cổ ghế #${targetSeatToExecute} (${targetPlayer.name})!` });
    }
  } else {
    io.to(roomId).emit('notification', { message: '⚖️ Không có ai bị treo cổ hôm nay (Hòa phiếu hoặc trống).' });
  }

  const winner = checkWinCondition(room);
  if (winner) {
    room.phase = 'END';
    room.winner = winner;
    clearRoomTimer(room);
  } else {
    room.phase = 'NIGHT';
    room.votes = {};
    room.wolfTarget = null;
    room.guardTarget = null;
    room.witchHealTarget = null;
    room.witchPoisonTarget = null;
    Object.values(room.players).forEach(p => { p.statusEffect = null; });
    
    const nightTime = room.settings.nightDuration || 60;
    startPhaseTimer(roomId, nightTime, handleNightTimeout);
  }

  updateMediaPermissions(room);
  broadcastRoomState(roomId);
  io.to(roomId).emit('media_permission_update', room.players);
}

// Xử lý Hết giờ Ban đêm
function handleNightTimeout(roomId) {
  const room = rooms[roomId];
  if (!room || room.phase !== 'NIGHT') return;

  let deadSeatsThisNight = [];
  let bittenSeat = room.wolfTarget;
  let guardedSeat = room.guardTarget;
  let healedSeat = room.witchHealTarget;
  let poisonedSeat = room.witchPoisonTarget;

  // Xử lý tính toán bảo vệ/cứu/cắn
  if (bittenSeat && bittenSeat !== guardedSeat && bittenSeat !== healedSeat) {
    deadSeatsThisNight.push(bittenSeat);
  }

  if (poisonedSeat && !deadSeatsThisNight.includes(poisonedSeat)) {
    deadSeatsThisNight.push(poisonedSeat);
  }

  Object.values(room.players).forEach(p => {
    if (deadSeatsThisNight.includes(parseInt(p.seat))) {
      p.isAlive = false;
      io.to(roomId).emit('player_killed_fx', { 
        victimSeat: p.seat, 
        cause: p.seat === poisonedSeat ? 'WITCH' : 'WOLF' 
      });
    }
  });

  room.lastGuardedSeat = room.guardTarget;

  if (deadSeatsThisNight.length === 0) {
    io.to(roomId).emit('notification', { message: '🌙 Đêm qua là một đêm an toàn, không có ai thiệt mạng!' });
  } else {
    io.to(roomId).emit('notification', { message: `☠️ Các ghế thiệt mạng trong đêm: ${deadSeatsThisNight.join(', ')}` });
  }

  const winner = checkWinCondition(room);
  if (winner) {
    room.phase = 'END';
    room.winner = winner;
    clearRoomTimer(room);
    broadcastRoomState(roomId);
    io.to(roomId).emit('media_permission_update', room.players);
    return;
  }

  room.phase = 'DAY';
  const dayTime = room.settings.dayDuration || 120;
  startPhaseTimer(roomId, dayTime, handleDayTimeout);

  updateMediaPermissions(room);
  broadcastRoomState(roomId);
  io.to(roomId).emit('media_permission_update', room.players);
}

io.on('connection', (socket) => {
  // Anti-spam middleware
  socket.use(([event, ...args], next) => {
    const now = Date.now();
    if (!socket.lastActionTime) socket.lastActionTime = {};
    if (socket.lastActionTime[event] && now - socket.lastActionTime[event] < 300) {
      return; 
    }
    socket.lastActionTime[event] = now;
    next();
  });

  // 1. Tham gia phòng chơi
  socket.on('join_room', ({ roomId, userId, name, seat, isHost }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId || socket.id;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        phase: 'LOBBY',
        winner: null,
        players: {},
        wolfMessages: [],
        ghostMessages: [], 
        votes: {}, 
        wolfTarget: null,
        guardTarget: null,
        lastGuardedSeat: null,
        witchHealTarget: null,
        witchPoisonTarget: null,
        timeLeft: 0,
        phaseTimer: null,
        disconnectTimeouts: {},
        settings: {
          wolfCount: 2, guardCount: 1, seerCount: 1, witchCount: 1,
          infectedCount: 0, villagerCount: 2, nightDuration: 60, dayDuration: 120
        }
      };
    }

    const room = rooms[roomId];

    if (room.disconnectTimeouts && room.disconnectTimeouts[socket.userId]) {
      clearTimeout(room.disconnectTimeouts[socket.userId]);
      delete room.disconnectTimeouts[socket.userId];
    }

    const existingHost = Object.values(room.players).find(p => p.isHost);
    let finalIsHost = !!isHost;
    if (!existingHost && Object.keys(room.players).length === 0) {
      finalIsHost = true;
    } else if (existingHost && existingHost.userId === socket.userId) {
      finalIsHost = true;
    }

    const pKey = socket.userId;
    const oldData = room.players[pKey] || {};

    room.players[pKey] = {
      id: socket.id,
      userId: pKey,
      name: name || oldData.name || 'Người chơi',
      seat: seat !== undefined ? seat : oldData.seat,
      isHost: finalIsHost,
      role: oldData.role || null,
      statusEffect: oldData.statusEffect || null, 
      isAlive: oldData.isAlive !== undefined ? oldData.isAlive : true,
      hasUsedHeal: oldData.hasUsedHeal || false,   
      hasUsedPoison: oldData.hasUsedPoison || false,
      canSpeak: true,
      canCam: true,
      isDisconnected: false
    };

    updateMediaPermissions(room);
    broadcastRoomState(roomId);
    io.to(roomId).emit('media_permission_update', room.players);
  });

  // 2. Reconnect khôi phục trạng thái
  socket.on('reconnect_player', ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (room && room.players[userId]) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userId = userId;

      room.players[userId].id = socket.id;
      room.players[userId].isDisconnected = false;

      if (room.disconnectTimeouts && room.disconnectTimeouts[userId]) {
        clearTimeout(room.disconnectTimeouts[userId]);
        delete room.disconnectTimeouts[userId];
      }

      socket.emit('sync_game_state', sanitizeRoomForPlayer(room, userId));
      broadcastRoomState(roomId);
    }
  });

  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      broadcastRoomState(roomId);
    }
  });

  // 3. Bắt đầu Game
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.userId]?.isHost) return;

    const playerKeys = Object.keys(room.players);
    const totalPlayers = playerKeys.length;

    if (totalPlayers < 1) {
      return socket.emit('notification', { message: 'Cần tối thiểu 1 người chơi để bắt đầu!' });
    }

    const { wolfCount = 2, guardCount = 1, seerCount = 1, witchCount = 1, infectedCount = 0 } = room.settings;

    let rolesPool = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('WOLF');
    for (let i = 0; i < guardCount; i++) rolesPool.push('GUARD');
    for (let i = 0; i < seerCount; i++) rolesPool.push('SEER');
    for (let i = 0; i < witchCount; i++) rolesPool.push('WITCH');
    for (let i = 0; i < infectedCount; i++) rolesPool.push('INFECTED');

    if (rolesPool.length > totalPlayers) {
      rolesPool = rolesPool.slice(0, totalPlayers);
    } 
    while (rolesPool.length < totalPlayers) {
      rolesPool.push('VILLAGER');
    }

    rolesPool.sort(() => Math.random() - 0.5);

    playerKeys.forEach((pKey, index) => {
      room.players[pKey].role = rolesPool[index];
      room.players[pKey].statusEffect = null;
      room.players[pKey].isAlive = true;
      room.players[pKey].hasUsedHeal = false;
      room.players[pKey].hasUsedPoison = false;
    });

    room.phase = 'NIGHT';
    room.winner = null;
    room.wolfMessages = [];
    room.ghostMessages = []; 
    room.votes = {}; 
    room.wolfTarget = null;
    room.guardTarget = null;
    room.lastGuardedSeat = null;
    room.witchHealTarget = null;
    room.witchPoisonTarget = null;

    updateMediaPermissions(room);
    broadcastRoomState(roomId);
    io.to(roomId).emit('media_permission_update', room.players);
    
    const nightTime = room.settings.nightDuration || 60;
    startPhaseTimer(roomId, nightTime, handleNightTimeout);
  });

  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      clearRoomTimer(room);

      if (room.phase === 'NIGHT' && phase === 'DAY') {
        handleNightTimeout(roomId);
        return;
      }

      room.phase = phase;
      if (phase === 'NIGHT') {
        room.votes = {};
        room.wolfTarget = null;
        room.guardTarget = null;
        room.witchHealTarget = null;
        room.witchPoisonTarget = null;
        Object.values(room.players).forEach(p => { p.statusEffect = null; });
        startPhaseTimer(roomId, room.settings.nightDuration || 60, handleNightTimeout);
      } else if (phase === 'DAY') {
        startPhaseTimer(roomId, room.settings.dayDuration || 120, handleDayTimeout);
      }

      updateMediaPermissions(room);
      broadcastRoomState(roomId);
      io.to(roomId).emit('media_permission_update', room.players);
    }
  });

  const handleVoteAction = (roomId, targetSeat) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'DAY') return;

    const voter = room.players[socket.userId];
    if (!voter || !voter.isAlive) return;

    if (!room.votes) room.votes = {};
    room.votes[voter.seat] = targetSeat;

    broadcastRoomState(roomId);
  };

  socket.on('cast_vote', ({ roomId, targetSeat }) => handleVoteAction(roomId, targetSeat));
  socket.on('vote_player', ({ roomId, targetSeat }) => handleVoteAction(roomId, targetSeat));

  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.votes = {};
      broadcastRoomState(roomId);
    }
  });

  // 4. Kỹ năng ban đêm & Bảo mật gửi tin nhắn Sói
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'NIGHT') return;

    const player = room.players[socket.userId];
    if (!player || !player.isAlive) return;

    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
    if (!targetPlayer && actionType !== 'WITCH_SAVE') return;

    if (actionType === 'GUARD' && player.role === 'GUARD') {
      if (room.lastGuardedSeat === targetSeat) {
        return socket.emit('notification', { message: '🚫 Không thể bảo vệ cùng 1 người 2 đêm liên tiếp!' });
      }
      room.guardTarget = targetSeat;
      targetPlayer.statusEffect = 'GUARDED';
    } 
    else if (actionType === 'WOLF' && player.role === 'WOLF') {
      room.wolfTarget = targetSeat;
      
      const wolfMsg = {
        sender: 'Hệ thống',
        text: `🐺 Sói ${player.name} chọn cắn ghế #${targetSeat}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      room.wolfMessages.push(wolfMsg);

      Object.values(room.players).forEach(p => {
        if (p.role === 'WOLF' && p.isAlive) {
          io.to(p.id).emit('wolf_chat_update', room.wolfMessages);
        }
      });

      const witchPlayer = Object.values(room.players).find(p => p.role === 'WITCH' && p.isAlive);
      if (witchPlayer && room.players[witchPlayer.userId]) {
        io.to(room.players[witchPlayer.userId].id).emit('witch_target_info', { targetSeat: targetSeat });
      }
    } 
    else if (actionType === 'WITCH_SAVE' && player.role === 'WITCH') {
      if (player.hasUsedHeal) return socket.emit('notification', { message: 'Đã dùng Bình Cứu rồi!' });
      if (!room.wolfTarget) return socket.emit('notification', { message: 'Sói chưa chọn cắn ai!' });
      
      player.hasUsedHeal = true;
      room.witchHealTarget = room.wolfTarget;
      const savedPlayer = Object.values(room.players).find(p => p.seat === room.wolfTarget);
      if (savedPlayer) savedPlayer.statusEffect = 'WITCH_SAVED';
    } 
    else if (actionType === 'WITCH_POISON' && player.role === 'WITCH') {
      if (player.hasUsedPoison) return socket.emit('notification', { message: 'Đã dùng Bình Độc rồi!' });
      player.hasUsedPoison = true;
      room.witchPoisonTarget = targetSeat;
      targetPlayer.statusEffect = 'WITCH_POISONED';
    } 
    else if (actionType === 'SEER_CHECK' && player.role === 'SEER') {
      socket.emit('seer_result', {
        seat: targetSeat,
        name: targetPlayer.name,
        isWolf: targetPlayer.role === 'WOLF'
      });
    }

    broadcastRoomState(roomId);
  });

  // 5. Chat riêng Sói & Chat Hồn Ma
  socket.on('send_wolf_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.userId];

    if (player && player.role === 'WOLF' && player.isAlive) {
      const msgObj = {
        sender: player.name,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      room.wolfMessages.push(msgObj);

      Object.values(room.players).forEach(p => {
        if (p.role === 'WOLF' && p.isAlive) {
          io.to(p.id).emit('wolf_chat_update', room.wolfMessages);
        }
      });
    }
  });

  socket.on('send_ghost_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.userId];

    if (player && !player.isAlive) {
      const msgObj = {
        sender: player.name,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      room.ghostMessages.push(msgObj);

      Object.values(room.players).forEach(p => {
        if (!p.isAlive) {
          io.to(p.id).emit('ghost_chat_update', room.ghostMessages);
        }
      });
    }
  });

  // 6. Xử lý ngắt kết nối & Chuyển quyền Host
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const userId = socket.userId;

    if (roomId && rooms[roomId] && userId && rooms[roomId].players[userId]) {
      const room = rooms[roomId];
      const player = room.players[userId];
      player.isDisconnected = true;

      if (!room.disconnectTimeouts) room.disconnectTimeouts = {};
      
      room.disconnectTimeouts[userId] = setTimeout(() => {
        if (room.players[userId] && room.players[userId].isDisconnected) {
          const wasHost = room.players[userId].isHost;
          delete room.players[userId];
          
          if (room.votes && room.votes[player.seat]) {
            delete room.votes[player.seat];
          }

          if (Object.keys(room.players).length === 0) {
            clearRoomTimer(room);
            delete rooms[roomId];
          } else {
            if (wasHost) {
              const remainingPlayers = Object.values(room.players);
              if (remainingPlayers.length > 0) {
                remainingPlayers[0].isHost = true;
                io.to(roomId).emit('notification', { message: `👑 ${remainingPlayers[0].name} đã trở thành Chủ Phòng mới.` });
              }
            }

            broadcastRoomState(roomId);
            io.to(roomId).emit('media_permission_update', room.players);
          }
        }
        if (room.disconnectTimeouts) delete room.disconnectTimeouts[userId];
      }, 45000);

      broadcastRoomState(roomId);
      io.to(roomId).emit('media_permission_update', room.players);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói running on port ${PORT}`);
});