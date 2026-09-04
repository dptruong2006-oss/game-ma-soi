import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const SOCKET_SERVER_URL = 'https://game-ma-soi.onrender.com';
const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475";

// Khởi tạo Socket và Agora Client duy nhất bên ngoài Render Loop
const socket = io(SOCKET_SERVER_URL, { autoConnect: true });
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Global CSS animation và hiệu ứng
const GlobalStyles = () => (
  <style>{`
    @keyframes shake {
      0%, 100% { transform: translate(0, 0); }
      20%, 60% { transform: translate(-5px, 5px); }
      40%, 80% { transform: translate(5px, -5px); }
    }
    .card-shake { animation: shake 0.5s ease-in-out; }
    
    .slash-effect {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: linear-gradient(135deg, transparent 45%, rgba(239, 68, 68, 0.8) 50%, transparent 55%);
      pointer-events: none; z-index: 999; animation: fadeSlash 0.8s forwards;
    }
    @keyframes fadeSlash { 0% { opacity: 1; } 100% { opacity: 0; } }

    .lightning-effect {
      position: absolute; inset: 0; background: rgba(255, 255, 255, 0.15);
      pointer-events: none; opacity: 0; animation: lightning 4s infinite;
    }
    @keyframes lightning {
      0%, 90%, 100% { opacity: 0; }
      92%, 94% { opacity: 0.8; }
    }
  `}</style>
);

// Component phát Video / Audio Agora
const AgoraVideoPlayer = memo(({ videoTrack, audioTrack, isLocal }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !videoTrack) return;

    try {
      videoTrack.play(el);
    } catch (e) {
      console.error("Lỗi phát video Agora:", e);
    }

    return () => {
      try {
        if (videoTrack && videoTrack.isPlaying) {
          videoTrack.stop();
        }
      } catch (e) {}
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!isLocal && audioTrack) {
      try {
        if (!audioTrack.isPlaying) {
          audioTrack.play();
        }
      } catch (e) {
        console.error("Lỗi phát audio Agora:", e);
      }
    }
  }, [audioTrack, isLocal]);

  return (
    <div ref={containerRef} style={styles.videoPlayerContainer}>
      {!isLocal && audioTrack && (
        <button 
          onClick={() => audioTrack.play()} 
          style={styles.enableAudioBtn}
        >
          🔊 Mở âm thanh
        </button>
      )}
    </div>
  );
});

