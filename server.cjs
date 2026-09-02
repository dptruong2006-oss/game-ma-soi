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

const APP_ID = "f8b9cc77ff234823b6e4685127ebf475";
const APP_CERTIFICATE = process.env.APP_CERTIFICATE || "74fafa51c6714624bd251133041297d6";

app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: 'channelName is required' });
  }

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
        players: {},
        settings: {
          wolfCount: 2,
          guardCount: 1,
          seerCount: 1,
          witchCount: 1
        }
      };
    }

    const room = rooms[roomId];
    const existingHost = Object.values(room.players).find(p => p.isHost);

    // Kiểm tra bảo mật: Nếu phòng đã có Host mà người mới cố tình nhận làm Host thì ép về false
    let finalIsHost = !!isHost;
    if (finalIsHost && existingHost && existingHost.id !== socket.id) {
      finalIsHost = false; 
    }

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat,
      isHost: finalIsHost,
      role: null,
      statusEffect: null
    };

    io.to(roomId).emit('room_state_update', room);
  });

  // Quản trò thay đổi cài đặt số lượng các chức năng
  socket.on('update_settings', ({ roomId, settings }) => {
    const room = rooms[roomId];
    if (room && room.players[socket.id]?.isHost) {
      room.settings = { ...room.settings, ...settings };
      io.to(roomId).emit('room_state_update', room);
    }
  });

  // Bắt đầu game: Random chức năng theo đúng định mức cài đặt của Host
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]?.isHost) return;

    const playerIds = Object.keys(room.players);
    const totalPlayers = playerIds.length;
    
    const { wolfCount = 2, guardCount = 1, seerCount = 1, witchCount = 1 } = room.settings;

    let rolesPool = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('WOLF');
    for (let i = 0; i < guardCount; i++) rolesPool.push('GUARD');
    for (let i = 0; i < seerCount; i++) rolesPool.push('SEER');
    for (let i = 0; i < witchCount; i++) rolesPool.push('WITCH');

    // Nếu tổng chức năng lớn hơn số người chơi, cắt bớt hoặc cân đối, nếu thiếu thì bù Dân làng
    if (rolesPool.length > totalPlayers) {
      rolesPool = rolesPool.slice(0, totalPlayers);
    }

    while (rolesPool.length < totalPlayers) {
      rolesPool.push('VILLAGER');
    }

    // Xáo trộn ngẫu nhiên vai trò
    rolesPool.sort(() => Math.random() - 0.5);

    playerIds.forEach((id, index) => {
      room.players[id].role = rolesPool[index];
      room.players[id].statusEffect = null;
    });

    room.phase = 'NIGHT';
    io.to(roomId).emit('room_state_update', room);
  });

  // Xử lý hiệu ứng kỹ năng ban đêm
  socket.on('apply_night_action', ({ roomId, targetSeat, actionType }) => {
    const room = rooms[roomId];
    if (!room) return;

    const targetPlayer = Object.values(room.players).find(p => p.seat === targetSeat);
    if (!targetPlayer) return;

    if (actionType === 'GUARD') {
      Object.values(room.players).forEach(p => {
        if (p.statusEffect === 'GUARDED') p.statusEffect = null;
      });
      targetPlayer.statusEffect = 'GUARDED';
    } else if (actionType === 'WOLF') {
      Object.values(room.players).forEach(p => {
        if (p.statusEffect === 'WOLF_TARGET') p.statusEffect = null;
      });
      targetPlayer.statusEffect = 'WOLF_TARGET';
    } else if (actionType === 'WITCH_SAVE') {
      if (targetPlayer.statusEffect === 'WOLF_TARGET') {
        targetPlayer.statusEffect = 'WITCH_SAVED';
      }
    } else if (actionType === 'WITCH_KILL') {
      targetPlayer.statusEffect = 'WITCH_KILLED';
    } else if (actionType === 'SEER_CHECK') {
      socket.emit('seer_result', {
        seat: targetSeat,
        name: targetPlayer.name,
        isWolf: targetPlayer.role === 'WOLF'
      });
    }

    io.to(roomId).emit('room_state_update', room);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else {
          // Nếu Host thoát, tự động nhường quyền Host cho người chơi đầu tiên còn lại (nếu muốn) hoặc giữ nguyên
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