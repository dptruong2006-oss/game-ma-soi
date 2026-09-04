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
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "";

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

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

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
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        phase: 'LOBBY',
        timeLeft: 0,
        players: {},
        votes: {},
        nightActions: {},
        settings: {
          wolves: 2,
          guards: 1,
          seers: 1,
          witches: 1,
          dayDuration: 120,
          nightDuration: 60
        }
      };
    }

    const room = rooms[roomId];

    room.players[socket.id] = {
      id: socket.id,
      socketId: socket.id,
      name,
      seat: parseInt(seat),
      isHost: isHost || false,
      isAlive: true,
      role: null,
      canSpeak: true,
      canCam: true,
      hasUsedHeal: false,
      hasUsedPoison: false
    };

    socket.roomId = roomId;

    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `${name} đã vào ghế #${seat}` });
  });

  // 1b. Khôi phục session khi F5
  socket.on('rejoin_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);
    if (rooms[roomId]) {
      const room = rooms[roomId];
      room.players[socket.id] = {
        id: socket.id,
        socketId: socket.id,
        name,
        seat: parseInt(seat),
        isHost: isHost || false,
        isAlive: true,
        role: room.players[socket.id]?.role || null,
        canSpeak: true,
        canCam: true
      };
      socket.roomId = roomId;
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // 2. Bắt đầu ván đấu & Đồng bộ roleSetup từ Host
  socket.on('start_game', ({ roomId, roleSetup }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    if (roleSetup) {
      room.settings = { ...room.settings, ...roleSetup };
    }

    const playerList = Object.values(room.players).filter(p => !p.isHost);
    const { wolves = 2, guards = 1, seers = 1, witches = 1 } = room.settings;

    let roles = [];
    for (let i = 0; i < wolves; i++) roles.push('WOLF');
    for (let i = 0; i < guards; i++) roles.push('GUARD');
    for (let i = 0; i < seers; i++) roles.push('SEER');
    for (let i = 0; i < witches; i++) roles.push('WITCH');

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
    room.timeLeft = room.settings.nightDuration || 60;
    room.votes = {};
    room.nightActions = {};

    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: 'Ván đấu bắt đầu! Màn đêm buông xuống...' });
  });

  // 3. Chuyển đổi trạng thái Ngày / Đêm
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    room.phase = phase;
    room.timeLeft = phase === 'DAY' ? (room.settings.dayDuration || 120) : (room.settings.nightDuration || 60);
    
    if (phase === 'DAY') room.nightActions = {};
    if (phase === 'NIGHT') room.votes = {};

    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `Trạng thái chuyển sang: ${phase === 'DAY' ? 'BAN NGÀY ☀️' : 'BAN ĐÊM 🌙'}` });
  });

  // 4. Bỏ phiếu Ban Ngày (Vote)
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (room && room.phase === 'DAY') {
      room.votes[socket.id] = targetSeat;
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      room.votes = {};
      io.to(roomId).emit('room_state_update', room);
      io.to(roomId).emit('notification', { message: 'Đã xóa toàn bộ phiếu vote.' });
    }
  });

  // 5. Hành động Ban Đêm
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const actor = room.players[socket.id];
    const isHostActor = actor?.isHost;

    if (!isHostActor && (!actor || !actor.isAlive)) return;

    if (actionType === 'WOLF' && (isHostActor || actor.role === 'WOLF')) {
      room.nightActions['WOLF_TARGET'] = targetSeat;
    }

    if (actionType === 'GUARD' && (isHostActor || actor.role === 'GUARD')) {
      room.nightActions['GUARD_TARGET'] = targetSeat;
    }

    if (actionType === 'SEER_CHECK' && (isHostActor || actor.role === 'SEER')) {
      const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
      if (targetPlayer) {
        socket.emit('seer_result', {
          seat: targetSeat,
          name: targetPlayer.name,
          isWolf: targetPlayer.role === 'WOLF'
        });
      }
    }

    if (actionType === 'WITCH_POISON' && (isHostActor || actor.role === 'WITCH')) {
      room.nightActions['WITCH_POISON_TARGET'] = targetSeat;
    }

    io.to(roomId).emit('room_state_update', room);
  });

  // 6. Kích đuổi & Đổi trạng thái Sống/Chết bởi Host
  socket.on('host_kick_player', ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      io.to(targetSocketId).emit('kicked_from_room');
      delete room.players[targetSocketId];
      io.to(roomId).emit('room_state_update', room);
    }
  });

  socket.on('host_toggle_alive', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
      if (targetPlayer) {
        targetPlayer.isAlive = !targetPlayer.isAlive;
        io.to(roomId).emit('room_state_update', room);
      }
    }
  });

  // 7. Kênh Chat Phe Sói
  socket.on('send_wolf_chat', ({ roomId, message, sender }) => {
    const room = rooms[roomId];
    if (room) {
      Object.values(room.players).forEach(p => {
        if (p.role === 'WOLF' || p.isHost) {
          io.to(p.socketId).emit('wolf_message_receive', { sender, message });
        }
      });
    }
  });

  // 8. Ngắt kết nối
  socket.on('disconnect', () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        if (rooms[roomId].timerInterval) clearInterval(rooms[roomId].timerInterval);
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('room_state_update', rooms[roomId]);
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server dang chay tai port ${PORT}`);
});