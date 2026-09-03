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

// Cập nhật quyền Mic & Cam
function updateMediaPermissions(room) {
  const isNight = room.phase === 'NIGHT';

  Object.values(room.players).forEach(player => {
    if (isNight) {
      const isWolf = (player.role === 'WOLF');
      player.canSpeak = (isWolf && player.isAlive);
      player.canCam = (isWolf && player.isAlive);
    } else {
      player.canSpeak = player.isAlive;
      player.canCam = player.isAlive;
    }
  });
}

// Kiểm tra điều kiện thắng/thua
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

// Xử lý Hết giờ Ban ngày (Vote)
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
      
      // Báo hiệu ứng Anime SLASH cho người bị treo cổ
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
  io.to(roomId).emit('room_state_update', room);
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

  if (bittenSeat && bittenSeat !== guardedSeat && bittenSeat !== healedSeat) {
    deadSeatsThisNight.push(bittenSeat);
  }

  if (poisonedSeat && !deadSeatsThisNight.includes(poisonedSeat)) {
    deadSeatsThisNight.push(poisonedSeat);
  }

  Object.values(room.players).forEach(p => {
    if (deadSeatsThisNight.includes(parseInt(p.seat))) {
      p.isAlive = false;
      // Gửi hiệu ứng chém Anime cho người bị giết trong đêm
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
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('media_permission_update', room.players);
    return;
  }

  room.phase = 'DAY';
  const dayTime = room.settings.dayDuration || 120;
  startPhaseTimer(roomId, dayTime, handleDayTimeout);

  updateMediaPermissions(room);
  io.to(roomId).emit('room_state_update', room);
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

  // 1. Tham gia phòng chơi (Dùng userId cố định)
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

    // Xóa timeout ngắt kết nối nếu vào lại đúng lúc
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

    // Lưu hoặc khôi phục thông tin player theo userId
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
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('media_permission_update', room.players);
  });

  // 2. Tự động Reconnect khôi phục ván chơi
  socket.on('reconnect_player', ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (room && room.players[userId]) {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userId = userId;

      room.players[userId].id = socket.id; // Cập nhật Socket ID mới
      room.players[userId].isDisconnected = false;

      if (room.disconnectTimeouts && room.disconnectTimeouts[userId]) {
        clearTimeout(room.disconnectTimeouts[userId]);
        delete room.disconnectTimeouts[userId];
      }

      socket.emit('sync_game_state', room); // Đồng bộ riêng cho người vừa reconnect
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.userId]?.isHost) return;

    const playerKeys = Object.keys(room.players);
    const totalPlayers = playerKeys.length;
    
    const { wolfCount=2, guardCount=1, seerCount=1, witchCount=1, infectedCount=0, villagerCount=2 } = room.settings;

    let rolesPool = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('WOLF');
    for (let i = 0; i < guardCount; i++) rolesPool.push('GUARD');
    for (let i = 0; i < seerCount; i++) rolesPool.push('SEER');
    for (let i = 0; i < witchCount; i++) rolesPool.push('WITCH');
    for (let i = 0; i < infectedCount; i++) rolesPool.push('INFECTED');
    for (let i = 0; i < villagerCount; i++) rolesPool.push('VILLAGER');

    if (rolesPool.length > totalPlayers) rolesPool = rolesPool.slice(0, totalPlayers);
    while (rolesPool.length < totalPlayers) rolesPool.push('VILLAGER');

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
    io.to(roomId).emit('room_state_update', room);
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
      io.to(roomId).emit('room_state_update', room);
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

    io.to(roomId).emit('room_state_update', room);
  };

  socket.on('cast_vote', ({ roomId, targetSeat }) => handleVoteAction(roomId, targetSeat));
  socket.on('vote_player', ({ roomId, targetSeat }) => handleVoteAction(roomId, targetSeat));

  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.votes = {};
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'NIGHT') return;

    const player = room.players[socket.userId];
    if (!player || !player.isAlive) return;

    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
    if (!targetPlayer) return;

    if (actionType === 'GUARD' && player.role === 'GUARD') {
      if (room.lastGuardedSeat === targetSeat) {
        return socket.emit('notification', { message: '🚫 Không thể bảo vệ cùng 1 người 2 đêm liên tiếp!' });
      }
      room.guardTarget = targetSeat;
      targetPlayer.statusEffect = 'GUARDED';
    } 
    else if (actionType === 'WOLF' && player.role === 'WOLF') {
      room.wolfTarget = targetSeat;
      targetPlayer.statusEffect = 'WOLF_TARGET';
      room.wolfMessages.push({
        sender: 'Hệ thống',
        text: `🐺 Sói ${player.name} chọn cắn ghế #${targetSeat}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

    io.to(roomId).emit('room_state_update', room);
  });

  // 3. Xử lý ngắt kết nối an toàn (Cho phép 45 giây để vào lại)
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
          delete room.players[userId];
          
          if (room.votes && room.votes[player.seat]) {
            delete room.votes[player.seat];
          }

          if (Object.keys(room.players).length === 0) {
            clearRoomTimer(room);
            delete rooms[roomId];
          } else {
            io.to(roomId).emit('room_state_update', room);
            io.to(roomId).emit('media_permission_update', room.players);
          }
        }
        if (room.disconnectTimeouts) delete room.disconnectTimeouts[userId];
      }, 45000); // 45 giây giữ chỗ

      io.to(roomId).emit('room_state_update', room);
      io.to(roomId).emit('media_permission_update', room.players);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói running on port ${PORT}`);
});