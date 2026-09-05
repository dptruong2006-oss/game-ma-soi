import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:10000' : '';
const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Danh sách bộ nhân vật chuẩn Ma Sói nâng cao
const ROLES_CONFIG = {
  WOLF: { name: 'Ma Sói 🐺', team: 'Phe Sói', ability: 'Thức dậy ban đêm cùng đồng đội để chọn cắn một người chơi.' },
  VILLAGER: { name: 'Dân Làng 🧑', team: 'Phe Dân', ability: 'Không có kỹ năng đặc biệt, dùng lý luận ban ngày để tìm Sói.' },
  SEER: { name: 'Tiên Tri 🔮', team: 'Phe Dân', ability: 'Mỗi đêm được soi danh tính một người chơi xem có phải Sói không.' },
  GUARD: { name: 'Bảo Vệ 🛡️', team: 'Phe Dân', ability: 'Mỗi đêm chọn bảo vệ một người không bị Sói cắn (không được bảo vệ 2 đêm liền 1 người).' },
  WITCH: { name: 'Phù Thủy 🧪', team: 'Phe Dân', ability: 'Có 1 bình cứu (hồi sinh nạn nhân ban đêm) và 1 bình độc (giết chết 1 người).' },
  HUNTER: { name: 'Thợ Săn 🏹', team: 'Phe Dân', ability: 'Khi chết có quyền kéo theo một người chơi khác chết cùng.' },
  IDIOT: { name: 'Kẻ Khờ 🤡', team: 'Phe Dân', ability: 'Nếu bị dân làng treo cổ ban ngày, sẽ lật bài và được miễn chết, tiếp tục chơi nhưng mất quyền vote.' }
};

