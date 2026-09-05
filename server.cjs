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
// Cấu trúc mỗi phòng: { roomId, hostId, phase, timeLeft, players: {}, roleSetup: {} }
const rooms = {};

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
        roleSetup: {}
      };
    }

    const room = rooms[roomId];

    // Nếu người đầu tiên vào phòng tự động làm Host nếu chưa có ai
    if (!room.hostId && isHost) {
      room.hostId = socket.id;
    }

    // Lưu thông tin người chơi
    room.players[socket.id] = {
      id: socket.id,
      name: name || `Khách_${socket.id.substr(0,4)}`,
      seat: parseInt(seat) || 1,
      isHost: room.hostId === socket.id,
      status: 'Alive',
      canSpeak: true,
      canCam: true,
      role: null,
      roleInfo: null
    };

    updateRoomData(roomId);
  });

  // 2. Xử lý Quản Trò bắt đầu ván chơi và nhận roleSetup đầy đủ từ client
  socket.on('start_game', ({ roomId, roleSetup }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('notification', { message: 'Chỉ Quản Trò mới có quyền bắt đầu ván chơi!' });
      return;
    }

    // Lưu cấu hình role và thời gian
    room.roleSetup = roleSetup || {
      wolves: 2, guards: 1, seers: 1, witches: 1, hunters: 1, idiots: 1,
      dayDuration: 120, nightDuration: 60
    };

    room.phase = 'NIGHT';
    room.timeLeft = room.roleSetup.nightDuration;

    // Phân vai trò ngẫu nhiên cho người chơi trong phòng (Bỏ qua Quản Trò)
    assignRoles(room);

    // Gửi trạng thái mới nhất cho toàn bộ client trong phòng
    io.to(roomId).emit('room_state_update', room);
    updateRoomData(roomId);
    io.to(roomId).emit('notification', { message: 'Ván chơi đã bắt đầu! Đã chuyển sang pha Ban Đêm.' });
  });

  // 3. Xử lý chuyển đổi pha (Ngày / Đêm)
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
    }

    io.to(roomId).emit('room_state_update', room);
    io.to(roomId).emit('notification', { message: `Quản trò đã chuyển sang pha: ${phase === 'DAY' ? 'Ban Ngày' : 'Ban Đêm'}` });
  });

  // 4. Xử lý xóa phiếu bầu
  socket.on('clear_votes', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('notification', { message: 'Chỉ Quản Trò mới có quyền xóa phiếu!' });
      return;
    }

    io.to(roomId).emit('notification', { message: 'Quản trò đã làm sạch danh sách phiếu bầu vòng này.' });
  });

  // 5. Ngắt kết nối
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        
        // Nếu host thoát, chuyển quyền host cho người chơi đầu tiên còn lại
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

// Hàm hỗ trợ cập nhật danh sách ghế ngồi và player gửi về client
function updateRoomData(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerList = Object.values(room.players);
  // Ép kiểu seat về số nguyên để client so sánh khớp tuyệt đối
  const takenSeats = playerList.map(p => parseInt(p.seat));

  io.to(roomId).emit('room_update', {
    playerList,
    takenSeats
  });
  io.to(roomId).emit('room_state_update', room);
}

// Hàm phân vai trò ngẫu nhiên dựa trên roleSetup (Loại bỏ Host ra khỏi danh sách nhận role chơi)
function assignRoles(room) {
  // Lọc chỉ lấy những người chơi không phải là Host để chia bài
  const activePlayers = Object.values(room.players).filter(p => !p.isHost);
  const setup = room.roleSetup;

  // Tạo danh sách các role cần phân chia
  let rolePool = [];
  for (let i = 0; i < (setup.wolves || 0); i++) rolePool.push('WOLF');
  for (let i = 0; i < (setup.guards || 0); i++) rolePool.push('GUARD');
  for (let i = 0; i < (setup.seers || 0); i++) rolePool.push('SEER');
  for (let i = 0; i < (setup.witches || 0); i++) rolePool.push('WITCH');
  for (let i = 0; i < (setup.hunters || 0); i++) rolePool.push('HUNTER');
  for (let i = 0; i < (setup.idiots || 0); i++) rolePool.push('IDIOT');

  // Xáo trộn danh sách role ngẫu nhiên
  rolePool.sort(() => Math.random() - 0.5);

  const roleDefinitions = {
    WOLF: { name: 'Ma Sói', team: 'Phe Sói', objective: 'Tiêu diệt toàn bộ dân làng để giành chiến thắng.', ability: 'Thức dậy ban đêm cùng đồng đội để chọn nạn nhân.' },
    GUARD: { name: 'Bảo Vệ', team: 'Phe Dân Làng', objective: 'Bảo vệ dân làng trước sự tấn công của Ma Sói.', ability: 'Chọn một người chơi để bảo vệ mỗi đêm.' },
    SEER: { name: 'Tiên Tri', team: 'Phe Dân Làng', objective: 'Tìm ra kẻ giả mạo và ma sói trong làng.', ability: 'Soi thân phận một người chơi bất kỳ vào ban đêm.' },
    WITCH: { name: 'Phù Thủy', team: 'Phe Dân Làng', objective: 'Sử dụng bình dược cứu người hoặc tiêu diệt kẻ xấu.', ability: 'Có 1 bình cứu và 1 bình độc.' },
    HUNTER: { name: 'Thợ Săn', team: 'Phe Dân Làng', objective: 'Kéo theo một kẻ khác xuống mồ khi chết.', ability: 'Có thể kéo theo một người khi bị hạ sát.' },
    IDIOT: { name: 'Thần Khờ', team: 'Phe Dân Làng', objective: 'Sống sót và che giấu thân phận.', ability: 'Miễn chết một lần khi bị treo cổ ban ngày.' },
    VILLAGER: { name: 'Dân Làng', team: 'Phe Dân Làng', objective: 'Tìm ra Ma Sói thông qua suy luận và biểu quyết.', ability: 'Bỏ phiếu treo cổ nghi phạm ban ngày.' }
  };

  activePlayers.forEach((player, index) => {
    const roleKey = rolePool[index] || 'VILLAGER';
    player.role = roleKey;
    player.roleInfo = roleDefinitions[roleKey] || roleDefinitions['VILLAGER'];
  });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server Ma Sói đang chạy tại cổng ${PORT}`);
});