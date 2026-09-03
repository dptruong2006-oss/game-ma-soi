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

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        phase: 'LOBBY', // LOBBY, NIGHT, DAY
        players: {},
        wolfMessages: [],
        ghostMessages: [], 
        votes: {}, // Lưu trữ phiếu bầu ban ngày { voterSocketId: targetSeat }
        settings: {
          wolfCount: 2,
          guardCount: 1,
          seerCount: 1,
          witchCount: 1,
          villagerCount: 2
        }
      };
    }

    const room = rooms[roomId];
    const existingHost = Object.values(room.players).find(p => p.isHost);
    let finalIsHost = !!isHost;
    if (finalIsHost && existingHost && existingHost.id !== socket.id) {
      finalIsHost = false; 
    }

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat,
      isHost: finalIsHost,
      role: null,
      statusEffect: null, // GUARDED, WOLF_TARGET, WITCH_SAVED, WITCH_POISONED
      isAlive: true
    };

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
    
    const { wolfCount = 2, guardCount = 1, seerCount = 1, witchCount = 1, villagerCount = 2 } = room.settings;

    let rolesPool = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('WOLF');
    for (let i = 0; i < guardCount; i++) rolesPool.push('GUARD');
    for (let i = 0; i < seerCount; i++) rolesPool.push('SEER');
    for (let i = 0; i < witchCount; i++) rolesPool.push('WITCH');
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
    });

    room.phase = 'NIGHT';
    room.wolfMessages = [];
    room.ghostMessages = []; 
    room.votes = {}; 
    io.to(roomId).emit('room_state_update', room);
  });

  // Chuyển đổi qua lại giữa Đêm và Ngày do Quản trò bấm
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      // Nếu chuyển từ Đêm sang Ngày, tiến hành tính toán kết quả ban đêm
      if (room.phase === 'NIGHT' && phase === 'DAY') {
        Object.values(room.players).forEach(player => {
          if (!player.isAlive) return;

          let isGuarded = player.statusEffect === 'GUARDED';
          let isWolfTarget = player.statusEffect === 'WOLF_TARGET';
          let isWitchSaved = player.statusEffect === 'WITCH_SAVED';
          let isWitchPoisoned = player.statusEffect === 'WITCH_POISONED';

          if (isWitchPoisoned) {
            player.isAlive = false;
          } else if (isWolfTarget) {
            // Nếu bị sói cắn mà không được bảo vệ và không được cứu -> chết
            if (!isGuarded && !isWitchSaved) {
              player.isAlive = false;
            }
          }
        });
      }

      room.phase = phase;
      if (phase === 'NIGHT') {
        room.votes = {};
        Object.values(room.players).forEach(p => {
          p.statusEffect = null;
        });

        // Khi sang đêm, gửi riêng thông tin ai bị sói cắn cho Phù thủy (nếu cần thiết cho client hiển thị)
        const wolfTargetPlayer = Object.values(room.players).find(p => p.statusEffect === 'WOLF_TARGET');
        const witchPlayer = Object.values(room.players).find(p => p.role === 'WITCH' && p.isAlive);
        if (witchPlayer && wolfTargetPlayer) {
          io.to(witchPlayer.id).emit('witch_target_info', { targetSeat: wolfTargetPlayer.seat });
        }
      }
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Chat riêng của Sói ban đêm
  socket.on('send_wolf_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.role === 'WOLF') {
      room.wolfMessages.push({
        sender: room.players[socket.id].name,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      if (room.wolfMessages.length > 50) room.wolfMessages.shift();
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Chat riêng của Hồn Ma (chỉ người chơi đã chết mới được gửi)
  socket.on('send_ghost_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (player && player.isAlive === false) {
      if (!room.ghostMessages) room.ghostMessages = [];

      room.ghostMessages.push({
        sender: `${player.name} (Ghế #${player.seat})`,
        text: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      if (room.ghostMessages.length > 50) {
        room.ghostMessages.shift();
      }

      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Xử lý bỏ phiếu vote treo cổ vào ban ngày
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

  // Xử lý tác vụ ban đêm bảo mật (Bảo vệ, Sói cắn, Tiên tri soi, Phù thủy cứu/giết)
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
    if (!targetPlayer) return;

    if (actionType === 'GUARD') {
      Object.values(room.players).forEach(p => { if (p.statusEffect === 'GUARDED') p.statusEffect = null; });
      targetPlayer.statusEffect = 'GUARDED';
    } else if (actionType === 'WOLF') {
      Object.values(room.players).forEach(p => { if (p.statusEffect === 'WOLF_TARGET') p.statusEffect = null; });
      targetPlayer.statusEffect = 'WOLF_TARGET';
    } else if (actionType === 'WITCH_SAVE') {
      targetPlayer.statusEffect = 'WITCH_SAVED';
    } else if (actionType === 'WITCH_POISON') {
      targetPlayer.statusEffect = 'WITCH_POISONED';
    } else if (actionType === 'SEER_CHECK') {
      // Chỉ gửi kết quả về riêng cho Tiên tri thực hiện thao tác
      socket.emit('seer_result', {
        seat: targetSeat,
        name: targetPlayer.name,
        isWolf: targetPlayer.role === 'WOLF'
      });
    }

    // Gửi thông báo riêng hoặc cập nhật ngầm cho Quản trò biết hành động đã được thực hiện (nếu cần theo dõi)
    const hostPlayer = Object.values(room.players).find(p => p.isHost);
    if (hostPlayer) {
      io.to(hostPlayer.id).emit('host_action_notification', {
        actionType,
        targetSeat
      });
    }

    // Không broadcast trạng thái statusEffect chi tiết ra phòng chung để bảo mật tuyệt đối vai trò
    // Chỉ cập nhật trạng thái chung cơ bản nếu cần
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