export default function App() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState(() => localStorage.getItem('werewolf_room') || '');
  const [name, setName] = useState(() => localStorage.getItem('werewolf_name') || '');
  const [seat, setSeat] = useState(() => localStorage.getItem('werewolf_seat') || 1);
  const [isHost, setIsHost] = useState(() => localStorage.getItem('werewolf_ishost') === 'true');

  const [socket, setSocket] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [myRoleInfo, setMyRoleInfo] = useState(null);
  const [myRoleKey, setMyRoleKey] = useState(null);
  const [notification, setNotification] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);

  // Kênh chat riêng của Sói ban đêm
  const [wolfChatOpen, setWolfChatOpen] = useState(false);
  const [wolfMessages, setWolfMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Kênh chat/thoại dành riêng cho người chết
  const [ghostChatOpen, setGhostChatOpen] = useState(false);
  const [ghostMessages, setGhostMessages] = useState([]);
  const [ghostInput, setGhostInput] = useState('');

  // Trạng thái Media & Âm thanh
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const localAudioTrack = useRef(null);
  const localVideoTrack = useRef(null);

  const [slashEffect, setSlashEffect] = useState(false);
  const [shakeScreen, setShakeScreen] = useState(false);
  const audioDayRef = useRef(null);
  const audioNightRef = useRef(null);

  useEffect(() => {
    const savedRoom = localStorage.getItem('werewolf_room');
    const savedName = localStorage.getItem('werewolf_name');
    if (savedRoom && savedName) setInRoom(true);
  }, []);

  useEffect(() => {
    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);

    const savedRoom = localStorage.getItem('werewolf_room');
    const savedName = localStorage.getItem('werewolf_name');
    const savedSeat = localStorage.getItem('werewolf_seat');
    const savedHost = localStorage.getItem('werewolf_ishost') === 'true';

    if (savedRoom && savedName) {
      newSocket.emit('join_room', { roomId: savedRoom, name: savedName, seat: parseInt(savedSeat), isHost: savedHost });
      initAgoraChannel(savedRoom);
    }

    newSocket.on('room_state_update', (room) => {
      setRoomData(room);
      setTimeLeft(room.timeLeft);
      const me = Object.values(room.players || {}).find(p => p.id === newSocket.id || p.socketId === newSocket.id);
      if (me) {
        if (me.role) {
          setMyRoleKey(me.role);
          setMyRoleInfo(ROLES_CONFIG[me.role] || me.roleInfo);
        }

        if (localAudioTrack.current) {
          const allowedToSpeak = me.isAlive ? (room.phase !== 'NIGHT') : true; 
          localAudioTrack.current.setEnabled(allowedToSpeak && micOn);
        }
      }
    });

    newSocket.on('timer_update', ({ timeLeft }) => setTimeLeft(timeLeft));

    newSocket.on('notification', ({ message }) => {
      setNotification(message);
      if (message.includes('💀') || message.includes('ngã xuống') || message.includes('cắn')) {
        setSlashEffect(true);
        setShakeScreen(true);
        setTimeout(() => {
          setSlashEffect(false);
          setShakeScreen(false);
        }, 1000);
      }
      setTimeout(() => setNotification(''), 4500);
    });

    newSocket.on('receive_wolf_chat', (data) => setWolfMessages(prev => [...prev, data]));
    newSocket.on('receive_ghost_chat', (data) => setGhostMessages(prev => [...prev, data]));

    newSocket.on('seer_result', (data) => {
      alert(`🔮 [KẾT QUẢ SOI TIÊN TRI]: Ghế #${data.seat} (${data.name}) -> ${data.isWolf ? '⚠️ ĐÂY LÀ SÓI!' : '🛡️ DÂN THƯỜNG / HÒA BÌNH'}`);
    });

    return () => newSocket.close();
  }, []);

  useEffect(() => {
    const isNight = roomData?.phase === 'NIGHT';
    if (audioDayRef.current && audioNightRef.current) {
      if (isNight) {
        audioDayRef.current.pause();
        audioNightRef.current.play().catch(() => {});
      } else {
        audioNightRef.current.pause();
        audioDayRef.current.play().catch(() => {});
      }
    }
  }, [roomData?.phase]);

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!roomId || !name) return alert('Vui lòng nhập tên và mã phòng!');

    localStorage.setItem('werewolf_room', roomId);
    localStorage.setItem('werewolf_name', name);
    localStorage.setItem('werewolf_seat', seat);
    localStorage.setItem('werewolf_ishost', isHost);

    socket.emit('join_room', { roomId, name, seat: parseInt(seat), isHost });
    setInRoom(true);
    initAgoraChannel(roomId);
  };

  const initAgoraChannel = async (channel) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/agora-token?channelName=${channel}`);
      const data = await response.json();
      const token = data.token;
      const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475";

      await client.join(AGORA_APP_ID, channel, token || null, null);
      localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
      localVideoTrack.current = await AgoraRTC.createCameraVideoTrack();
      await client.publish([localAudioTrack.current, localVideoTrack.current]);

      setTimeout(() => {
        if (localVideoTrack.current) localVideoTrack.current.play('my-local-video');
      }, 300);

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'video') {
          setTimeout(() => {
            const remoteContainer = document.getElementById(`remote-video-${user.uid}`);
            if (remoteContainer) user.videoTrack.play(remoteContainer);
          }, 200);
        }
        if (mediaType === 'audio') user.audioTrack.play();
      });
    } catch (error) {
      console.error("Lỗi khởi tạo Agora:", error);
    }
  };

  const toggleMic = async () => {
    if (localAudioTrack.current) {
      const newState = !micOn;
      await localAudioTrack.current.setEnabled(newState);
      setMicOn(newState);
    }
  };

  const toggleCam = async () => {
    if (localVideoTrack.current) {
      const newState = !camOn;
      await localVideoTrack.current.setEnabled(newState);
      setCamOn(newState);
    }
  };

  const leaveRoom = () => {
    localStorage.clear();
    window.location.reload();
  };

  const startGame = () => socket.emit('start_game', { roomId });
  const changePhase = (phase) => socket.emit('change_phase', { roomId, phase });
  const clearVotes = () => socket.emit('clear_votes', { roomId });

  const handleActionOnSeat = (targetSeat) => {
    const phase = roomData?.phase;
    const me = Object.values(roomData?.players || {}).find(p => p.id === socket?.id || p.socketId === socket?.id);
    
    if (me && !me.isAlive) {
      return alert('👻 Bạn đã chết, không thể sử dụng kỹ năng hay tương tác!');
    }

    if (phase === 'NIGHT') {
      if (myRoleKey === 'WOLF') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WOLF' });
        alert(`🐺 Sói đã chọn cắn ghế #${targetSeat}`);
      } else if (myRoleKey === 'GUARD') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'GUARD' });
        alert(`🛡️ Đã bảo vệ ghế #${targetSeat}`);
      } else if (myRoleKey === 'SEER') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'SEER_CHECK' });
      } else if (myRoleKey === 'WITCH') {
        const action = prompt("🧪 Phù Thủy chọn bình:\n1. Cứu (Nhập 'heal')\n2. Độc sát (Nhập 'kill')");
        if (action === 'heal') socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WITCH_HEAL' });
        if (action === 'kill') socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WITCH_KILL' });
      }
    } else if (phase === 'VOTE') {
      socket.emit('cast_vote', { roomId, targetSeat });
      alert(`🗳️ Đã bỏ phiếu kín cho ghế #${targetSeat}.`);
    }
  };

  if (!inRoom) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>🐺 MA SÓI ULTIMATE 🌙</h1>
          <form onSubmit={handleJoinRoom} style={styles.form}>
            <input style={styles.input} placeholder="Tên nhân vật..." value={name} onChange={e => setName(e.target.value)} />
            <input style={styles.input} placeholder="Mã phòng..." value={roomId} onChange={e => setRoomId(e.target.value)} />
            <div style={styles.row}>
              <label style={{ color: '#94a3b8', fontSize: '14px' }}>Chọn ghế ngồi:</label>
              <select style={styles.select} value={seat} onChange={e => setSeat(e.target.value)}>
                {[...Array(20)].map((_, i) => <option key={i+1} value={i+1}>Ghế #{i+1}</option>)}
              </select>
            </div>
            <div style={styles.checkboxRow}>
              <input type="checkbox" id="host" checked={isHost} onChange={e => setIsHost(e.target.checked)} />
              <label htmlFor="host" style={{ color: '#e2e8f0', cursor: 'pointer' }}>Đăng ký quản trò (Host)</label>
            </div>
            <button type="submit" style={styles.btnPrimary}>Vào Bàn Chơi</button>
          </form>
        </div>
      </div>
    );
  }

  const isNight = roomData?.phase === 'NIGHT';
  const me = Object.values(roomData?.players || {}).find(p => p.id === socket?.id || p.socketId === socket?.id);
  const isDead = me && !me.isAlive;

  const playersMap = {};
  if (roomData?.players) {
    const playerArray = Array.isArray(roomData.players) 
      ? roomData.players 
      : Object.values(roomData.players);

    playerArray.forEach(p => {
      if (p && p.seat) {
        playersMap[parseInt(p.seat, 10)] = p;
      }
    });
  }

  return (
    <div className={shakeScreen ? 'shake-anim' : ''} style={{ ...styles.roomContainer, background: isNight ? '#020617' : '#0f172a' }}>
      <style>{`
        @keyframes floatGhost { 0% { transform: translateY(0) scale(1); opacity: 0.3; } 50% { transform: translateY(-25px) scale(1.15); opacity: 0.7; } 100% { transform: translateY(0) scale(1); opacity: 0.3; } }
        @keyframes floatCute { 0% { transform: translateY(0) rotate(0); opacity: 0.6; } 50% { transform: translateY(-15px) rotate(10deg); opacity: 1; } 100% { transform: translateY(0) rotate(0); opacity: 0.6; } }
        @keyframes shake { 0%, 100% { transform: translate(0, 0); } 20%, 60% { transform: translate(-4px, 2px); } 40%, 80% { transform: translate(4px, -2px); } }
        .shake-anim { animation: shake 0.5s ease-in-out; }
        .ghost { animation: floatGhost 4s ease-in-out infinite; }
        .cute { animation: floatCute 3s ease-in-out infinite; }
      `}</style>

      <audio ref={audioDayRef} src="https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf756.mp3?filename=mysterious-aperitif-111710.mp3" loop />
      <audio ref={audioNightRef} src="https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=horror-ambience-10654.mp3" loop />

      <div style={styles.overlayContainer}>
        {isNight ? (
          <>
            <div className="ghost" style={{ ...styles.floating, top: '12%', left: '8%' }}>👻</div>
            <div className="ghost" style={{ ...styles.floating, top: '68%', right: '8%', animationDelay: '2s' }}>🦇</div>
          </>
        ) : (
          <>
            <div className="cute" style={{ ...styles.floating, top: '15%', left: '6%' }}>🌸</div>
            <div className="cute" style={{ ...styles.floating, top: '72%', right: '6%', animationDelay: '1.5s' }}>⭐</div>
          </>
        )}
      </div>

      {slashEffect && <div style={styles.slash} />}

      <header style={styles.header}>
        <button style={styles.btnDanger} onClick={leaveRoom}>🚪 Rời Phòng</button>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: '#c084fc', margin: 0 }}>PHÒNG: {roomId}</h2>
          <span style={{ fontSize: '13px', color: isNight ? '#38bdf8' : '#fbbf24' }}>
            {isNight ? '🌙 ĐÊM (Sói hành động, Dân im lặng)' : '☀️ BAN NGÀY (Thảo luận & Treo cổ)'} | Còn lại: <b>{timeLeft}s</b>
          </span>

        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ ...styles.btnMedia, background: micOn ? '#10b981' : '#ef4444' }} onClick={toggleMic}>{micOn ? '🎤 Mic Bật' : '🔇 Mic Tắt'}</button>
          <button style={{ ...styles.btnMedia, background: camOn ? '#3b82f6' : '#ef4444' }} onClick={toggleCam}>{camOn ? '📹 Cam Bật' : '📷 Cam Tắt'}</button>
          
          {myRoleKey === 'WOLF' && isNight && (
            <button style={{ ...styles.btnMedia, background: '#8b5cf6' }} onClick={() => setWolfChatOpen(!wolfChatOpen)}>💬 Chat Sói</button>
          )}

          {isDead && (
            <button style={{ ...styles.btnMedia, background: '#64748b' }} onClick={() => setGhostChatOpen(!ghostChatOpen)}>👻 Chat Âm Phủ</button>
          )}
        </div>
      </header>

      {notification && <div style={styles.notif}>{notification}</div>}

      {isHost && (
        <div style={styles.hostPanel}>
          <h3 style={{ margin: '0 0 8px 0', color: '#fbbf24' }}>👑 Quản Trò Điều Khiển</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button style={styles.btnAction} onClick={() => changePhase('NIGHT')}>🌙 Sang Đêm</button>
            <button style={styles.btnAction} onClick={() => changePhase('DAY')}>☀️ Sang Ngày</button>
            <button style={styles.btnAction} onClick={() => changePhase('VOTE')}>🗳️ Mở Vote Kín</button>
            <button style={styles.btnAction} onClick={clearVotes}>🧹 Xóa Phiếu</button>
            <button style={{ ...styles.btnAction, background: '#10b981' }} onClick={startGame}>🚀 Bắt Đầu Ván</button>
          </div>
        </div>
      )}

      <div style={styles.seatGrid}>
        {[...Array(20)].map((_, i) => {
          const seatNum = i + 1;
          const p = playersMap[seatNum];
          const isMe = p && (p.id === socket?.id || p.socketId === socket?.id);

          return (
            <div 
              key={seatNum} 
              style={{ 
                ...styles.seatCard, 
                borderColor: p && !p.isAlive ? '#ef4444' : (isMe ? '#7c3aed' : '#1e293b'),
                opacity: p && !p.isAlive ? 0.6 : 1,
                filter: p && !p.isAlive ? 'grayscale(70%)' : 'none'
              }}
              onClick={() => p && handleActionOnSeat(seatNum)}
            >
              <div style={styles.seatHeader}>
                <span>Ghế #{seatNum}</span>
                <span style={{ color: p?.isAlive ? '#10b981' : '#ef4444' }}>
                  {p ? (p.isAlive ? '🟢 Sống' : '💀 Hồn Ma') : 'Trống'}
                </span>
              </div>
              <div style={styles.videoArea}>
                {p ? (
                  <>
                    <div id={isMe ? 'my-local-video' : `remote-video-${p.uid}`} style={{ width: '100%', height: '100%', background: '#000' }} />
                    <div style={styles.nameTag}>
                      {p.name} {p.isHost ? '👑' : ''} {isMe && myRoleKey ? `[${ROLES_CONFIG[myRoleKey]?.name || myRoleKey}]` : ''}
                    </div>
                  </>
                ) : (
                  <span style={{ color: '#475569', fontSize: '13px' }}>Trống</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {myRoleInfo && (
        <div style={styles.roleCard}>
          <h4 style={{ margin: '0 0 5px 0', color: '#c084fc' }}>Vai Trò: {myRoleInfo.name}</h4>
          <p style={{ margin: '3px 0', fontSize: '12px' }}><b>Phe:</b> {myRoleInfo.team}</p>
          <p style={{ margin: '3px 0', fontSize: '12px', color: '#38bdf8' }}><b>Năng lực:</b> {myRoleInfo.ability}</p>
        </div>
      )}

      {wolfChatOpen && (
        <div style={styles.chatModal}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <h4 style={{ margin: 0, color: '#f43f5e' }}>🐺 Bàn Đàm Đạo Của Sói</h4>
            <button onClick={() => setWolfChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✖</button>
          </div>
          <div style={styles.chatBox}>
            {wolfMessages.map((m, idx) => (
              <div key={idx} style={{ fontSize: '12px', marginBottom: '4px' }}><b style={{ color: '#f43f5e' }}>{m.sender}:</b> {m.message}</div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if(!chatInput)return; socket.emit('send_wolf_chat', { roomId, message: chatInput, sender: name }); setChatInput(''); }} style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
            <input style={{ ...styles.input, padding: '6px', fontSize: '12px', flex: 1 }} placeholder="Thì thầm với Sói..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
            <button type="submit" style={{ ...styles.btnPrimary, padding: '6px 10px', fontSize: '12px' }}>Gửi</button>
          </form>
        </div>
      )}

      {ghostChatOpen && isDead && (
        <div style={{ ...styles.chatModal, borderColor: '#64748b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <h4 style={{ margin: 0, color: '#94a3b8' }}>👻 Phòng Chat Âm Phủ</h4>
            <button onClick={() => setGhostChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✖</button>
          </div>
          <div style={styles.chatBox}>
            {ghostMessages.map((m, idx) => (
              <div key={idx} style={{ fontSize: '12px', marginBottom: '4px' }}><b style={{ color: '#94a3b8' }}>{m.sender}:</b> {m.message}</div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if(!ghostInput)return; socket.emit('send_ghost_chat', { roomId, message: ghostInput, sender: name }); setGhostInput(''); }} style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
            <input style={{ ...styles.input, padding: '6px', fontSize: '12px', flex: 1 }} placeholder="Tâm sự người âm..." value={ghostInput} onChange={e => setGhostInput(e.target.value)} />
            <button type="submit" style={{ ...styles.btnPrimary, background: '#475569', padding: '6px 10px', fontSize: '12px' }}>Gửi</button>
          </form>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#020617', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#0f172a', padding: '30px', borderRadius: '16px', width: '380px', border: '1px solid #1e293b' },
  title: { textAlign: 'center', color: '#f8fafc', marginBottom: '20px', fontSize: '20px' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#1e293b', color: '#fff' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  select: { padding: '6px', borderRadius: '6px', background: '#1e293b', color: '#fff', border: '1px solid #334155' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  btnPrimary: { background: '#7c3aed', color: '#fff', padding: '10px', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  roomContainer: { minHeight: '100vh', padding: '15px', color: '#f8fafc', position: 'relative' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '10px 15px', borderRadius: '12px', border: '1px solid #1e293b', marginBottom: '12px', zIndex: 10, position: 'relative' },
  btnDanger: { background: '#ef4444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
  btnMedia: { border: 'none', padding: '6px 10px', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' },
  notif: { background: 'rgba(124, 58, 237, 0.9)', color: '#fff', padding: '10px', textAlign: 'center', borderRadius: '8px', marginBottom: '12px', fontWeight: 'bold', zIndex: 10, position: 'relative' },
  hostPanel: { background: '#1e293b', padding: '12px', borderRadius: '10px', marginBottom: '12px', border: '1px solid #334155', zIndex: 10, position: 'relative' },
  btnAction: { background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' },
  seatGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', paddingBottom: '100px', zIndex: 10, position: 'relative' },
  seatCard: { background: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.3s' },
  seatHeader: { padding: '4px 8px', background: '#1e293b', display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 'bold' },
  videoArea: { height: '100px', position: 'relative', background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  nameTag: { position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '4px', fontSize: '10px', color: '#fff' },
  roleCard: { position: 'fixed', bottom: '15px', right: '15px', background: '#0f172a', border: '2px solid #7c3aed', padding: '12px', borderRadius: '10px', width: '260px', zIndex: 100 },
  chatModal: { position: 'fixed', bottom: '15px', left: '15px', background: '#0f172a', border: '2px solid #f43f5e', padding: '10px', borderRadius: '10px', width: '260px', zIndex: 100 },
  chatBox: { height: '100px', overflowY: 'auto', background: '#020617', padding: '6px', borderRadius: '4px', border: '1px solid #1e293b' },
  slash: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(239, 68, 68, 0.4)', zIndex: 999, pointerEvents: 'none' },
  overlayContainer: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1 },
  floating: { position: 'absolute', fontSize: '36px', userSelect: 'none' }
};