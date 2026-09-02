import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole } = pkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475";
const AGORA_APP_CERTIFICATE = "ed245f7beda24faab0f5647571b388c2";

// API cấp phát Agora Token dựa theo mã phòng (roomId làm channelName)
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) return res.status(400).json({ error: 'Thiếu channelName' });

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    0,
    RtcRole.PUBLISHER,
    Math.floor(Date.now() / 1000) + 86400
  );
  return res.json({ token });
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Người chơi kết nối: ${socket.id}`);

  // Tham gia phòng và đồng bộ cấu trúc ghế, trạng thái
  socket.on('join_room', ({ roomId, name, seat, isHost }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        phase: 'LOBBY',
        players: {},
        nightActions: {
          wolfTarget: null,
          guardTarget: null,
          witchSave: null,
          witchKill: null
        }
      };
    }

    const room = rooms[roomId];
    const hasHost = Object.values(room.players).some(p => p.isHost);
    const assignedHost = isHost || !hasHost;

    room.players[socket.id] = {
      id: socket.id,
      name,
      seat: parseInt(seat),
      isHost: assignedHost,
      role: 'HIDDEN',
      isAlive: true,
      statusEffect: null
    };

    io.to(roomId).emit('room_state_update', room);
  });

  // Quản trò phân vai trò
  socket.on('assign_roles', ({ roomId, roleMapping }) => {
    const room = rooms[roomId];
    if (!room) return;

    Object.keys(roleMapping).forEach((pId) => {
      if (room.players[pId]) {
        room.players[pId].role = roleMapping[pId];
        io.to(pId).emit('your_role', { role: roleMapping[pId] });
      }
    });

    room.phase = 'NIGHT';
    io.to(roomId).emit('room_state_update', room);
  });

  // Xử lý hành động ban đêm (Sói, Bảo vệ, Phù thủy) kèm hiệu ứng ẩn cho Quản trò
  socket.on('night_action', ({ roomId, actionType, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const senderRole = room.players[socket.id]?.role;

    if (actionType === 'WOLF_ATTACK' && senderRole === 'WEREWOLF') {
      room.nightActions.wolfTarget = targetId;
      Object.keys(room.players).forEach(pId => {
        room.players[pId].statusEffect = (pId === targetId) ? 'WOLF_TARGET' : (room.players[pId].statusEffect === 'WOLF_TARGET' ? null : room.players[pId].statusEffect);
      });
    } else if (actionType === 'GUARD_PROTECT' && senderRole === 'GUARD') {
      room.nightActions.guardTarget = targetId;
      Object.keys(room.players).forEach(pId => {
        if (room.players[pId].statusEffect === 'GUARDED') room.players[pId].statusEffect = null;
      });
      if (room.players[targetId]) room.players[targetId].statusEffect = 'GUARDED';
    } else if (actionType === 'WITCH_SAVE' && senderRole === 'WITCH') {
      room.nightActions.witchSave = targetId;
      if (room.players[targetId]) room.players[targetId].statusEffect = 'WITCH_SAVED';
    } else if (actionType === 'WITCH_KILL' && senderRole === 'WITCH') {
      room.nightActions.witchKill = targetId;
      if (room.players[targetId]) room.players[targetId].statusEffect = 'WITCH_KILLED';
    }

    io.to(roomId).emit('room_state_update', room);
  });

  // Xử lý tử vong
  socket.on('trigger_death', ({ roomId, targetId, reason }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players[targetId]) {
      room.players[targetId].isAlive = false;
      room.players[targetId].statusEffect = 'DEAD';
      io.to(roomId).emit('player_slashed', { targetId, reason });
      
      setTimeout(() => {
        io.to(roomId).emit('room_state_update', room);
      }, 1500);
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
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
server.listen(PORT, () => console.log(`Server chạy cổng ${PORT}`));