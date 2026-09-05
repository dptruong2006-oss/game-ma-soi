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

// --- CẤU HÌNH AGORA RTC ---
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

// --- DỮ LIỆU ĐỊNH NGHĨA VÀ HƯỚNG DẪN NHÂN VẬT ---
const ROLE_DESCRIPTIONS = {
  WOLF: {
    name: "🐺 Sói Đêm",
    team: "Phe Sói",
    objective: "Tiêu diệt toàn bộ dân làng để chiếm quyền kiểm soát.",
    ability: "Mỗi đêm thức dậy cùng đồng bọn chọn 1 người để cắn sát hại. Ban đêm được mở mic bàn chiến thuật riêng."
  },
  GUARD: {
    name: "🛡️ Bảo Vệ",
    team: "Phe Dân Làng",
    objective: "Bảo vệ những người vô tội khỏi nanh vuốt của Sói.",
    ability: "Mỗi đêm chọn bảo vệ 1 người (có thể chọn chính mình). Không được bảo vệ liên tiếp 1 người trong 2 đêm."
  },
  SEER: {
    name: "🔮 Tiên Tri",
    team: "Phe Dân Làng",
    objective: "Soi ra danh tính phe Sói để hướng dẫn dân làng treo cổ đúng người.",
    ability: "Mỗi đêm chọn kiểm tra vai trò của 1 người chơi bất kỳ để biết họ có phải Sói hay không."
  },
  WITCH: {
    name: "🧙‍♀️ Phù Thủy",
    team: "Phe Dân Làng",
    objective: "Sử dụng các bình phép thuật cứu người hoặc tiêu diệt Sói.",
    ability: "Có 1 Bình Cứu và 1 Bình Độc. Mỗi bình chỉ dùng được 1 lần duy nhất trong game."
  },
  VILLAGER: {
    name: "🧑‍🌾 Dân Làng",
    team: "Phe Dân Làng",
    objective: "Tìm ra manh mối, luận tội và treo cổ toàn bộ Sói.",
    ability: "Không có kỹ năng đặc biệt ban đêm."
  }
};

const rooms = {};

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Đồng bộ trạng thái toàn phòng gửi về Client (Khớp cấu trúc app.jsx)
function broadcastRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerList = Object.values(room.players);
  const takenSeats = playerList.map(p => p.seat);
  const existingHost = playerList.find(p => p.isHost)?.id || null;

  io.to(roomId).emit('room_update', {
    playerList,
    takenSeats,
    existingHost
  });
}

// Bộ đếm thời gian tự động chuyển pha
function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    if (room.timeLeft > 0) {
      room.timeLeft -= 1;
      io.to(roomId).emit('timer_update', { timeLeft: room.timeLeft, phase: room.phase });
    } else {
      clearInterval(room.timerInterval);
      handlePhaseTransition(roomId);
    }
  }, 1000);
}

function handlePhaseTransition(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.phase === 'NIGHT') {
    resolveNightActions(roomId);
    room.phase = 'DAY';
    room.timeLeft = room.settings.dayDuration || 120;
    startTimer(roomId);
    io.to(roomId).emit('notification', { message: '☀️ Trời đã sáng, mọi người thức dậy thảo luận!' });
  } else {
    room.phase = 'NIGHT';
    room.timeLeft = room.settings.nightDuration || 60;
    room.votes = {};
    startTimer(roomId);
    io.to(roomId).emit('notification', { message: '🌙 Màn đêm buông xuống...' });
  }
  io.to(roomId).emit('room_state_update', room);
}

function resolveNightActions(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const wolfTargetSeat = room.nightActions['WOLF_TARGET'];
  let deadPlayers = [];

  if (wolfTargetSeat !== undefined) {
    let targetPlayer = Object.values(room.players).find(p => p.seat == wolfTargetSeat);
    if (targetPlayer && targetPlayer.isAlive) {
      targetPlayer.isAlive = false;
      deadPlayers.push({ seat: targetPlayer.seat, name: targetPlayer.name });
    }
  }

  if (deadPlayers.length > 0) {
    deadPlayers.forEach(d => {
      io.to(roomId).emit('notification', { message: `💀 Đêm qua, ghế #${d.seat} (${d.name}) đã ngã xuống!` });
    });
  } else {
    io.to(roomId).emit('notification', { message: '✨ Đêm qua là một đêm bình yên, không ai chết.' });
  }
  room.nightActions = {};
}

io.on('connection', (socket) => {
  console.log('Người chơi kết nối:', socket.id);

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
        settings: { wolves: 1, guards: 1, seers: 1, witches: 1, dayDuration: 120, nightDuration: 60 }
      };
    }

    const room = rooms[roomId];

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat: parseInt(seat),
      isHost: isHost || false,
      isAlive: true,
      role: null,
      status: 'ALIVE'
    };

    socket.roomId = roomId;
    broadcastRoomUpdate(roomId);
  });

  // Bắt đầu game từ Host
  socket.on('start_game', ({ roomId, roleSetup }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    if (roleSetup) {
      room.settings = { ...room.settings, ...roleSetup };
    }

    const playerList = Object.values(room.players).filter(p => !p.isHost);
    const { wolves = 1, guards = 1, seers = 1, witches = 1 } = room.settings;

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
      const assignedRole = roles[idx];
      room.players[p.id].role = assignedRole;
      room.players[p.id].isAlive = true;
      room.players[p.id].status = 'ALIVE';
    });

    room.phase = 'NIGHT';
    room.timeLeft = room.settings.nightDuration || 60;
    startTimer(roomId);

    broadcastRoomUpdate(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: '🎮 Trận đấu bắt đầu!' });
  });

  // Host thay đổi pha thủ công
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    room.phase = phase;
    room.timeLeft = phase === 'NIGHT' ? (room.settings.nightDuration || 60) : (room.settings.dayDuration || 120);
    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `⚙️ Quản trò đã đổi pha sang: ${phase}` });
  });

  // Xóa vòng vote
  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;
    room.votes = {};
    io.to(roomId).emit('notification', { message: '🧹 Quản trò đã làm mới lượt bỏ phiếu.' });
  });

  // Xử lý chat riêng phe sói
  socket.on('send_wolf_chat', ({ roomId, message, sender }) => {
    io.to(roomId).emit('receive_wolf_chat', { sender, message });
  });

  socket.on('disconnect', () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        if (rooms[roomId].timerInterval) clearInterval(rooms[roomId].timerInterval);
        delete rooms[roomId];
      } else {
        broadcastRoomUpdate(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói chạy tại port ${PORT}`);
});