// Component hiển thị thẻ từng ghế chơi
const SeatCard = memo(({ 
  seatNum, occupant, isMe, remoteUser, isNight, isDay, isHost, myRole, localTracks, isVideoOn, voteCount, socket 
}) => {
  if (!occupant) {
    return (
      <div style={styles.emptySeatCard}>
        <span style={{ fontSize: '11px', color: '#64748b' }}>Ghế #{seatNum} (Trống)</span>
      </div>
    );
  }

  const isAlive = occupant.isAlive !== false;

  // Quyền xem video stream
  const canSeeStream = () => {
    if (!isAlive) return false;
    if (occupant.id === socket.id || isHost) return true;
    if (isNight) {
      return myRole === 'WOLF' && occupant.role === 'WOLF';
    }
    return true;
  };

  return (
    <div 
      style={{
        ...styles.seatCard,
        border: isMe ? '2px solid #a855f7' : (isAlive ? '1px solid #334155' : '1px solid #7f1d1d'),
        opacity: isAlive ? 1 : 0.6,
        background: isAlive ? '#0f172a' : '#18181b'
      }}
    >
      {/* Header Ghế & Hiển thị Vote Count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '4px' }}>
        <span style={styles.seatBadge}>Ghế #{seatNum}</span>
        {voteCount > 0 && isDay && (
          <span style={styles.voteBadge}>🗳️ {voteCount} phiếu</span>
        )}
        {occupant.isHost && <span style={styles.hostBadge}>👑 Host</span>}
      </div>

      {/* Frame Khung Video */}
      <div style={styles.videoBox}>
        {!isAlive && (
          <div style={styles.deadOverlay}>
            <span>👻 ĐÃ CHẾT</span>
          </div>
        )}

        {isAlive && canSeeStream() ? (
          isMe ? (
            localTracks.videoTrack && isVideoOn ? (
              <AgoraVideoPlayer videoTrack={localTracks.videoTrack} isLocal={true} />
            ) : (
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Tắt Cam</span>
            )
          ) : (
            remoteUser?.videoTrack ? (
              <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} />
            ) : (
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Chờ Cam</span>
            )
          )
        ) : (
          isAlive && (
            <div style={{ color: '#64748b', fontSize: '11px', textAlign: 'center' }}>
              🌙 Đang ngủ...
            </div>
          )
        )}
      </div>

      {/* Thông tin tên & Nút chức năng */}
      <div style={{ width: '100%', marginTop: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px' }}>
            {occupant.name} {isMe ? "(Bạn)" : ""}
          </span>

          {/* Action Ban Ngày */}
          {isDay && isAlive && !isMe && (
            <button 
              onClick={() => socket.emit('cast_vote', { roomId: occupant.roomId, targetSeat: seatNum })} 
              style={styles.actionVoteBtn}
            >
              🗳️ Vote
            </button>
          )}
        </div>

        {/* Action Ban Đêm */}
        {isNight && isAlive && (
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '4px' }}>
            {isHost && (
              <>
                <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={styles.actionIconBtn} title="Bảo vệ">🛡️</button>
                <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ ...styles.actionIconBtn, background: '#dc2626' }} title="Cắn">🐺</button>
                <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ ...styles.actionIconBtn, background: '#9333ea' }} title="Soi">🔮</button>
              </>
            )}

            {!isHost && myRole === 'GUARD' && (
              <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={styles.roleActionBtn}>🛡️ Bảo vệ</button>
            )}
            {!isHost && myRole === 'WOLF' && (
              <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ ...styles.roleActionBtn, background: '#dc2626' }}>🐺 Cắn</button>
            )}
            {!isHost && myRole === 'SEER' && (
              <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ ...styles.roleActionBtn, background: '#9333ea' }}>🔮 Soi</button>
            )}
            {!isHost && myRole === 'WITCH' && (
              <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'WITCH_POISON' })} style={{ ...styles.roleActionBtn, background: '#16a34a' }}>🧪 Độc</button>
            )}
          </div>
        )}

        {/* Thao tác bổ sung của Host */}
        {isHost && !isMe && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button 
              onClick={() => socket.emit('host_kick_player', { roomId: occupant.roomId, targetSocketId: occupant.id })}
              style={styles.hostMicroBtn}
            >
              🚫 Đuổi
            </button>
            <button 
              onClick={() => socket.emit('host_toggle_alive', { roomId: occupant.roomId, targetSeat: seatNum })}
              style={{ ...styles.hostMicroBtn, background: isAlive ? '#b91c1c' : '#15803d' }}
            >
              {isAlive ? '💀 Giết' : '💖 Cứu'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default function App() {
  const [hasJoined, setHasJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [isHost, setIsHost] = useState(false);
  
  const [isSlashing, setIsSlashing] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [isConnected, setIsConnected] = useState(true);

  const [chatMessage, setChatMessage] = useState('');
  const [wolfChatList, setWolfChatList] = useState([]);
  const [publicLogs, setPublicLogs] = useState([]);

  // Tùy chỉnh vai trò (Role Config - dành cho Host)
  const [roleSetup, setRoleSetup] = useState({ wolves: 2, seers: 1, guards: 1, witches: 1 });

  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'phong-mac-dinh-123';
  });

  const [roomState, setRoomState] = useState({
    phase: 'LOBBY',
    players: {},
    votes: {},
  });

  const [localTracks, setLocalTracks] = useState({ audioTrack: null, videoTrack: null });
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const laughAudioRef = useRef(null);
  const windAudioRef = useRef(null);
  const phaseRef = useRef(roomState.phase);

  useEffect(() => {
    phaseRef.current = roomState.phase;
  }, [roomState.phase]);

  // Tự động khôi phục Session nếu bấm F5
  useEffect(() => {
    const savedSession = sessionStorage.getItem('ma_soi_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (parsed.roomId && parsed.name && parsed.seat) {
          setPlayerName(parsed.name);
          setSelectedSeat(parsed.seat);
          setIsHost(parsed.isHost || false);
          setRoomId(parsed.roomId);
          setHasJoined(true);
          socket.emit('rejoin_room', parsed);
        }
      } catch (e) {
        sessionStorage.removeItem('ma_soi_session');
      }
    }
  }, []);

  // Âm thanh giả lập qua Web Audio API
  const playSoundEffect = useCallback((phase) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      if (phase === 'NIGHT') {
        osc.frequency.setValueAtTime(120, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 1.5);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
      } else {
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 1);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);
      }
      osc.start();
      osc.stop(audioCtx.currentTime + 1.5);
    } catch (e) {}
  }, []);

  useEffect(() => {
    const url = new URL(window.location);
    if (roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
    }
  }, [roomId]);

  const playerList = Object.values(roomState.players || {});
  const existingHost = playerList.find(p => p.isHost === true);
  const takenSeats = playerList.map(p => p.seat);
  const myPlayerInfo = roomState.players[socket.id];
  const isNight = roomState.phase === 'NIGHT';
  const isDay = roomState.phase === 'DAY';
  const isAlive = myPlayerInfo?.isAlive !== false;

  // Tính số lượng phiếu bầu (Vote Count) trên từng ghế
  const voteCounts = React.useMemo(() => {
    const counts = {};
    if (roomState.votes) {
      Object.values(roomState.votes).forEach(targetSeat => {
        counts[targetSeat] = (counts[targetSeat] || 0) + 1;
      });
    }
    return counts;
  }, [roomState.votes]);

  // Đăng ký sự kiện Socket.io
  useEffect(() => {
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    
    const handleTimerUpdate = (data) => {
      if (data && typeof data.timeLeft === 'number') setTimeLeft(data.timeLeft);
    };

    const handleRoomStateUpdate = (state) => {
      if (state && state.phase && state.phase !== phaseRef.current) {
        playSoundEffect(state.phase);
        if (state.phase === 'NIGHT') {
          setIsSlashing(true);
          setIsShaking(true);
          setTimeout(() => setIsSlashing(false), 900);
          setTimeout(() => setIsShaking(false), 600);
        }
      }
      if (state && state.players) {
        setRoomState(state);
      }
    };

    const handleWolfMessage = (data) => {
      setWolfChatList(prev => [...prev, data]);
    };

    const handleSeerResult = (data) => {
      alert(`🔮 KẾT QUẢ TIÊN TRI (Ghế #${data.seat} - ${data.name}): ${data.isWolf ? '🐺 Là SÓI!' : '🛡️ Vô Tội!'}`);
    };

    const handleNotification = (data) => {
      if (data?.message) {
        setPublicLogs(prev => [...prev, data.message]);
        alert(data.message);
      }
    };

    const handleKicked = () => {
      alert("⚠️ Bạn đã bị Quản trò mời ra khỏi phòng!");
      sessionStorage.removeItem('ma_soi_session');
      window.location.reload();
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('timer_update', handleTimerUpdate);
    socket.on('room_state_update', handleRoomStateUpdate);
    socket.on('wolf_message_receive', handleWolfMessage);
    socket.on('seer_result', handleSeerResult);
    socket.on('notification', handleNotification);
    socket.on('kicked_from_room', handleKicked);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('timer_update', handleTimerUpdate);
      socket.off('room_state_update', handleRoomStateUpdate);
      socket.off('wolf_message_receive', handleWolfMessage);
      socket.off('seer_result', handleSeerResult);
      socket.off('notification', handleNotification);
      socket.off('kicked_from_room', handleKicked);
    };
  }, [playSoundEffect]);

  // Phát nhạc nền Ban đêm
  useEffect(() => {
    if (isNight) {
      if (laughAudioRef.current) laughAudioRef.current.play().catch(() => {});
      if (windAudioRef.current) windAudioRef.current.play().catch(() => {});
    } else {
      if (laughAudioRef.current) {
        laughAudioRef.current.pause();
        laughAudioRef.current.currentTime = 0;
      }
      if (windAudioRef.current) {
        windAudioRef.current.pause();
        windAudioRef.current.currentTime = 0;
      }
    }
  }, [isNight]);

  // Tự động vô hiệu hóa Micro/Camera khi Đã Chết
  useEffect(() => {
    if (localTracks.audioTrack) {
      const canSpeak = isAlive && (myPlayerInfo?.canSpeak !== false);
      localTracks.audioTrack.setEnabled(canSpeak && isMicOn);
    }
  }, [isAlive, myPlayerInfo?.canSpeak, isMicOn, localTracks.audioTrack]);

  useEffect(() => {
    if (localTracks.videoTrack) {
      const canCam = isAlive && (myPlayerInfo?.canCam !== false);
      localTracks.videoTrack.setEnabled(canCam && isVideoOn);
    }
  }, [isAlive, myPlayerInfo?.canCam, isVideoOn, localTracks.videoTrack]);

  // Quản lý Kết nối Agora RTC Realtime Video
  useEffect(() => {
    if (!hasJoined || !socket.id) return;
    let isMounted = true;
    let createdAudioTrack = null;
    let createdVideoTrack = null;

    const initAgora = async () => {
      try {
        agoraClient.on('user-published', async (user, mediaType) => {
          await agoraClient.subscribe(user, mediaType);
          if (isMounted) {
            setRemoteUsers(prev => {
              const exists = prev.find(u => String(u.uid) === String(user.uid));
              return exists ? prev.map(u => String(u.uid) === String(user.uid) ? user : u) : [...prev, user];
            });
          }
        });

        agoraClient.on('user-left', (user) => {
          if (isMounted) {
            setRemoteUsers(prev => prev.filter(u => String(u.uid) !== String(user.uid)));
          }
        });

        const res = await fetch(`${SOCKET_SERVER_URL}/api/agora-token?channelName=${roomId}&uid=${socket.id}`);
        const data = await res.json();
        
        await agoraClient.join(AGORA_APP_ID, roomId, data.token || null, socket.id);

        try { 
          createdAudioTrack = await AgoraRTC.createMicrophoneAudioTrack(); 
        } catch (e) { 
          setIsMicOn(false); 
        }

        try { 
          createdVideoTrack = await AgoraRTC.createCameraVideoTrack(); 
        } catch (e) { 
          setIsVideoOn(false); 
        }

        if (isMounted) {
          setLocalTracks({ audioTrack: createdAudioTrack, videoTrack: createdVideoTrack });
          const tracksToPublish = [];
          if (createdAudioTrack) tracksToPublish.push(createdAudioTrack);
          if (createdVideoTrack) tracksToPublish.push(createdVideoTrack);
          
          if (tracksToPublish.length > 0) {
            await agoraClient.publish(tracksToPublish);
          }
        } else {
          createdAudioTrack?.close();
          createdVideoTrack?.close();
        }
      } catch (err) {
        console.error("Lỗi kết nối Agora RTC:", err);
      }
    };

    initAgora();

    return () => {
      isMounted = false;
      agoraClient.removeAllListeners();
      if (createdAudioTrack) createdAudioTrack.close();
      if (createdVideoTrack) createdVideoTrack.close();
      agoraClient.leave().catch(() => {});
      setRemoteUsers([]);
      setLocalTracks({ audioTrack: null, videoTrack: null });
    };
  }, [hasJoined, roomId]);

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (!playerName.trim()) return alert("Vui lòng nhập tên!");
    if (!selectedSeat) return alert("Vui lòng chọn 1 ghế!");
    if (isHost && existingHost) return alert("Phòng đã có Quản Trò!");

    const sessionData = { roomId, name: playerName.trim(), seat: selectedSeat, isHost };
    sessionStorage.setItem('ma_soi_session', JSON.stringify(sessionData));

    setHasJoined(true);
    socket.emit('join_room', sessionData);
  };

  const handleLeaveRoom = async () => {
    sessionStorage.removeItem('ma_soi_session');
    try {
      localTracks.audioTrack?.close();
      localTracks.videoTrack?.close();
      await agoraClient.leave();
    } catch (e) {}
    setHasJoined(false);
    setIsHost(false);
    setLocalTracks({ audioTrack: null, videoTrack: null });
    setRemoteUsers([]);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Đã sao chép link mời phòng: " + roomId);
  };

  const sendWolfChat = (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    socket.emit('send_wolf_chat', { roomId, message: chatMessage, sender: myPlayerInfo?.name || playerName });
    setChatMessage('');
  };

  // Màn hình chọn ghế & vào phòng
  if (!hasJoined) {
    return (
      <div style={styles.lobbyContainer}>
        <GlobalStyles />
        <h1 style={styles.lobbyTitle}>🐺 MA SÓI ONLINE - SƠ ĐỒ BÀN CHƠI</h1>
        <form onSubmit={handleJoinGame} style={styles.lobbyForm}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Tên Của Bạn:</label>
              <input 
                type="text" 
                value={playerName} 
                onChange={e => setPlayerName(e.target.value)} 
                style={styles.input} 
                placeholder="Nhập tên..."
                required 
              />
            </div>
            <div style={{ width: '140px' }}>
              <label style={styles.label}>Mã Phòng:</label>
              <input 
                type="text" 
                value={roomId} 
                onChange={e => setRoomId(e.target.value)} 
                style={styles.input} 
                required 
              />
            </div>
          </div>

          <button type="button" onClick={copyInviteLink} style={styles.copyBtn}>
            📋 Sao chép Link Mời
          </button>

          <div style={styles.hostBox}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Đăng ký Quản Trò (Host):</span>
            <button 
              type="button" 
              disabled={!!existingHost} 
              onClick={() => setIsHost(!isHost)} 
              style={{
                ...styles.hostBtn,
                background: isHost ? '#d97706' : (existingHost ? '#334155' : '#2563eb'),
                cursor: existingHost ? 'not-allowed' : 'pointer'
              }}
            >
              {isHost ? '👑 Quản Trò' : (existingHost ? '🔒 Đã có Host' : '🎯 Nhận Host')}
            </button>
          </div>

          <div>
            <label style={{ ...styles.label, marginBottom: '10px', display: 'block' }}>
              Chọn Ghế Ngồi (1 - 20):
            </label>
            <div style={styles.seatGrid}>
              {[...Array(20)].map((_, i) => {
                const sNum = i + 1;
                const taken = takenSeats.includes(sNum);
                const sel = selectedSeat === sNum;
                return (
                  <button 
                    key={sNum} 
                    type="button" 
                    disabled={taken} 
                    onClick={() => setSelectedSeat(sNum)} 
                    style={{
                      ...styles.seatBtn,
                      border: sel ? '2px solid #a855f7' : '1px solid #334155',
                      background: taken ? '#1e293b' : (sel ? '#9333ea' : '#0f172a'),
                      color: taken ? '#64748b' : '#fff',
                      cursor: taken ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {taken ? `Ghế ${sNum} (X)` : `Ghế ${sNum}`}
                  </button>
                );
              })}
            </div>
          </div>

          <button type="submit" style={styles.submitBtn}>
            VÀO CHỜ BÀN (GHẾ SỐ {selectedSeat || '...'})
          </button>
        </form>
      </div>
    );
  }

  // Màn hình chính trong Game
  return (
    <div 
      className={isShaking ? "card-shake" : ""}
      style={{
        ...styles.gameContainer,
        backgroundColor: isNight ? '#090d16' : '#0f172a',
      }}
    >
      <GlobalStyles />
      {isSlashing && <div className="slash-effect" />}

      {!isConnected && (
        <div style={styles.disconnectBanner}>
          ⚠️ Mất kết nối Máy chủ! Đang thử kết nối lại...
        </div>
      )}

      {isNight && (
        <div style={styles.nightEffectsOverlay}>
          <div className="lightning-effect" />
          <audio ref={laughAudioRef} loop src="https://actions.google.com/sounds/v1/horror/evil_laugh.ogg" />
          <audio ref={windAudioRef} loop src="https://actions.google.com/sounds/v1/ambiences/creepy_wind.ogg" />
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 20 }}>
        {/* Header Trạng Thái */}
        <header style={{
          ...styles.header,
          background: isNight ? '#020617' : '#1e293b',
          borderColor: isNight ? '#1e1b4b' : '#334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={handleLeaveRoom} style={styles.leaveBtn}>⬅️ Rời Phòng</button>
            <div>
              <h1 style={{ margin: 0, fontSize: '18px', color: '#c084fc' }}>PHÒNG: {roomId}</h1>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Thời gian: <span style={{ color: isNight ? '#a78bfa' : '#facc15' }}>{isNight ? '🌙 BAN ĐÊM' : '☀️ BAN NGÀY'}</span></span>
                {timeLeft !== null && (
                  <span style={styles.timerBadge}>⏱️ {timeLeft}s</span>
                )}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={copyInviteLink} style={styles.copyBtnHeader}>📋 Link Mời</button>
            <button 
              onClick={() => setIsMicOn(!isMicOn)} 
              disabled={!isAlive}
              style={{
                ...styles.mediaToggleBtn,
                background: isAlive ? (isMicOn ? '#059669' : '#dc2626') : '#475569',
                cursor: isAlive ? 'pointer' : 'not-allowed'
              }}
            >
              {isMicOn ? '🎤 Mic Bật' : '🎙️ Mic Tắt'}
            </button>
            <button 
              onClick={() => setIsVideoOn(!isVideoOn)} 
              disabled={!isAlive}
              style={{
                ...styles.mediaToggleBtn,
                background: isAlive ? (isVideoOn ? '#059669' : '#dc2626') : '#475569',
                cursor: isAlive ? 'pointer' : 'not-allowed'
              }}
            >
              {isVideoOn ? '📹 Cam Bật' : '📷 Cam Tắt'}
            </button>
          </div>
        </header>

        {/* Bảng Điều Khiển Nâng Cao Cho Quản Trò */}
        {isHost && (
          <div style={styles.hostControlPanel}>
            <h3 style={{ color: '#f59e0b', margin: '0 0 10px 0' }}>👑 Bảng Điều Khiển Quản Trò (Host)</h3>
            
            {/* Cấu hình vai trò trò chơi */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap', background: '#0f172a', padding: '10px', borderRadius: '8px' }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Cấu hình bài:</span>
              <label style={{ fontSize: '12px' }}>🐺 Sói: <input type="number" min="1" value={roleSetup.wolves} onChange={e => setRoleSetup({...roleSetup, wolves: parseInt(e.target.value) || 1})} style={styles.smallInput} /></label>
              <label style={{ fontSize: '12px' }}>🔮 Tiên Tri: <input type="number" min="0" value={roleSetup.seers} onChange={e => setRoleSetup({...roleSetup, seers: parseInt(e.target.value) || 0})} style={styles.smallInput} /></label>
              <label style={{ fontSize: '12px' }}>🛡️ Bảo Vệ: <input type="number" min="0" value={roleSetup.guards} onChange={e => setRoleSetup({...roleSetup, guards: parseInt(e.target.value) || 0})} style={styles.smallInput} /></label>
              <label style={{ fontSize: '12px' }}>🧪 Phù Thủy: <input type="number" min="0" value={roleSetup.witches} onChange={e => setRoleSetup({...roleSetup, witches: parseInt(e.target.value) || 0})} style={styles.smallInput} /></label>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => socket.emit('change_phase', { roomId, phase: 'NIGHT' })} style={styles.hostActionBtn}>🌙 Chuyển Đêm</button>
              <button onClick={() => socket.emit('change_phase', { roomId, phase: 'DAY' })} style={styles.hostActionBtn}>☀️ Chuyển Ngày</button>
              <button onClick={() => socket.emit('clear_votes', { roomId })} style={styles.hostActionBtn}>🧹 Xóa Vòng Vote</button>
              <button onClick={() => socket.emit('start_game', { roomId, roleSetup })} style={{ ...styles.hostActionBtn, background: '#dc2626' }}>🚀 Bắt Đầu Ván Mới</button>
            </div>
          </div>
        )}

        {/* Thông Báo Vai Trò Của Người Chơi */}
        {myPlayerInfo?.role && (
          <div style={styles.roleBanner}>
            <span>🔒 Vai trò bí mật của bạn:</span>
            <strong style={{ color: '#facc15', fontSize: '16px' }}>
              {myPlayerInfo.role === 'WOLF' && '🐺 Sói'}
              {myPlayerInfo.role === 'GUARD' && '🛡️ Bảo Vệ'}
              {myPlayerInfo.role === 'SEER' && '🔮 Tiên Tri'}
              {myPlayerInfo.role === 'WITCH' && '🧪 Phù Thủy'}
              {myPlayerInfo.role === 'VILLAGER' && '🧑 Dân Làng'}
            </strong>
          </div>
        )}

        {/* Thẻ Cảnh Báo Cho Linh Hồn (Đã Chết) */}
        {!isAlive && (
          <div style={styles.deadWarningBanner}>
            👻 Bạn đã qua đời! Bạn chỉ có thể quan sát diễn biến trận đấu và không thể nói/vote.
          </div>
        )}

        {/* Bàn Chơi - Sơ Đồ 20 Ghế */}
        <main style={styles.seatsGrid}>
          {[...Array(20)].map((_, index) => {
            const seatNum = index + 1;
            const occupant = playerList.find(p => parseInt(p.seat) === seatNum);
            const isMe = occupant && occupant.id === socket.id;
            
            const remoteUser = occupant ? remoteUsers.find(u => String(u.uid) === String(occupant.id)) : null;

            return (
              <SeatCard
                key={seatNum}
                seatNum={seatNum}
                occupant={occupant ? { ...occupant, roomId } : null}
                isMe={isMe}
                remoteUser={remoteUser}
                isNight={isNight}
                isDay={isDay}
                isHost={isHost}
                myRole={myPlayerInfo?.role}
                localTracks={localTracks}
                isVideoOn={isVideoOn}
                voteCount={voteCounts[seatNum] || 0}
                socket={socket}
              />
            );
          })}
        </main>

        {/* Bảng Nhật Ký Trận Đấu */}
        {publicLogs.length > 0 && (
          <div style={styles.logContainer}>
            <h4 style={{ margin: '0 0 6px 0', color: '#38bdf8' }}>📜 Nhật Ký Diễn Biến Trận Đấu</h4>
            <div style={styles.logBox}>
              {publicLogs.map((log, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>• {log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Khung Chat Phe Sói Vào Ban Đêm */}
        {isNight && myPlayerInfo?.role === 'WOLF' && isAlive && (
          <div style={styles.chatBoxContainer}>
            <h4 style={{ margin: '0 0 8px 0', color: '#ef4444' }}>💬 Kênh Trò Chuyện Phe Sói</h4>
            <div style={styles.chatMessagesArea}>
              {wolfChatList.map((msg, idx) => (
                <div key={idx} style={{ marginBottom: '4px' }}>
                  <strong style={{ color: '#f87171' }}>{msg.sender}: </strong>
                  <span>{msg.message}</span>
                </div>
              ))}
            </div>
            <form onSubmit={sendWolfChat} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <input 
                type="text" 
                value={chatMessage} 
                onChange={e => setChatMessage(e.target.value)} 
                placeholder="Nhập tin nhắn bí mật..."
                style={{ ...styles.input, flex: 1 }}
              />
              <button type="submit" style={styles.sendChatBtn}>Gửi</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// Bảng CSS Inline
const styles = {
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    objectFit: 'cover'
  },
  enableAudioBtn: {
    position: 'absolute',
    bottom: '4px',
    right: '4px',
    zIndex: 5,
    fontSize: '9px',
    padding: '2px 5px',
    background: '#eab308',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
    color: '#000'
  },
  lobbyContainer: {
    backgroundColor: '#020617',
    color: '#fff',
    minHeight: '100vh',
    padding: '24px',
    fontFamily: 'sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  lobbyTitle: {
    color: '#c084fc',
    marginBottom: '16px',
    textAlign: 'center'
  },
  lobbyForm: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    padding: '24px',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px'
  },
  label: {
    color: '#94a3b8',
    fontSize: '13px'
  },
  input: {
    width: '100%',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid #334155',
    background: '#020617',
    color: '#fff',
    boxSizing: 'border-box'
  },
  smallInput: {
    width: '45px',
    padding: '2px 5px',
    borderRadius: '4px',
    border: '1px solid #334155',
    background: '#020617',
    color: '#fff'
  },
  copyBtn: {
    padding: '10px',
    borderRadius: '8px',
    background: '#1e3a8a',
    color: '#93c5fd',
    fontWeight: 'bold',
    cursor: 'pointer',
    border: 'none'
  },
  hostBox: {
    background: '#1e293b',
    padding: '12px 16px',
    borderRadius: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  hostBtn: {
    padding: '6px 16px',
    borderRadius: '6px',
    border: 'none',
    color: '#fff',
    fontWeight: 'bold'
  },
  seatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '8px'
  },
  seatBtn: {
    padding: '10px 4px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '12px'
  },
  submitBtn: {
    padding: '12px',
    background: '#10b981',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: '15px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  gameContainer: {
    color: '#fff',
    minHeight: '100vh',
    padding: '16px',
    fontFamily: 'sans-serif',
    transition: 'background-color 0.8s ease',
    position: 'relative'
  },
  disconnectBanner: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    backgroundColor: '#dc2626',
    color: '#fff',
    textAlign: 'center',
    padding: '8px',
    fontWeight: 'bold',
    zIndex: 9999,
    fontSize: '13px'
  },
  nightEffectsOverlay: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 10
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    padding: '14px',
    borderRadius: '12px',
    border: '1px solid #334155',
    flexWrap: 'wrap',
    gap: '12px'
  },
  leaveBtn: {
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    background: '#475569',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  timerBadge: {
    background: '#334155',
    padding: '2px 8px',
    borderRadius: '4px',
    color: '#38bdf8',
    fontSize: '13px'
  },
  copyBtnHeader: {
    padding: '8px 12px',
    borderRadius: '8px',
    background: '#1e3a8a',
    color: '#93c5fd',
    fontWeight: 'bold',
    border: 'none',
    cursor: 'pointer'
  },
  mediaToggleBtn: {
    padding: '8px 12px',
    borderRadius: '8px',
    color: '#fff',
    border: 'none',
    fontWeight: 'bold'
  },
  hostControlPanel: {
    background: '#1e293b',
    padding: '14px',
    borderRadius: '12px',
    marginBottom: '16px',
    border: '1px solid #d97706'
  },
  hostActionBtn: {
    padding: '6px 12px',
    background: '#312e81',
    color: '#a5b4fc',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  hostMicroBtn: {
    padding: '2px 6px',
    background: '#dc2626',
    color: '#fff',
    fontSize: '10px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  roleBanner: {
    background: '#3b0764',
    border: '1px solid #a855f7',
    padding: '10px 16px',
    borderRadius: '10px',
    marginBottom: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  deadWarningBanner: {
    background: '#450a0a',
    border: '1px solid #ef4444',
    color: '#fca5a5',
    padding: '8px 16px',
    borderRadius: '8px',
    marginBottom: '14px',
    fontSize: '13px',
    textAlign: 'center'
  },
  seatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: '12px'
  },
  emptySeatCard: {
    borderRadius: '12px',
    border: '1px dashed #334155',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '150px',
    opacity: 0.3
  },
  seatCard: {
    position: 'relative',
    borderRadius: '12px',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  seatBadge: {
    background: '#9333ea',
    color: '#fff',
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  voteBadge: {
    background: '#2563eb',
    color: '#fff',
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: 'bold'
  },
  hostBadge: {
    background: '#d97706',
    color: '#fff',
    fontSize: '9px',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  videoBox: {
    width: '100%',
    height: '110px',
    background: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  deadOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#ef4444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '13px',
    zIndex: 10
  },
  actionVoteBtn: {
    padding: '3px 8px',
    borderRadius: '4px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  actionIconBtn: {
    padding: '3px 6px',
    borderRadius: '4px',
    border: 'none',
    background: '#16a34a',
    color: '#fff',
    fontSize: '10px',
    cursor: 'pointer'
  },
  roleActionBtn: {
    padding: '3px 6px',
    borderRadius: '4px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  logContainer: {
    marginTop: '16px',
    background: '#020617',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '12px'
  },
  logBox: {
    maxHeight: '120px',
    overflowY: 'auto'
  },
  chatBoxContainer: {
    marginTop: '16px',
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: '12px',
    padding: '12px'
  },
  chatMessagesArea: {
    maxHeight: '100px',
    overflowY: 'auto',
    fontSize: '12px',
    color: '#e4e4e7'
  },
  sendChatBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    background: '#dc2626',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};