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

// Điền đúng Agora App ID và App Certificate của bạn vào đây
const APP_ID = "f8b9cc77ff234823b6e4685127ebf475";
const APP_CERTIFICATE = "0cbf0662ae14467c87c7068593ec2b99"; // Nhớ thay mã Certificate chính xác từ Agora Console nếu cần

// API cấp token Agora cho client
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: 'channelName is required' });
  }

  // Sử dụng uid dạng số hoặc 0 cho việc cấp quyền cơ bản
  const uid = 0; 
  const role = RtcRole.PUBLISHER;
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );
    return res.json({ token });
  } catch (err) {
    console.error("Lỗi tạo Agora Token:", err);
    return res.status(500).json({ error: "Failed to generate token" });
  }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        phase: 'LOBBY',
        players: {}
      };
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name,
      seat,
      isHost: !!isHost,
      statusEffect: null
    };

    io.to(roomId).emit('room_state_update', rooms[roomId]);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
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