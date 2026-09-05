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

// --- DỮ LIỆU ĐỊNH NGHĨA VÀ HƯỚNG DẪN NHÂN VẬT (GỬI LÊN GÓC MÀN HÌNH CLIENT) ---
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
    ability: "Có 1 Bình Cứu (hồi sinh người bị sói cắn trong đêm) và 1 Bình Độc (tiêu diệt bất kỳ ai). Mỗi bình chỉ dùng được 1 lần duy nhất trong game."
  },
  HUNTER: {
    name: "🎯 Thợ Săn",
    team: "Phe Dân Làng",
    objective: "Tiêu diệt kẻ địch trước khi bản thân ngã xuống.",
    ability: "Khi chết (do bị cắn hoặc bị treo cổ), Thợ Săn có quyền kéo theo 1 người bất kỳ chết cùng."
  },
  IDIOT: {
    name: "🃏 Kẻ Khờ",
    team: "Phe Dân Làng",
    objective: "Đánh lạc hướng hoặc ẩn mình, sống sót đến cuối cùng.",
    ability: "Nếu bị dân làng vote treo cổ ban ngày, bài sẽ lật ngửa, thoát chết nhưng mất quyền bỏ phiếu trong các vòng sau."
  },
  VILLAGER: {
    name: "🧑‍🌾 Dân Làng",
    team: "Phe Dân Làng",
    objective: "Tìm ra manh mối, luận tội và treo cổ toàn bộ Sói.",
    ability: "Không có kỹ năng đặc biệt ban đêm. Sức mạnh nằm ở sự suy luận sắc bén và lá phiếu ban ngày."
  }
};

// --- LOGIC PHÒNG GAME ---
const rooms = {};

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
    updateMediaPermissions(room);
    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: '☀️ Trời đã sáng, mọi người thức dậy thảo luận!' });

  } else if (room.phase === 'DAY') {
    room.phase = 'VOTE';
    room.timeLeft = room.settings.voteDuration || 45;
    room.votes = {};
    updateMediaPermissions(room);
    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: '🗳️ Đã đến giờ bỏ phiếu treo cổ ẩn danh!' });

  } else if (room.phase === 'VOTE') {
    processVotesAndExecute(roomId);
  }
}

// Tổng kết kết quả hành động ban đêm
function resolveNightActions(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const wolfTargetSeat = room.nightActions['WOLF_TARGET'];
  const guardTargetSeat = room.nightActions['GUARD_TARGET'];
  const witchHealSeat = room.nightActions['WITCH_HEAL_TARGET'];
  const witchPoisonSeat = room.nightActions['WITCH_POISON_TARGET'];

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
        deadPlayers.push({ seat: targetPlayer.seat, name: targetPlayer.name, role: targetPlayer.role });
      }
    }
  }

  if (witchPoisonSeat !== undefined) {
    let poisonPlayer = Object.values(room.players).find(p => p.seat == witchPoisonSeat);
    if (poisonPlayer && poisonPlayer.isAlive) {
      poisonPlayer.isAlive = false;
      deadPlayers.push({ seat: poisonPlayer.seat, name: poisonPlayer.name, role: poisonPlayer.role });
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

// Xử lý phiếu vote ban ngày
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
        io.to(roomId).emit('notification', { message: `🃏 Ghế #${eliminatedSeat} (${targetPlayer.name}) lật bài là KẺ KHỜ! Thoát chết treo cổ nhưng bị tước quyền vote.` });
      } else {
        targetPlayer.isAlive = false;
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
  io.to(roomId).emit('room_state_update', room);
  io.to(roomId).emit('notification', { message: '🌙 Màn đêm buông xuống...' });
}

// Quản lý quyền Mic/Cam động
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

io.on('connection', (socket) => {
  console.log('Nguoi choi ket noi:', socket.id);

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
          hunters: 1,
          idiots: 1,
          dayDuration: 120,
          nightDuration: 60,
          voteDuration: 45
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
      roleInfo: null, // Gửi kèm thông tin giải thích chức năng hiển thị góc màn hình
      canSpeak: true,
      canCam: true,
      hasUsedHeal: false,
      hasUsedPoison: false,
      idiotRevealed: false
    };

    socket.roomId = roomId;
    updateMediaPermissions(room);
    io.to(roomId).emit('room_state_update', room);
  });

  // Khởi động trận đấu và đính kèm bộ hướng dẫn nhân vật cho từng client
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
      room.players[p.id].hasUsedHeal = false;
      room.players[p.id].hasUsedPoison = false;
      room.players[p.id].idiotRevealed = false;
      
      // Đính kèm dữ liệu mô tả nhân vật để client hiển thị lên góc màn hình riêng biệt
      room.players[p.id].roleInfo = ROLE_DESCRIPTIONS[assignedRole] || ROLE_DESCRIPTIONS['VILLAGER'];
    });

    room.phase = 'NIGHT';
    room.timeLeft = room.settings.nightDuration || 60;
    room.votes = {};
    room.nightActions = {};

    updateMediaPermissions(room);
    startTimer(roomId);
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: '🎮 Trận đấu bắt đầu! Hãy kiểm tra thông tin nhân vật ở góc màn hình.' });
  });

  // Xử lý hành động kỹ năng ban đêm
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

    if (actionType === 'WITCH_HEAL' && (isHostActor || actor.role === 'WITCH')) {
      if (!actor.hasUsedHeal) {
        room.nightActions['WITCH_HEAL_TARGET'] = targetSeat;
        actor.hasUsedHeal = true;
        socket.emit('notification', { message: '🧪 Bạn đã sử dụng Bình Cứu đêm nay.' });
      }
    }

    if (actionType === 'WITCH_POISON' && (isHostActor || actor.role === 'WITCH')) {
      if (!actor.hasUsedPoison) {
        room.nightActions['WITCH_POISON_TARGET'] = targetSeat;
        actor.hasUsedPoison = true;
        socket.emit('notification', { message: '☠️ Bạn đã sử dụng Bình Độc đêm nay.' });
      }
    }

    io.to(roomId).emit('room_state_update', room);
  });

  // Bỏ phiếu ẩn danh ban ngày
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (room && room.phase === 'VOTE') {
      const actor = room.players[socket.id];
      if (!actor || !actor.isAlive || actor.idiotRevealed) return;

      room.votes[socket.id] = targetSeat;
      socket.emit('notification', { message: `🗳️ Đã ghi nhận phiếu bầu ẩn danh cho ghế #${targetSeat}` });
    }
  });

  // Host tùy chỉnh cấu hình phòng
  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      io.to(roomId).emit('room_state_update', room);
    }
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
        io.to(roomId).emit('room_state_update', rooms[roomId]);
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói nâng cao chạy tại port ${PORT}`);
});