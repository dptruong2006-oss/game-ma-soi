import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:10000' : '';
const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

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

  // Chat riêng phe Sói
  const [wolfChatOpen, setWolfChatOpen] = useState(false);
  const [wolfMessages, setWolfMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Trạng thái Agora & Media
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const localAudioTrack = useRef(null);
  const localVideoTrack = useRef(null);

  // Hiệu ứng đặc biệt & Âm thanh
  const [slashEffect, setSlashEffect] = useState(false);
  const [shakeScreen, setShakeScreen] = useState(false);
  const audioDayRef = useRef(null);
  const audioNightRef = useRef(null);

  // Khôi phục phiên làm việc khi F5 (Persistence)
  useEffect(() => {
    const savedRoom = localStorage.getItem('werewolf_room');
    const savedName = localStorage.getItem('werewolf_name');
    if (savedRoom && savedName) {
      setInRoom(true);
    }
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

    newSocket.on('room_update', (data) => {
      setRoomData(prev => ({ ...prev, ...data }));
    });

    newSocket.on('room_state_update', (room) => {
      setRoomData(room);
      setTimeLeft(room.timeLeft);
      const me = Object.values(room.players || {}).find(p => p.id === newSocket.id);
      if (me) {
        if (me.roleInfo) setMyRoleInfo(me.roleInfo);
        if (me.role) setMyRoleKey(me.role);

        if (localAudioTrack.current && me.canSpeak !== undefined) {
          localAudioTrack.current.setEnabled(me.canSpeak && micOn);
        }
        if (localVideoTrack.current && me.canCam !== undefined) {
          localVideoTrack.current.setEnabled(me.canCam && camOn);
        }
      }
    });

    newSocket.on('timer_update', ({ timeLeft }) => {
      setTimeLeft(timeLeft);
    });

    newSocket.on('notification', ({ message }) => {
      setNotification(message);
      if (message.includes('💀') || message.includes('ngã xuống')) {
        setSlashEffect(true);
        setShakeScreen(true);
        setTimeout(() => {
          setSlashEffect(false);
          setShakeScreen(false);
        }, 900);
      }
      setTimeout(() => setNotification(''), 4000);
    });

    newSocket.on('receive_wolf_chat', (data) => {
      setWolfMessages(prev => [...prev, data]);
    });

    newSocket.on('seer_result', (data) => {
      alert(`🔮 Kết quả soi Tiên Tri: Ghế #${data.seat} (${data.name}) -> ${data.isWolf ? '⚠️ LÀ SÓI!' : '🛡️ DÂN THƯỜNG / TỐT'}`);
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
    if (!roomId || !name) return alert('Vui lòng nhập đầy đủ Tên và Mã Phòng!');
    
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

      localVideoTrack.current.play('my-local-video');

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'video') {
          setTimeout(() => user.videoTrack.play(`remote-video-${user.uid}`), 100);
        }
        if (mediaType === 'audio') user.audioTrack.play();
      });
    } catch (error) {
      console.error("Lỗi Agora:", error);
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
    localStorage.removeItem('werewolf_room');
    localStorage.removeItem('werewolf_name');
    localStorage.removeItem('werewolf_seat');
    localStorage.removeItem('werewolf_ishost');
    window.location.reload();
  };

  const startGame = () => socket.emit('start_game', { roomId });
  const changePhase = (phase) => socket.emit('change_phase', { roomId, phase });
  const clearVotes = () => socket.emit('clear_votes', { roomId });

  const handleActionOnSeat = (targetSeat) => {
    const phase = roomData?.phase;
    if (phase === 'NIGHT') {
      if (myRoleKey === 'WOLF') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WOLF' });
        alert(`🐺 Bạn đã chọn cắn ghế #${targetSeat}`);
      } else if (myRoleKey === 'GUARD') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'GUARD' });
        alert(`🛡️ Bạn đã bảo vệ ghế #${targetSeat}`);
      } else if (myRoleKey === 'SEER') {
        socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'SEER_CHECK' });
      } else if (myRoleKey === 'WITCH') {
        const action = prompt("Phù thủy muốn dùng bình gì?\n1. Cứu (Nhập 'heal')\n2. Độc sát hại (Nhập 'kill')");
        if (action === 'heal') {
          socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WITCH_HEAL' });
        } else if (action === 'kill') {
          socket.emit('apply_night_action', { roomId, targetSeat, actionType: 'WITCH_KILL' });
        }
      }
    } else if (phase === 'VOTE') {
      socket.emit('cast_vote', { roomId, targetSeat });
      alert(`🗳️ Đã vote treo cổ ghế #${targetSeat}`);
    }
  };

  const sendWolfMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('send_wolf_chat', { roomId, message: chatInput, sender: name });
    setChatInput('');
  };

  if (!inRoom) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>🐺 MA SÓI NÂNG CAO 🌙</h1>
          <form onSubmit={handleJoinRoom} style={styles.form}>
            <input style={styles.input} placeholder="Tên nhân vật..." value={name} onChange={e => setName(e.target.value)} />
            <input style={styles.input} placeholder="Mã phòng..." value={roomId} onChange={e => setRoomId(e.target.value)} />
            <div style={styles.row}>
              <label style={{ fontSize: '14px', color: '#94a3b8' }}>Chọn ghế:</label>
              <select style={styles.select} value={seat} onChange={e => setSeat(e.target.value)}>
                {[...Array(20)].map((_, i) => <option key={i+1} value={i+1}>Ghế #{i+1}</option>)}
              </select>
            </div>
            <div style={styles.checkboxRow}>
              <input type="checkbox" id="hostCheck" checked={isHost} onChange={e => setIsHost(e.target.checked)} />
              <label htmlFor="hostCheck" style={{ cursor: 'pointer', color: '#e2e8f0' }}>Đăng ký Quản Trò (Host)</label>
            </div>
            <button type="submit" style={styles.btnPrimary}>Vào Phòng</button>
          </form>
        </div>
      </div>
    );
  }

  const isNight = roomData?.phase === 'NIGHT';

  return (
    <div className={shakeScreen ? 'shake-animation' : ''} style={{ ...styles.roomContainer, background: isNight ? '#020617' : '#0f172a' }}>
      {/* CSS Keyframes cho Hồn Ma Đêm & Hiệu ứng Dễ Thương Ngày */}
      <style>{`
        @keyframes floatGhost {
          0% { transform: translateY(0px) scale(1); opacity: 0.4; }
          50% { transform: translateY(-25px) scale(1.1); opacity: 0.8; }
          100% { transform: translateY(0px) scale(1); opacity: 0.4; }
        }
        @keyframes floatCute {
          0% { transform: translateY(0px) rotate(0deg); opacity: 0.7; }
          50% { transform: translateY(-15px) rotate(10deg); opacity: 1; }
          100% { transform: translateY(0px) rotate(0deg); opacity: 0.7; }
        }
        @keyframes lightning {
          0%, 90%, 94%, 98%, 100% { opacity: 0; }
          92%, 96% { opacity: 0.15; background-color: #38bdf8; }
        }
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          20% { transform: translate(-3px, 0px) rotate(-1deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); }
          80% { transform: translate(1px, -1px) rotate(1deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        .shake-animation { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        .ghost-anim { animation: floatGhost 4s ease-in-out infinite; }
        .cute-anim { animation: floatCute 3s ease-in-out infinite; }
      `}</style>

      <audio ref={audioDayRef} src="https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf756.mp3?filename=mysterious-aperitif-111710.mp3" loop />
      <audio ref={audioNightRef} src="https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=horror-ambience-10654.mp3" loop />

      {/* HIỆU ỨNG NỀN: Hồn ma ban đêm / Biểu tượng dễ thương ban ngày */}
      {isNight ? (
        <div style={styles.overlayContainer}>
          <div className="ghost-anim" style={{ ...styles.floatingIcon, top: '15%', left: '10%' }}>👻</div>
          <div className="ghost-anim" style={{ ...styles.floatingIcon, top: '65%', right: '12%', animationDelay: '2s' }}>👻</div>
        </div>
      ) : (
        <div style={styles.overlayContainer}>
          <div className="cute-anim" style={{ ...styles.floatingIcon, top: '18%', left: '8%' }}>🌸</div>
          <div className="cute-anim" style={{ ...styles.floatingIcon, top: '70%', right: '10%', animationDelay: '1.5s' }}>⭐</div>
          <div className="cute-anim" style={{ ...styles.floatingIcon, top: '40%', right: '5%', animationDelay: '0.8s' }}>💖</div>
        </div>
      )}

      {isNight && <div style={styles.lightningOverlay} />}
      {slashEffect && <div style={styles.slashOverlay} />}

      <header style={styles.header}>
        <button style={styles.btnDanger} onClick={leaveRoom}>🚪 Rời Phòng</button>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: '#c084fc', margin: 0 }}>PHÒNG: {roomId}</h2>
          <span style={{ fontSize: '13px', color: isNight ? '#38bdf8' : '#fbbf24' }}>
            {isNight ? '🌙 BAN ĐÊM (Sói & Chức năng hoạt động)' : '☀️ BAN NGÀY (Thảo luận & Treo cổ)'} | Còn lại: <b>{timeLeft}s</b>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ ...styles.btnMedia, background: micOn ? '#10b981' : '#ef4444' }} onClick={toggleMic}>{micOn ? '🎤 Mic Bật' : '🔇 Mic Tắt'}</button>
          <button style={{ ...styles.btnMedia, background: camOn ? '#3b82f6' : '#ef4444' }} onClick={toggleCam}>{camOn ? '📹 Cam Bật' : '📷 Cam Tắt'}</button>
          {myRoleKey === 'WOLF' && (
            <button style={{ ...styles.btnMedia, background: '#8b5cf6' }} onClick={() => setWolfChatOpen(!wolfChatOpen)}>💬 Chat Sói</button>
          )}
        </div>
      </header>

      {notification && <div style={styles.notificationBanner}>{notification}</div>}

      {isHost && (
        <div style={styles.hostPanel}>
          <h3 style={{ margin: '0 0 10px 0', color: '#fbbf24' }}>👑 Điều Khiển Quản Trò</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button style={styles.btnHostAction} onClick={() => changePhase('NIGHT')}>🌙 Sang Đêm</button>
            <button style={styles.btnHostAction} onClick={() => changePhase('DAY')}>☀️ Sang Ngày</button>
            <button style={styles.btnHostAction} onClick={() => changePhase('VOTE')}>🗳️ Mở Vote</button>
            <button style={styles.btnHostAction} onClick={clearVotes}>🧹 Xóa Vote</button>
            <button style={styles.btnStartGame} onClick={startGame}>🚀 Bắt Đầu Ván Mới</button>
          </div>
        </div>
      )}

      <div style={styles.seatGrid}>
        {[...Array(20)].map((_, i) => {
          const seatNum = i + 1;
          const playerInSeat = Object.values(roomData?.players || {}).find(p => p.seat === seatNum);

          return (
            <div key={seatNum} style={{ ...styles.seatCard, borderColor: playerInSeat && !playerInSeat.isAlive ? '#ef4444' : '#1e293b' }} onClick={() => playerInSeat && handleActionOnSeat(seatNum)}>
              <div style={styles.seatHeader}>
                <span>Ghế #{seatNum}</span>
                <span style={{ fontSize: '11px', color: playerInSeat?.isAlive ? '#10b981' : '#ef4444' }}>
                  {playerInSeat ? (playerInSeat.isAlive ? '🟢 Sống' : '💀 Chết') : '⚪ Trống'}
                </span>
              </div>
              <div style={styles.videoBox}>
                {playerInSeat ? (
                  <>
                    <div id={playerInSeat.id === socket.id ? 'my-local-video' : `remote-video-${playerInSeat.uid}`} style={{ width: '100%', height: '100%', background: '#000' }} />
                    <div style={styles.playerNameOverlay}>{playerInSeat.name} {playerInSeat.isHost ? '👑' : ''}</div>
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
        <div style={styles.rolePanel}>
          <h3 style={{ margin: '0 0 5px 0', color: '#c084fc' }}>{myRoleInfo.name}</h3>
          <p style={{ margin: '3px 0', fontSize: '13px' }}><b>Phe:</b> {myRoleInfo.team}</p>
          <p style={{ margin: '3px 0', fontSize: '13px' }}><b>Mục tiêu:</b> {myRoleInfo.objective}</p>
          <p style={{ margin: '3px 0', fontSize: '13px', color: '#38bdf8' }}><b>Kỹ năng:</b> {myRoleInfo.ability}</p>
        </div>
      )}

      {wolfChatOpen && (
        <div style={styles.wolfChatModal}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, color: '#f43f5e' }}>🐺 Bàn Chiến Thuật Sói Đêm</h4>
            <button onClick={() => setWolfChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✖</button>
          </div>
          <div style={styles.wolfChatBox}>
            {wolfMessages.map((m, idx) => (
              <div key={idx} style={{ fontSize: '13px', marginBottom: '4px' }}>
                <b style={{ color: '#f43f5e' }}>{m.sender}:</b> {m.message}
              </div>
            ))}
          </div>
          <form onSubmit={sendWolfMessage} style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
            <input style={{ ...styles.input, padding: '8px', fontSize: '13px', flex: 1 }} placeholder="Nhắn tin với đồng bọn..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
            <button type="submit" style={{ ...styles.btnPrimary, padding: '8px 12px', fontSize: '13px' }}>Gửi</button>
          </form>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#020617', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#0f172a', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', width: '380px', border: '1px solid #1e293b' },
  title: { textAlign: 'center', color: '#f8fafc', marginBottom: '20px', fontSize: '22px' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '12px', borderRadius: '8px', border: '1px solid #334155', background: '#1e293b', color: '#fff', fontSize: '15px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  select: { padding: '8px', borderRadius: '6px', background: '#1e293b', color: '#fff', border: '1px solid #334155' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '5px 0' },
  btnPrimary: { background: '#7c3aed', color: '#fff', padding: '12px', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' },
  roomContainer: { minHeight: '100vh', padding: '15px', color: '#f8fafc', position: 'relative', transition: 'background 0.8s ease-in-out', overflowX: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '12px 20px', borderRadius: '12px', border: '1px solid #1e293b', marginBottom: '15px', zIndex: 10, position: 'relative' },
  btnDanger: { background: '#ef4444', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  btnMedia: { border: 'none', padding: '8px 12px', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' },
  notificationBanner: { background: 'rgba(124, 58, 237, 0.9)', color: '#fff', padding: '12px', textAlign: 'center', borderRadius: '8px', marginBottom: '15px', fontWeight: 'bold', zIndex: 10, position: 'relative' },
  hostPanel: { background: '#1e293b', padding: '15px', borderRadius: '12px', marginBottom: '15px', border: '1px solid #334155', zIndex: 10, position: 'relative' },
  btnHostAction: { background: '#334155', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' },
  btnStartGame: { background: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
  seatGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', paddingBottom: '120px', zIndex: 10, position: 'relative' },
  seatCard: { background: '#0f172a', borderRadius: '10px', border: '1px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer' },
  seatHeader: { padding: '6px 10px', background: '#1e293b', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold' },
  videoBox: { height: '110px', position: 'relative', background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  playerNameOverlay: { position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: '#fff' },
  rolePanel: { position: 'fixed', bottom: '15px', right: '15px', background: '#0f172a', border: '2px solid #7c3aed', padding: '15px', borderRadius: '12px', width: '280px', zIndex: 100 },
  wolfChatModal: { position: 'fixed', bottom: '15px', left: '15px', background: '#0f172a', border: '2px solid #f43f5e', padding: '12px', borderRadius: '12px', width: '280px', zIndex: 100 },
  wolfChatBox: { height: '120px', overflowY: 'auto', background: '#020617', padding: '8px', borderRadius: '6px', border: '1px solid #1e293b' },
  slashOverlay: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(239, 68, 68, 0.35)', zIndex: 999, pointerEvents: 'none' },
  lightningOverlay: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 2, pointerEvents: 'none', animation: 'lightning 5s infinite' },
  overlayContainer: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1 },
  floatingIcon: { position: 'absolute', fontSize: '40px', userSelect: 'none' }
};