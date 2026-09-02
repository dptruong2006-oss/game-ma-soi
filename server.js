import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole } = pkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// =========================================================================
// THÔNG TIN AGORA CONSOLE ĐÃ ĐƯỢC ĐIỀN TỰ ĐỘNG
// =========================================================================
const AGORA_APP_ID = "74fafa51c6714624bd251133041297d6";
const AGORA_APP_CERTIFICATE = "ed245f7beda24faab0f5647571b388c2";

// API tự động sinh Agora Token theo mã phòng
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: 'Thiếu channelName' });
  }

  const expirationTimeInSeconds = 3600 * 24; // Token có hiệu lực trong 24 giờ
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    0, // UID = 0 để Agora tự cấp ID
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );

  return res.json({ token });
});

// Lưu trữ dữ liệu tất cả phòng chơi trên RAM của máy chủ
const rooms = {};

io.on('connection', (socket) => {
  console.log(`Người chơi kết nối: ${socket.id}`);

  // Thao tác 1: Tham gia hoặc Tạo phòng Ma Sói
  socket.on('join_room', ({ roomId, name, avatar, isAdmin }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        adminId: isAdmin ? socket.id : null,
        status: 'LOBBY',
        players: {},
        votes: {},
        actionLog: { wolfTarget: null }
      };
    }
    if (isAdmin) rooms[roomId].adminId = socket.id;

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name,
      avatar: avatar || 'https://dicebear.com' + name,
      role: 'UNASSIGNED',
      isAlive: true,
      isMuted: false
    };

    io.to(roomId).emit('room_updated', sanitizeGameState(rooms[roomId]));
  });

  // Thao tác 2: Quản trò (Admin) bấm nút tự động chia vai trò bảo mật
  socket.on('assign_roles', ({ roomId, roleMapping }) => {
    const room = rooms[roomId];
    if (!room) return;

    Object.keys(roleMapping).forEach((pId) => {
      if (room.players[pId]) {
        room.players[pId].role = roleMapping[pId];
        // Gửi bí mật vai trò về riêng máy của người chơi đó thôi
        io.to(pId).emit('your_role', { role: roleMapping[pId] });
      }
    });

    room.status = 'NIGHT';
    io.to(roomId).emit('room_updated', sanitizeGameState(room));
  });

  // Thao tác 3: Xử lý Ma Sói chọn mục tiêu cắn trong đêm
  socket.on('wolf_attack', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || room.players[socket.id]?.role !== 'WEREWOLF') return;

    room.actionLog.wolfTarget = targetId;
    
    // Gửi đồng bộ để các con sói khác trong phòng nhìn thấy mục tiêu đang chọn
    Object.keys(room.players).forEach(pId => {
      if (room.players[pId].role === 'WEREWOLF') {
        io.to(pId).emit('wolf_target_updated', { targetId });
      }
    });
  });

  // Thao tác 4: Kích hoạt hiệu ứng tử vong Anime Slash khi có người bị giết
  socket.on('trigger_death', ({ roomId, targetId, reason }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players[targetId]) {
      room.players[targetId].isAlive = false;
      room.players[targetId].isMuted = true; // Chết thì tắt tiếng không cho nhắc bài

      // Phát tín hiệu chém cho TẤT CẢ mọi người cùng thấy
      io.to(roomId).emit('player_slashed', { targetId, reason });
      
      // Đợi 1.5 giây cho hiệu ứng chạy xong rồi mới cập nhật danh sách phòng
      setTimeout(() => {
        io.to(roomId).emit('room_updated', sanitizeGameState(room));
      }, 1500);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Người chơi ngắt kết nối: ${socket.id}`);
  });
});

// Hàm bảo mật: Giấu vai trò của người chơi khác trước khi gửi thông tin phòng về máy client
function sanitizeGameState(room) {
  const publicPlayers = {};
  Object.keys(room.players).forEach((id) => {
    publicPlayers[id] = { ...room.players[id], role: 'HIDDEN' }; 
  });
  return { ...room, players: publicPlayers };
}

server.listen(4000, () => console.log('Máy chủ Ma Sói đang chạy ở cổng 4000!'));