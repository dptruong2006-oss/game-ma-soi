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

// --- CAU HINH AGORA RTC ---
const AGORA_APP_ID = process.env.AGORA_APP_ID || "f8b9cc77ff234823b6e4685127ebf475";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || ""; // Đền Certificate nếu bật trong Agora Console

app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  const uid = req.query.uid || 0;
  if (!channelName) {
    return res.status(400).json({ error: 'channelName is required' });
  }

  const role = RtcRole.PUBLISHER;
  const expirationTimeInSeconds = 3600 * 24;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  let token = "";
  if (AGORA_APP_CERTIFICATE) {
    token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );
  }

  return res.json({ token });
});

// --- LOGIC PHONG GAME & SOCKET.IO ---
const rooms = {};

// Hàm hỗ trợ trộn bài
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Bắt đầu đếm ngược Phase
function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    if (room.timeLeft > 0) {
      room.timeLeft -= 1;
      io.to(roomId).emit('timer_update', { timeLeft: room.timeLeft });
    } else {
      clearInterval(room.timerInterval);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log('Nguoi choi ket noi:', socket.id);

  // 1. Tham gia phòng
  socket.on('join_room', ({ roomId, userId, name, seat }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        phase: 'WAITING', // WAITING, DAY, NIGHT
        timeLeft: 0,
        players: {},
        votes: {},
        nightActions: {},
        settings: {
          wolfCount: 2,
          guardCount: 1,
          seerCount: 1,
          witchCount: 1,
          villagerCount: 2,
          dayDuration: 120,
          nightDuration: 60
        }
      };
    }

    const room = rooms[roomId];
    const isFirstPlayer = Object.keys(room.players).length === 0;

    room.players[userId] = {
      userId,
      socketId: socket.id,
      name,
      seat: parseInt(seat),
      isHost: isFirstPlayer || room.players[userId]?.isHost || false,
      isAlive: true,
      role: room.players[userId]?.role || null,
      canSpeak: true,
      canCam: true,
      hasUsedHeal: false,
      hasUsedPoison: false
    };

    socket.roomId = roomId;
    socket.userId = userId;

    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `${name} đã vào ghế #${seat}` });
  });

  // 2. Cập nhật cấu hình phòng (Host Only)
  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      io.to(roomId).emit('room_state_update', room);
      io.to(roomId).emit('notification', { message: 'Chủ phòng đã cập nhật cài đặt ván đấu.' });
    }
  });

  // 3. Bắt đầu ván đấu & Chia vai trò
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.userId]?.isHost) return;

    const playerList = Object.values(room.players);
    const { wolfCount, guardCount, seerCount, witchCount } = room.settings;

    // Tạo danh sách role theo cài đặt
    let roles = [];
    for (let i = 0; i < wolfCount; i++) roles.push('WOLF');
    for (let i = 0; i < guardCount; i++) roles.push('GUARD');
    for (let i = 0; i < seerCount; i++) roles.push('SEER');
    for (let i = 0; i < witchCount; i++) roles.push('WITCH');

    while (roles.length < playerList.length) {
      roles.push('VILLAGER');
    }

    roles = shuffleArray(roles);

    playerList.forEach((p, idx) => {
      p.role = roles[idx];
      p.isAlive = true;
      p.hasUsedHeal = false;
      p.hasUsedPoison = false;
    });

    room.phase = 'NIGHT';
    room.timeLeft = room.settings.nightDuration;
    room.votes = {};
    room.nightActions = {};

    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: 'Ván đấu bắt đầu! Màn đêm buông xuống...' });
  });

  // 4. Chuyển đổi trạng thái Ngày / Đêm
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.userId]?.isHost) return;

    room.phase = phase;
    room.timeLeft = phase === 'DAY' ? room.settings.dayDuration : room.settings.nightDuration;
    
    if (phase === 'DAY') room.nightActions = {};
    if (phase === 'NIGHT') room.votes = {};

    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `Trạng thái chuyển sang: ${phase === 'DAY' ? 'BAN NGÀY ☀️' : 'BAN ĐÊM 🌙'}` });
  });

  // 5. Bỏ phiếu Ban Ngày (Vote)
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (room && room.phase === 'DAY') {
      room.votes[socket.userId] = targetSeat;
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.userId]?.isHost) {
      room.votes = {};
      io.to(roomId).emit('room_state_update', room);
      io.to(roomId).emit('notification', { message: 'Đã xóa toàn bộ phiếu vote.' });
    }
  });

  // 6. Hành động Ban Đêm (Sói cắn, Tiên tri soi, Bảo vệ, Phù thủy)
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room || room.phase !== 'NIGHT') return;

    const actor = room.players[socket.userId];
    if (!actor || !actor.isAlive) return;

    if (actionType === 'WOLF' && actor.role === 'WOLF') {
      room.nightActions['WOLF_TARGET'] = targetSeat;
      // Thông báo cho Phù thủy biết mục tiêu bị cắn
      Object.values(room.players).forEach(p => {
        if (p.role === 'WITCH' && p.isAlive) {
          io.to(p.socketId).emit('witch_target_info', { targetSeat });
        }
      });
    }

    if (actionType === 'GUARD' && actor.role === 'GUARD') {
      room.nightActions['GUARD_TARGET'] = targetSeat;
    }

    if (actionType === 'SEER_CHECK' && actor.role === 'SEER') {
      const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
      if (targetPlayer) {
        socket.emit('seer_result', {
          seat: targetSeat,
          name: targetPlayer.name,
          isWolf: targetPlayer.role === 'WOLF'
        });
      }
    }

    if (actionType === 'WITCH_SAVE' && actor.role === 'WITCH' && !actor.hasUsedHeal) {
      room.nightActions['WITCH_SAVE'] = true;
      actor.hasUsedHeal = true;
    }

    if (actionType === 'WITCH_POISON' && actor.role === 'WITCH' && !actor.hasUsedPoison) {
      room.nightActions['WITCH_POISON_TARGET'] = targetSeat;
      actor.hasUsedPoison = true;
    }

    io.to(roomId).emit('room_state_update', room);
  });

  // 7. Kênh Chat riêng (Phe Sói & Hồn Ma)
  socket.on('send_wolf_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    const player = room?.players?.[socket.userId];
    if (player && player.role === 'WOLF') {
      Object.values(room.players).forEach(p => {
        if (p.role === 'WOLF') {
          io.to(p.socketId).emit('wolf_message_receive', { sender: player.name, message });
        }
      });
    }
  });

  socket.on('send_ghost_chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    const player = room?.players?.[socket.userId];
    if (player && !player.isAlive) {
      Object.values(room.players).forEach(p => {
        if (!p.isAlive) {
          io.to(p.socketId).emit('ghost_message_receive', { sender: player.name, message });
        }
      });
    }
  });

  // 8. Ngắt kết nối
  socket.on('disconnect', () => {
    const { roomId, userId } = socket;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[userId];
      if (Object.keys(rooms[roomId].players).length === 0) {
        if (rooms[roomId].timerInterval) clearInterval(rooms[roomId].timerInterval);
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('room_state_update', rooms[roomId]);
      }
    }
  });
});

// Port mặc định cho Render
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server dang chay tai port ${PORT}`);
});