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
  }
});

const APP_ID = "f8b9cc77ff234823b6e4685127ebf475";
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

// Hàm cập nhật quyền Mic (canSpeak) và Cam (canCam) theo chuẩn người chơi công bằng
function updateMediaPermissions(room) {
  const isNight = room.phase === 'NIGHT';

  Object.values(room.players).forEach(player => {
    if (isNight) {
      // Ban đêm: Chỉ Sói còn sống mới được mở mic. Tất cả tắt cam.
      player.canSpeak = (player.role === 'WOLF' && player.isAlive);
      player.canCam = false;
    } else {
      // Ban ngày / Lobby: Người còn sống được phép bật mic và cam
      player.canSpeak = player.isAlive;
      player.canCam = player.isAlive;
    }
  });
}

// Hàm kiểm tra điều kiện thắng thua của game
function checkWinCondition(room) {
  const players = Object.values(room.players);
  const alivePlayers = players.filter(p => p.isAlive);
  
  const aliveWolves = alivePlayers.filter(p => p.role === 'WOLF');
  const aliveVillagers = alivePlayers.filter(p => p.role !== 'WOLF');

  if (aliveWolves.length === 0) {
    return 'VILLAGER_WIN';
  } else if (aliveWolves.length >= aliveVillagers.length) {
    return 'WOLF_WIN';
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        phase: 'LOBBY', // LOBBY, NIGHT, DAY, END
        winner: null,
        players: {},
        wolfMessages: [],
        ghostMessages: [], 
        votes: {}, 
        wolfTarget: null,
        guardTarget: null,
        witchHealTarget: null,
        witchPoisonTarget: null,
        settings: {
          wolfCount: 2,
          guardCount: 1,
          seerCount: 1,
          witchCount: 1,
          infectedCount: 0,
          villagerCount: 2
        }
      };
    }

    const room = rooms[roomId];

    // Xử lý chống trùng ghế hoặc F5 nhận diện lại ghế cũ
    const existingPlayerAtSeat = Object.values(room.players).find(p => p.seat === seat);
    if (existingPlayerAtSeat && existingPlayerAtSeat.id !== socket.id) {
      delete room.players[existingPlayerAtSeat.id];
    }

    const existingHost = Object.values(room.players).find(p => p.isHost);
    let finalIsHost = !!isHost;
    if (!existingHost && Object.keys(room.players).length === 0) {
      finalIsHost = true;
    } else if (existingHost && existingHost.seat === seat) {
      finalIsHost = true;
    } else {
      finalIsHost = false;
    }

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat,
      isHost: finalIsHost,
      role: existingPlayerAtSeat ? existingPlayerAtSeat.role : null,
      statusEffect: existingPlayerAtSeat ? existingPlayerAtSeat.statusEffect : null, 
      isAlive: existingPlayerAtSeat ? existingPlayerAtSeat.isAlive : true,
      hasUsedHeal: existingPlayerAtSeat ? existingPlayerAtSeat.hasUsedHeal : false,   
      hasUsedPoison: existingPlayerAtSeat ? existingPlayerAtSeat.hasUsedPoison : false,
      canSpeak: true,
      canCam: true
    };

    updateMediaPermissions(room);
    io.to(roomId).emit('room_state_update', room);
  });

  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    const playerIds = Object.keys(room.players);
    const totalPlayers = playerIds.length;
    
    const { 
      wolfCount = 2, 
      guardCount = 1, 
      seerCount = 1, 
      witchCount = 1, 
      infectedCount = 0, 
      villagerCount = 2 
    } = room.settings;

    let rolesPool = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('WOLF');
    for (let i = 0; i < guardCount; i++) rolesPool.push('GUARD');
    for (let i = 0; i < seerCount; i++) rolesPool.push('SEER');
    for (let i = 0; i < witchCount; i++) rolesPool.push('WITCH');
    for (let i = 0; i < infectedCount; i++) rolesPool.push('INFECTED');
    for (let i = 0; i < villagerCount; i++) rolesPool.push('VILLAGER');

    if (rolesPool.length > totalPlayers) {
      rolesPool = rolesPool.slice(0, totalPlayers);
    }
    while (rolesPool.length < totalPlayers) {
      rolesPool.push('VILLAGER');
    }

    rolesPool.sort(() => Math.random() - 0.5);

    playerIds.forEach((id, index) => {
      room.players[id].role = rolesPool[index];
      room.players[id].statusEffect = null;
      room.players[id].isAlive = true;
      room.players[id].hasUsedHeal = false;
      room.players[id].hasUsedPoison = false;
    });

    room.phase = 'NIGHT';
    room.winner = null;
    room.wolfMessages = [];
    room.ghostMessages = []; 
    room.votes = {}; 
    room.wolfTarget = null;
    room.guardTarget = null;
    room.witchHealTarget = null;
    room.witchPoisonTarget = null;

    updateMediaPermissions(room);
    io.to(roomId).emit('room_state_update', room);
  });

  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      if (room.phase === 'NIGHT' && phase === 'DAY') {
        let deadSeatsThisNight = [];

        let bittenSeat = room.wolfTarget;
        let guardedSeat = room.guardTarget;
        let healedSeat = room.witchHealTarget;
        let poisonedSeat = room.witchPoisonTarget;

        if (bittenSeat) {
          if (bittenSeat !== guardedSeat && bittenSeat !== healedSeat) {
            deadSeatsThisNight.push(bittenSeat);
          }
        }

        if (poisonedSeat) {
          if (!deadSeatsThisNight.includes(poisonedSeat)) {
            deadSeatsThisNight.push(poisonedSeat);
          }
        }

        Object.values(room.players).forEach(p => {
          if (deadSeatsThisNight.includes(parseInt(p.seat))) {
            p.isAlive = false;
          }
        });

        // Gửi thông báo kết quả đêm qua
        if (deadSeatsThisNight.length === 0) {
          io.to(roomId).emit('notification', { message: '🌙 Đêm qua là một đêm an toàn, không có ai thiệt mạng!' });
        } else {
          io.to(roomId).emit('notification', { message: `☠️ Các ghế thiệt mạng trong đêm: ${deadSeatsThisNight.join(', ')}` });
        }

        const winner = checkWinCondition(room);
        if (winner) {
          room.phase = 'END';
          room.winner = winner;
          io.to(roomId).emit('room_state_update', room);
          return;
        }
      }

      room.phase = phase;
      if (phase === 'NIGHT') {
        room.votes = {};
        room.wolfTarget = null;
        room.guardTarget = null;
        room.witchHealTarget = null;
        room.witchPoisonTarget = null;

        Object.values(room.players).forEach(p => {
          p.statusEffect = null;
        });
      }

      updateMediaPermissions(room);
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Xử lý tổng hợp kết quả vote treo cổ ban ngày
  socket.on('execute_vote_result', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

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
        io.to(roomId).emit('notification', { message: `⚖️ Làng đã quyết định treo cổ ghế #${targetSeatToExecute} (${targetPlayer.name})!` });
      }
    } else {
      io.to(roomId).emit('notification', { message: '⚖️ Không có ai bị treo cổ trong ngày hôm nay (Phiếu bầu trống hoặc hòa).' });
    }

    const winner = checkWinCondition(room);
    if (winner) {
      room.phase = 'END';
      room.winner = winner;
    } else {
      room.phase = 'NIGHT';
      room.votes = {};
      room.wolfTarget = null;
      room.guardTarget = null;
      room.witchHealTarget = null;
      room.witchPoisonTarget = null;
      Object.values(room.players).forEach(p => { p.statusEffect = null; });
    }

    updateMediaPermissions(room);
    io.to(roomId).emit('room_state_update', room);
  });

  // Chat riêng của Sói ban đêm (Chỉ Sói sống mới được chat)
  socket.on('send_wolf_message', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const senderPlayer = room.players[socket.id];
    if (!senderPlayer) return;

    if (senderPlayer.role === 'WOLF' && senderPlayer.isAlive) {
      room.wolfMessages.push({
        sender: `${senderPlayer.name} (Sói)`,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      if (room.wolfMessages.length > 50) room.wolfMessages.shift();
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('send_wolf_chat', ({ roomId, message }) => {
    socket.emit('send_wolf_message', { roomId, text: message });
  });

  // Chat riêng của Hồn Ma (dành cho người đã chết)
  socket.on('send_ghost_message', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (player && player.isAlive === false) {
      if (!room.ghostMessages) room.ghostMessages = [];

      room.ghostMessages.push({
        sender: `${player.name} (Ghế #${player.seat})`,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      if (room.ghostMessages.length > 50) {
        room.ghostMessages.shift();
      }

      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Xử lý bỏ phiếu treo cổ ban ngày
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'DAY') return;

    const voter = room.players[socket.id];
    if (!voter || !voter.isAlive) return;

    if (!room.votes) room.votes = {};
    room.votes[socket.id] = targetSeat;

    io.to(roomId).emit('room_state_update', room);
  });

  // Quản trò xóa bảng vote
  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      room.votes = {};
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Xử lý tác vụ ban đêm
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.isAlive) return;

    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
    if (!targetPlayer) return;

    if (actionType === 'GUARD' && player.role === 'GUARD') {
      room.guardTarget = targetSeat;
      targetPlayer.statusEffect = 'GUARDED';
    } 
    else if (actionType === 'WOLF' && player.role === 'WOLF') {
      room.wolfTarget = targetSeat;
      targetPlayer.statusEffect = 'WOLF_TARGET';
      room.wolfMessages.push({
        sender: 'Hệ thống',
        text: `🐺 Sói đã chọn cắn ghế #${targetSeat}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      const witchPlayer = Object.values(room.players).find(p => p.role === 'WITCH' && p.isAlive);
      if (witchPlayer) {
        io.to(witchPlayer.id).emit('witch_target_info', { targetSeat: targetSeat });
      }
    } 
    else if (actionType === 'WITCH_SAVE' && player.role === 'WITCH') {
      if (player.hasUsedHeal) {
        return socket.emit('notification', { message: 'Bạn đã dùng Bình Cứu ở các lượt trước rồi!' });
      }
      player.hasUsedHeal = true;
      room.witchHealTarget = targetSeat;
      targetPlayer.statusEffect = 'WITCH_SAVED';
    } 
    else if (actionType === 'WITCH_POISON' && player.role === 'WITCH') {
      if (player.hasUsedPoison) {
        return socket.emit('notification', { message: 'Bạn đã dùng Bình Độc ở các lượt trước rồi!' });
      }
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

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        if (rooms[roomId].votes && rooms[roomId].votes[socket.id]) {
          delete rooms[roomId].votes[socket.id];
        }
        
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('room_state_update', rooms[roomId]);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server đang chạy trên cổng ${PORT}`);
});