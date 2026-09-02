import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole } = pkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// =========================================================================
// THÔNG TIN AGORA CONSOLE
// =========================================================================
const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475"; // Khớp với App ID bên App.jsx của bạn
const AGORA_APP_CERTIFICATE = "ed245f7beda24faab0f5647571b388c2";

// API tự động sinh Agora Token theo mã phòng
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: 'Thiếu channelName' });
  }

  const expirationTimeInSeconds = 3600 * 24; 
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    0, 
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );

  return res.json({ token });
});

// Lưu trữ dữ liệu tất cả phòng chơi trên RAM của máy chủ
const rooms = {};

io.on('connection', (socket) => {
  console.log(`Người chơi kết nối: ${socket.id}`);

  // Thao tác 1: Tham gia phòng chơi với Mã Phòng (roomId) và Vị trí Ghế (seat)
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        phase: 'Đang chờ tập hợp người chơi',
        players: {}
      };
    }

    // Lưu thông tin người chơi khớp với cấu trúc Frontend
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name,
      seat: parseInt(seat),
      isHost: !!isHost,
      role: 'HIDDEN',
      isAlive: true
    };

    // Gửi đồng bộ trạng thái phòng về cho TẤT CẢ mọi người trong phòng
    io.to(roomId).emit('room_state_update', rooms[roomId]);
    console.log(`User [${name}] đã vào phòng [${roomId}] tại ghế số [${seat}]`);
  });

  // Thao tác 2: Nhận quyền Quản Trò (Host)
  socket.on('claim_host', ({ roomId, socketId }) => {
    const room = rooms[roomId];
    if (room && room.players[socketId]) {
      // Kiểm tra xem phòng đã có ai làm Host chưa
      const hasHostAlready = Object.values(room.players).some(p => p.isHost);
      if (!hasHostAlready) {
        room.players[socketId].isHost = true;
        io.to(roomId).emit('room_state_update', room);
      }
    }
  });

  // Thao tác 3: Khi người chơi ngắt kết nối hoặc thoát phòng
  socket.on('disconnect', () => {
    console.log(`Người chơi ngắt kết nối: ${socket.id}`);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        
        // Nếu phòng không còn ai, xóa phòng để giải phóng bộ nhớ
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('room_state_update', rooms[roomId]);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Máy chủ Ma Sói đang chạy ở cổng ${PORT}!`));