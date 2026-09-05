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

// --- ĐỊNH NGHĨA HƯỚNG DẪN VÀ CHỨC NĂNG NHÂN VẬT ---
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
  HUNTER: {
    name: "🎯 Thợ Săn",
    team: "Phe Dân Làng",
    objective: "Tiêu diệt kẻ địch trước khi bản thân ngã xuống.",
    ability: "Khi chết, Thợ Săn có quyền kéo theo 1 người bất kỳ chết cùng."
  },
  IDIOT: {
    name: "🃏 Kẻ Khờ",
    team: "Phe Dân Làng",
    objective: "Ẩn mình và sống sót đến cuối cùng.",
    ability: "Nếu bị vote treo cổ ban ngày, bài lật ngửa, thoát chết nhưng mất quyền vote các vòng sau."
  },
  VILLAGER: {
    name: "🧑‍🌾 Dân Làng",
    team: "Phe Dân Làng",
    objective: "Tìm ra manh mối và treo cổ toàn bộ Sói.",
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

// Đồng bộ trạng thái toàn phòng gửi về Client
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
  io.to(roomId).emit('room_state_update', room);
}

// Quản lý quyền Mic/Cam động theo pha và vai trò
function updateMediaPermissions(room) {
  const isNight = room.phase === 'NIGHT';
  Object.values(room.players).forEach(p => {
    if (p.isHost) {
      p.canSpeak = true;
      p.canCam = true;
      return;
    }
    if (!p.isAlive) {
      p.canSpeak = true;
      p.canCam = true; // Hồn ma giao lưu với nhau
      return;
    }
    if (isNight) {
      if (p.role === 'WOLF') {
        p.canSpeak = true;
        p.canCam = true;
      } else {
        p.canSpeak = false;
        p.canCam = false;
      }
    } else {
      p.canSpeak = true;
      p.canCam = true;
    }
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
    io.to(roomId).emit('notification', { message: '☀️ Trời đã sáng, mọi người thức dậy thảo luận!' });
  } else if (room.phase === 'DAY') {
    room.phase = 'VOTE';
    room.timeLeft = room.settings.voteDuration || 45;
    room.votes = {};
    io.to(roomId).emit('notification', { message: '🗳️ Đã đến giờ bỏ phiếu treo cổ ẩn danh!' });
  } else {
    processVotesAndExecute(roomId);
    return;
  }

  updateMediaPermissions(room);
  startTimer(roomId);
  broadcastRoomUpdate(roomId);
}

function resolveNightActions(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const wolfTargetSeat = room.nightActions['WOLF_TARGET'];
  const guardTargetSeat = room.nightActions['GUARD_TARGET'];
  const witchHealSeat = room.nightActions['WITCH_HEAL_TARGET'];

  let deadPlayers = [];

  if (wolfTargetSeat !== undefined) {
    let targetPlayer = Object.values(room.players).find(p => p.seat == wolfTargetSeat);
    if (targetPlayer && targetPlayer.isAlive) {
      let isProtected = (guardTargetSeat == wolfTargetSeat);
      let isHealed = (witchHealSeat == wolfTargetSeat);

      if (isProtected || isHealed) {
        io.to(roomId).emit('notification', { message: `🛡️ Ghế #${wolfTargetSeat} bị sói tấn công nhưng đã được cứu sống kỳ diệu!` });
      } else {
        targetPlayer.isAlive = false;
        targetPlayer.status = 'DEAD';
        deadPlayers.push({ seat: targetPlayer.seat, name: targetPlayer.name });
      }
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

function processVotesAndExecute(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const voteCounts = {};
  Object.values(room.votes).forEach(targetSeat => {
    voteCounts[targetSeat] = (voteCounts[targetSeat] || 0) + 1;
  });

  let maxVotes = 0;
  let eliminatedSeat = null;
  let isTie = false;

  for (const [seat, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedSeat = seat;
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }

  if (eliminatedSeat && !isTie) {
    const targetPlayer = Object.values(room.players).find(p => p.seat == eliminatedSeat);
    if (targetPlayer) {
      if (targetPlayer.role === 'IDIOT' && !targetPlayer.idiotRevealed) {
        targetPlayer.idiotRevealed = true;
        io.to(roomId).emit('notification', { message: `🃏 Ghế #${eliminatedSeat} (${targetPlayer.name}) lật bài là KẺ KHỜ! Thoát chết.` });
      } else {
        targetPlayer.isAlive = false;
        targetPlayer.status = 'DEAD';
        io.to(roomId).emit('notification', { message: `⚖️ Ghế #${eliminatedSeat} (${targetPlayer.name}) đã bị treo cổ với ${maxVotes} phiếu!` });
      }
    }
  } else {
    io.to(roomId).emit('notification', { message: `⚖️ Không có ai bị treo cổ vòng này.` });
  }

  room.phase = 'NIGHT';
  room.timeLeft = room.settings.nightDuration || 60;
  room.votes = {};
  updateMediaPermissions(room);
  startTimer(roomId);
  broadcastRoomUpdate(roomId);
  io.to(roomId).emit('notification', { message: '🌙 Màn đêm buông xuống...' });
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
        settings: { wolves: 2, guards: 1, seers: 1, witches: 1, hunters: 1, idiots: 1, dayDuration: 120, nightDuration: 60 }
      };
    }

    const room = rooms[roomId];

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat: parseInt(seat),
      isHost: isHost || false,
      isAlive: true,
      status: 'ALIVE',
      role: null,
      roleInfo: null,
      canSpeak: true,
      canCam: true
    };

    socket.roomId = roomId;
    updateMediaPermissions(room);
    broadcastRoomUpdate(roomId);
  });

  // Bắt đầu game và chia vai trò
  socket.on('start_game', ({ roomId, roleSetup }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    if (roleSetup) {
      room.settings = { ...room.settings, ...roleSetup };
    }

    const playerList = Object.values(room.players).filter(p => !p.isHost);
    const { wolves = 2, guards = 1, seers = 1, witches = 1, hunters = 1, idiots = 1 } = room.settings;

    let roles = [];
    for (let i = 0; i < wolves; i++) roles.push('WOLF');
    for (let i = 0; i < guards; i++) roles.push('GUARD');
    for (let i = 0; i < seers; i++) roles.push('SEER');
    for (let i = 0; i < witches; i++) roles.push('WITCH');
    for (let i = 0; i < hunters; i++) roles.push('HUNTER');
    for (let i = 0; i < idiots; i++) roles.push('IDIOT');

    while (roles.length < playerList.length) {
      roles.push('VILLAGER');
    }

    roles = shuffleArray(roles);

    playerList.forEach((p, idx) => {
      const assignedRole = roles[idx];
      room.players[p.id].role = assignedRole;
      room.players[p.id].isAlive = true;
      room.players[p.id].status = 'ALIVE';
      room.players[p.id].roleInfo = ROLE_DESCRIPTIONS[assignedRole] || ROLE_DESCRIPTIONS['VILLAGER'];
    });

    room.phase = 'NIGHT';
    room.timeLeft = room.settings.nightDuration || 60;
    room.votes = {};
    room.nightActions = {};

    updateMediaPermissions(room);
    startTimer(roomId);
    broadcastRoomUpdate(roomId);
    io.to(roomId).emit('notification', { message: '🎮 Trận đấu bắt đầu! Kiểm tra kỹ năng nhân vật ở góc màn hình.' });
  });

  // Host thay đổi pha thủ công
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    room.phase = phase;
    room.timeLeft = phase === 'NIGHT' ? (room.settings.nightDuration || 60) : (room.settings.dayDuration || 120);
    updateMediaPermissions(room);
    startTimer(roomId);
    broadcastRoomUpdate(roomId);
    io.to(roomId).emit('notification', { message: `⚙️ Quản trò đã đổi pha sang: ${phase}` });
  });

  // Xóa vòng vote
  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;
    room.votes = {};
    io.to(roomId).emit('notification', { message: '🧹 Quản trò đã làm mới lượt bỏ phiếu.' });
  });

  // Hành động ban đêm
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const actor = room.players[socket.id];
    const isHostActor = actor?.isHost;
    if (!isHostActor && (!actor || !actor.isAlive)) return;

    if (actionType === 'WOLF') room.nightActions['WOLF_TARGET'] = targetSeat;
    if (actionType === 'GUARD') room.nightActions['GUARD_TARGET'] = targetSeat;
    if (actionType === 'WITCH_HEAL') room.nightActions['WITCH_HEAL_TARGET'] = targetSeat;
    
    if (actionType === 'SEER_CHECK') {
      const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
      if (targetPlayer) {
        socket.emit('seer_result', { seat: targetSeat, name: targetPlayer.name, isWolf: targetPlayer.role === 'WOLF' });
      }
    }

    broadcastRoomUpdate(roomId);
  });

  // Vote ban ngày
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (room && room.phase === 'VOTE') {
      const actor = room.players[socket.id];
      if (!actor || !actor.isAlive || actor.idiotRevealed) return;
      room.votes[socket.id] = targetSeat;
      socket.emit('notification', { message: `🗳️ Đã ghi nhận phiếu bầu cho ghế #${targetSeat}` });
    }
  });

  // Chat riêng phe sói
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
        updateMediaPermissions(rooms[roomId]);
        broadcastRoomUpdate(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói nâng cao chạy tại port ${PORT}`);
});