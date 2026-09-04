import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const SOCKET_SERVER_URL = 'https://game-ma-soi.onrender.com';
const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475";

const socket = io(SOCKET_SERVER_URL, { autoConnect: true });
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// CSS Inject cho hiệu ứng ban đêm & animation
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

// Component phát Video/Audio Agora
const AgoraVideoPlayer = memo(({ videoTrack, audioTrack, isLocal }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !videoTrack) return;
    try {
      videoTrack.play(containerRef.current);
    } catch (e) {
      console.error("Lỗi phát video:", e);
    }

    return () => {
      try {
        if (videoTrack && videoTrack.isPlaying) videoTrack.stop();
      } catch (e) {}
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!isLocal && audioTrack) {
      try {
        audioTrack.play();
      } catch (e) {
        console.error("Lỗi phát audio:", e);
      }
    }
  }, [audioTrack, isLocal]);

  return (
    <div ref={containerRef} style={styles.videoPlayerContainer} className="agora-video-player">
      {!isLocal && audioTrack && (
        <button 
          onClick={() => audioTrack.play()} 
          style={styles.enableAudioBtn}
        >
          🔊 Mở mic
        </button>
      )}
    </div>
  );
});

// Component hiển thị ghế
const SeatCard = memo(({ 
  seatNum, occupant, isMe, remoteUser, isNight, isDay, isHost, myRole, localTracks, isVideoOn, socket 
}) => {
  if (!occupant) {
    return (
      <div style={styles.emptySeatCard}>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>Ghế #{seatNum} (Trống)</span>
      </div>
    );
  }

  const canSeeStream = () => {
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
        border: isMe ? '2px solid #a855f7' : '1px solid #334155',
        opacity: occupant.isAlive === false ? 0.5 : 1
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '6px' }}>
        <span style={styles.seatBadge}>Ghế #{seatNum}</span>
        {occupant.isHost && <span style={styles.hostBadge}>👑 Host</span>}
      </div>

      <div style={styles.videoBox}>
        {occupant.isAlive === false && (
          <div style={styles.deadOverlay}>👻 ĐÃ CHẾT</div>
        )}

        {canSeeStream() ? (
          isMe ? (
            localTracks.videoTrack && isVideoOn ? (
              <AgoraVideoPlayer videoTrack={localTracks.videoTrack} isLocal={true} />
            ) : (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Tắt Cam</span>
            )
          ) : (
            remoteUser?.videoTrack ? (
              <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} />
            ) : (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Chờ Video</span>
            )
          )
        ) : (
          <div style={{ color: '#64748b', fontSize: '11px', textAlign: 'center' }}>
            🌙 Đang ngủ...
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginTop: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
          {occupant.name} {isMe ? "(Bạn)" : ""}
        </span>

        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {isDay && occupant.isAlive && !isMe && (
            <button 
              onClick={() => socket.emit('cast_vote', { roomId: occupant.roomId, targetSeat: seatNum })} 
              style={styles.actionVoteBtn}
            >
              🗳️ Vote
            </button>
          )}

          {isNight && occupant.isAlive && (
            <>
              {isHost && (
                <>
                  <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={styles.actionIconBtn}>🛡️</button>
                  <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ ...styles.actionIconBtn, background: '#dc2626' }}>🐺</button>
                  <button onClick={() => socket.emit('apply_night_action', { roomId: occupant.roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ ...styles.actionIconBtn, background: '#9333ea' }}>🔮</button>
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
            </>
          )}
        </div>
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

  // Socket Event Handler Stable Setup
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

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('timer_update', handleTimerUpdate);
    socket.on('room_state_update', handleRoomStateUpdate);
    socket.on('wolf_message_receive', handleWolfMessage);
    socket.on('seer_result', handleSeerResult);
    socket.on('notification', handleNotification);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('timer_update', handleTimerUpdate);
      socket.off('room_state_update', handleRoomStateUpdate);
      socket.off('wolf_message_receive', handleWolfMessage);
      socket.off('seer_result', handleSeerResult);
      socket.off('notification', handleNotification);
    };
  }, [playSoundEffect]);

  // Audio Ban Đêm
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

  // Bật/tắt Micro và Camera trực tiếp
  useEffect(() => {
    if (localTracks.audioTrack) {
      const canSpeak = myPlayerInfo?.canSpeak !== false;
      localTracks.audioTrack.setEnabled(canSpeak && isMicOn);
    }
  }, [myPlayerInfo?.canSpeak, isMicOn, localTracks.audioTrack]);

  useEffect(() => {
    if (localTracks.videoTrack) {
      const canCam = myPlayerInfo?.canCam !== false;
      localTracks.videoTrack.setEnabled(canCam && isVideoOn);
    }
  }, [myPlayerInfo?.canCam, isVideoOn, localTracks.videoTrack]);

  // Khởi tạo Agora RTC (Đã sửa lỗi UID)
  useEffect(() => {
    if (!hasJoined) return;
    let isMounted = true;
    let createdAudioTrack = null;
    let createdVideoTrack = null;

    const initAgora = async () => {
      try {
        agoraClient.on('user-published', async (user, mediaType) => {
          await agoraClient.subscribe(user, mediaType);
          if (isMounted) {
            setRemoteUsers(prev => {
              // Ép kiểu String để so sánh chính xác UID với socket.id
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

        // Truyền socket.id sang API backend để cấp Token khớp chính xác UID
        const res = await fetch(`${SOCKET_SERVER_URL}/api/agora-token?channelName=${roomId}&uid=${socket.id}`);
        const data = await res.json();
        await agoraClient.join(AGORA_APP_ID, roomId, data.token || null, socket.id);

        try { createdAudioTrack = await AgoraRTC.createMicrophoneAudioTrack(); } catch (e) { setIsMicOn(false); }
        try { createdVideoTrack = await AgoraRTC.createCameraVideoTrack(); } catch (e) { setIsVideoOn(false); }

        if (isMounted) {
          setLocalTracks({ audioTrack: createdAudioTrack, videoTrack: createdVideoTrack });
          const tracks = [];
          if (createdAudioTrack) tracks.push(createdAudioTrack);
          if (createdVideoTrack) tracks.push(createdVideoTrack);
          if (tracks.length > 0) await agoraClient.publish(tracks);
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

    setHasJoined(true);
    socket.emit('join_room', { roomId, name: playerName.trim(), seat: selectedSeat, isHost });
  };

  const handleLeaveRoom = async () => {
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

  // Màn hình chờ
  if (!hasJoined) {
    return (
      <div style={styles.lobbyContainer}>
        <GlobalStyles />
        <h1 style={styles.lobbyTitle}>🐺 SƠ ĐỒ CHỌN GHẾ MA SÓI</h1>
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
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Đăng ký Quản Trò:</span>
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
              Chọn Ghế (1 - 20):
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
            VÀO BÀN (GHẾ SỐ {selectedSeat || '...'})
          </button>
        </form>
      </div>
    );
  }

  // Màn hình chơi chính
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
          ⚠️ Mất kết nối với máy chủ! Đang tự động kết nối lại...
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
        {/* Header */}
        <header style={{
          ...styles.header,
          background: isNight ? '#020617' : '#1e293b',
          borderColor: isNight ? '#1e1b4b' : '#334155'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={handleLeaveRoom} style={styles.leaveBtn}>⬅️ Thoát</button>
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
              style={{
                ...styles.mediaToggleBtn,
                background: isMicOn ? '#059669' : '#dc2626'
              }}
            >
              {isMicOn ? '🎤 Mic Bật' : '🎙️ Mic Tắt'}
            </button>
            <button 
              onClick={() => setIsVideoOn(!isVideoOn)} 
              style={{
                ...styles.mediaToggleBtn,
                background: isVideoOn ? '#059669' : '#dc2626'
              }}
            >
              {isVideoOn ? '📹 Cam Bật' : '📷 Cam Tắt'}
            </button>
          </div>
        </header>

        {/* Panel Host */}
        {isHost && (
          <div style={styles.hostControlPanel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ color: '#f59e0b', margin: 0 }}>👑 Bảng Điều Khiển Quản Trò</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => socket.emit('change_phase', { roomId, phase: 'NIGHT' })} style={styles.hostActionBtn}>🌙 Đổi sang Đêm</button>
                <button onClick={() => socket.emit('change_phase', { roomId, phase: 'DAY' })} style={styles.hostActionBtn}>☀️ Đổi sang Ngày</button>
                <button onClick={() => socket.emit('clear_votes', { roomId })} style={styles.hostActionBtn}>🧹 Xóa Bảng Vote</button>
                <button onClick={() => socket.emit('start_game', { roomId })} style={{ ...styles.hostActionBtn, background: '#dc2626' }}>🚀 Bắt Đầu Ván Đấu</button>
              </div>
            </div>
          </div>
        )}

        {/* Thông tin vai trò */}
        {myPlayerInfo?.role && (
          <div style={styles.roleBanner}>
            <span>🔒 Vai trò bí mật của bạn:</span>
            <strong style={{ color: '#facc15' }}>
              {myPlayerInfo.role === 'WOLF' && '🐺 Sói'}
              {myPlayerInfo.role === 'GUARD' && '🛡️ Bảo Vệ'}
              {myPlayerInfo.role === 'SEER' && '🔮 Tiên Tri'}
              {myPlayerInfo.role === 'WITCH' && '🧪 Phù Thủy'}
              {myPlayerInfo.role === 'INFECTED' && '🦠 Người Bệnh'}
              {myPlayerInfo.role === 'VILLAGER' && '🧑 Dân Làng'}
            </strong>
          </div>
        )}

        {/* Sơ đồ 20 ghế */}
        <main style={styles.seatsGrid}>
          {[...Array(20)].map((_, index) => {
            const seatNum = index + 1;
            const occupant = playerList.find(p => parseInt(p.seat) === seatNum);
            const isMe = occupant && occupant.id === socket.id;
            
            // Ép kiểu String khi so sánh UID giữa occupant.id và u.uid của Agora
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
                socket={socket}
              />
            );
          })}
        </main>

        {/* Nhật ký diễn biến Game */}
        {publicLogs.length > 0 && (
          <div style={styles.logContainer}>
            <h4 style={{ margin: '0 0 6px 0', color: '#38bdf8' }}>📜 Nhật Ký Trận Đấu</h4>
            <div style={styles.logBox}>
              {publicLogs.map((log, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>• {log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Chat Phe Sói */}
        {isNight && myPlayerInfo?.role === 'WOLF' && (
          <div style={styles.chatBoxContainer}>
            <h4 style={{ margin: '0 0 8px 0', color: '#ef4444' }}>💬 Trò chuyện Phe Sói Ban Đêm</h4>
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
                placeholder="Nhập tin nhắn..."
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

const styles = {
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    objectFit: 'cover'
  },
  enableAudioBtn: {
    position: 'absolute',
    bottom: '5px',
    right: '5px',
    zIndex: 5,
    fontSize: '9px',
    padding: '2px 6px',
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
    marginBottom: '16px'
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
    gap: '20px'
  },
  label: {
    color: '#94a3b8',
    fontSize: '14px'
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
    gap: '10px'
  },
  seatBtn: {
    padding: '10px',
    borderRadius: '8px',
    fontWeight: 'bold'
  },
  submitBtn: {
    padding: '12px',
    background: '#10b981',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: '16px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  gameContainer: {
    color: '#fff',
    minHeight: '100vh',
    padding: '24px',
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
    padding: '10px',
    fontWeight: 'bold',
    zIndex: 9999,
    fontSize: '14px'
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
    marginBottom: '20px',
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid #334155',
    flexWrap: 'wrap',
    gap: '12px'
  },
  leaveBtn: {
    padding: '8px 12px',
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
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  hostControlPanel: {
    background: '#1e293b',
    padding: '16px',
    borderRadius: '12px',
    marginBottom: '20px',
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
  roleBanner: {
    background: '#3b0764',
    border: '1px solid #a855f7',
    padding: '10px 20px',
    borderRadius: '10px',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  seatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '14px'
  },
  emptySeatCard: {
    borderRadius: '14px',
    border: '1px dashed #334155',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '160px',
    opacity: 0.3
  },
  seatCard: {
    position: 'relative',
    borderRadius: '14px',
    background: '#0f172a',
    padding: '10px',
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
  hostBadge: {
    background: '#d97706',
    color: '#fff',
    fontSize: '9px',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  videoBox: {
    width: '100%',
    height: '120px',
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
    zIndex: 4,
    color: '#ef4444',
    fontWeight: 'bold',
    background: 'rgba(0,0,0,0.7)',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionVoteBtn: {
    fontSize: '9px',
    padding: '2px 6px',
    background: '#eab308',
    color: '#000',
    border: 'none',
    borderRadius: '3px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  actionIconBtn: {
    fontSize: '9px',
    padding: '2px 4px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer'
  },
  roleActionBtn: {
    fontSize: '9px',
    padding: '2px 6px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '3px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  logContainer: {
    marginTop: '20px',
    background: '#020617',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #1e293b'
  },
  logBox: {
    maxHeight: '100px',
    overflowY: 'auto'
  },
  chatBoxContainer: {
    marginTop: '16px',
    background: '#450a0a',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #991b1b'
  },
  chatMessagesArea: {
    maxHeight: '120px',
    overflowY: 'auto',
    fontSize: '13px'
  },
  sendChatBtn: {
    padding: '8px 16px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};