const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Lưu trữ trạng thái các phòng chơi
const rooms = {};

// API tạo token giả lập / đơn giản cho Agora RTC theo channelName
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName || 'test-channel';
  // Trả về token null hoặc chuỗi token tùy chỉnh nếu dùng cơ chế app certificate của Agora
  res.json({ token: null, channel: channelName });
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Xử lý người chơi tham gia phòng
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        hostId: isHost ? socket.id : null,
        phase: 'LOBBY',
        timeLeft: 0,
        players: {},
        roleSetup: {},
        nightActions: {
          wolfTarget: null,
          guardTarget: null,
          witchHeal: null,
          witchKill: null,
          seerTarget: null
        },
        votes: {}
      };
    }

    const room = rooms[roomId];

    if (!room.hostId && isHost) {
      room.hostId = socket.id;
    }

    room.players[socket.id] = {
      id: socket.id,
      socketId: socket.id,
      name: name || `Khách_${socket.id.substr(0,4)}`,
      seat: parseInt(seat) || 1,
      isHost: room.hostId === socket.id,
      isAlive: true,
      role: null,
      roleInfo: null
    };

    updateRoomData(roomId);
  });

  // 2. Xử lý Quản Trò bắt đầu ván chơi
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('notification', { message: 'Chỉ Quản Trò mới có quyền bắt đầu ván chơi!' });
      return;
    }

    room.roleSetup = {
      wolves: 2, guards: 1, seers: 1, witches: 1, hunters: 1, idiots: 1,
      dayDuration: 120, nightDuration: 60
    };

    room.phase = 'NIGHT';
    room.timeLeft = room.roleSetup.nightDuration;
    room.nightActions = { wolfTarget: null, guardTarget: null, witchHeal: null, witchKill: null, seerTarget: null };
    room.votes = {};

    assignRoles(room);

    io.to(roomId).emit('room_state_update', room);
    updateRoomData(roomId);
    io.to(roomId).emit('notification', { message: '🐺 Ván chơi đã bắt đầu! Đã chuyển sang pha Ban Đêm.' });
  });

  // 3. Xử lý chuyển đổi pha (Ngày / Đêm / Vote)
  socket.on('change_phase', ({ roomId, phase }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('notification', { message: 'Chỉ Quản Trò mới có quyền đổi pha!' });
      return;
    }

    room.phase = phase;
    if (phase === 'DAY') {
      room.timeLeft = room.roleSetup.dayDuration || 120;
    } else if (phase === 'NIGHT') {
      room.timeLeft = room.roleSetup.nightDuration || 60;
      room.nightActions = { wolfTarget: null, guardTarget: null, witchHeal: null, witchKill: null, seerTarget: null };
    } else if (phase === 'VOTE') {
      room.votes = {};
    }

    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `🔔 Quản trò đã chuyển sang pha: ${phase === 'DAY' ? 'Ban Ngày' : phase === 'NIGHT' ? 'Ban Đêm' : 'Bỏ Phiếu Kín'}` });
  });

  // 4. Xử lý kỹ năng ban đêm
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.isAlive) return;

    if (actionType === 'WOLF' && player.role === 'WOLF') {
      room.nightActions.wolfTarget = targetSeat;
      io.to(roomId).emit('notification', { message: `🐺 Sói đã chọn mục tiêu cắn trong đêm.` });
    } else if (actionType === 'GUARD' && player.role === 'GUARD') {
      room.nightActions.guardTarget = targetSeat;
      io.to(roomId).emit('notification', { message: `🛡️ Bảo vệ đã chọn người che chở.` });
    } else if (actionType === 'SEER' && player.role === 'SEER') {
      const targetPlayer = Object.values(room.players).find(p => parseInt(p.seat) === parseInt(targetSeat));
      if (targetPlayer) {
        const isWolf = targetPlayer.role === 'WOLF';
        socket.emit('seer_result', { seat: targetSeat, name: targetPlayer.name, isWolf });
      }
    } else if (actionType === 'WITCH_HEAL' && player.role === 'WITCH') {
      room.nightActions.witchHeal = targetSeat;
      io.to(roomId).emit('notification', { message: `🧪 Phù thủy đã sử dụng bình cứu.` });
    } else if (actionType === 'WITCH_KILL' && player.role === 'WITCH') {
      room.nightActions.witchKill = targetSeat;
      io.to(roomId).emit('notification', { message: `🧪 Phù thủy đã sử dụng bình độc.` });
    }
  });

  // 5. Xử lý bỏ phiếu ban ngày
  socket.on('cast_vote', ({ roomId, targetSeat }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || !player.isAlive) return;

    room.votes[socket.id] = targetSeat;
    io.to(roomId).emit('notification', { message: `🗳️ ${player.name} đã bỏ phiếu!` });
  });

  // 6. Xử lý xóa phiếu bầu
  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('notification', { message: 'Chỉ Quản Trò mới có quyền xóa phiếu!' });
      return;
    }

    room.votes = {};
    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: '🧹 Quản trò đã làm sạch danh sách phiếu bầu vòng này.' });
  });

  // 7. Kênh Chat Sói
  socket.on('send_wolf_chat', ({ roomId, message, sender }) => {
    io.to(roomId).emit('receive_wolf_chat', { sender, message });
  });

  // 8. Kênh Chat Âm Phủ
  socket.on('send_ghost_chat', ({ roomId, message, sender }) => {
    io.to(roomId).emit('receive_ghost_chat', { sender, message });
  });

  // 9. Ngắt kết nối
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        
        if (room.hostId === socket.id) {
          const remainingPlayers = Object.values(room.players);
          if (remainingPlayers.length > 0) {
            room.hostId = remainingPlayers[0].id;
            room.players[room.hostId].isHost = true;
          } else {
            delete rooms[roomId];
            break;
          }
        }
        updateRoomData(roomId);
      }
    }
  });
});

function updateRoomData(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerList = Object.values(room.players);
  const takenSeats = playerList.map(p => parseInt(p.seat));

  io.to(roomId).emit('room_update', { playerList, takenSeats });
  io.to(roomId).emit('room_state_update', room);
}

function assignRoles(room) {
  const activePlayers = Object.values(room.players);
  const setup = room.roleSetup;

  let rolePool = [];
  for (let i = 0; i < (setup.wolves || 0); i++) rolePool.push('WOLF');
  for (let i = 0; i < (setup.guards || 0); i++) rolePool.push('GUARD');
  for (let i = 0; i < (setup.seers || 0); i++) rolePool.push('SEER');
  for (let i = 0; i < (setup.witches || 0); i++) rolePool.push('WITCH');
  for (let i = 0; i < (setup.hunters || 0); i++) rolePool.push('HUNTER');
  for (let i = 0; i < (setup.idiots || 0); i++) rolePool.push('IDIOT');

  while (rolePool.length < activePlayers.length) {
    rolePool.push('VILLAGER');
  }

  rolePool.sort(() => Math.random() - 0.5);

  activePlayers.forEach((player, index) => {
    const roleKey = rolePool[index] || 'VILLAGER';
    player.role = roleKey;
  });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói đang chạy tại cổng ${PORT}`);
});