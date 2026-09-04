import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
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
  const chatScrollRef = useRef(null);
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
  const voteCounts = useMemo(() => {
    const counts = {};
    if (roomState.votes) {
      Object.values(roomState.votes).forEach(targetSeat => {
        counts[targetSeat] = (counts[targetSeat] || 0) + 1;
      });
    }
    return counts;
  }, [roomState.votes]);

  // Cuộn tin nhắn Sói xuống đáy khi có chat mới
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [wolfChatList]);

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
            <div ref={chatScrollRef} style={styles.chatMessagesArea}>
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

// Bảng CSS Inline đầy đủ
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
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  lobbyTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#a855f7',
    marginBottom: '20px',
    textAlign: 'center'
  },
  lobbyForm: {
    backgroundColor: '#0f172a',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #334155',
    width: '100%',
    maxWidth: '650px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  label: {
    fontSize: '13px',
    color: '#94a3b8',
    fontWeight: 'bold',
    marginBottom: '4px',
    display: 'block'
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    border: '1px solid #475569',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none'
  },
  smallInput: {
    width: '45px',
    padding: '2px 4px',
    backgroundColor: '#1e293b',
    border: '1px solid #475569',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    marginLeft: '4px'
  },
  copyBtn: {
    padding: '8px 12px',
    backgroundColor: '#334155',
    color: '#38bdf8',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  hostBox: {
    display: 'flex',
    justify: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: '#1e293b',
    borderRadius: '8px'
  },
  hostBtn: {
    padding: '6px 12px',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 'bold'
  },
  seatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat( auto-fill, minmax(110px, 1fr) )',
    gap: '8px'
  },
  seatBtn: {
    padding: '10px 4px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    textAlign: 'center'
  },
  submitBtn: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#9333ea',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '10px'
  },
  gameContainer: {
    color: '#fff',
    minHeight: '100vh',
    padding: '16px',
    boxSizing: 'border-box',
    position: 'relative'
  },
  disconnectBanner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#dc2626',
    color: '#fff',
    textAlign: 'center',
    padding: '6px',
    fontSize: '13px',
    fontWeight: 'bold',
    zIndex: 1000
  },
  nightEffectsOverlay: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10
  },
  header: {
    display: 'flex',
    justify: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid',
    marginBottom: '16px',
    flexWrap: 'wrap',
    gap: '12px'
  },
  leaveBtn: {
    padding: '6px 10px',
    backgroundColor: '#475569',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  timerBadge: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px'
  },
  copyBtnHeader: {
    padding: '6px 10px',
    backgroundColor: '#0284c7',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  mediaToggleBtn: {
    padding: '6px 12px',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  hostControlPanel: {
    backgroundColor: '#1e293b',
    border: '1px solid #d97706',
    padding: '14px',
    borderRadius: '10px',
    marginBottom: '16px'
  },
  hostActionBtn: {
    padding: '6px 12px',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  roleBanner: {
    backgroundColor: '#312e81',
    border: '1px solid #6366f1',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px'
  },
  deadWarningBanner: {
    backgroundColor: '#450a0a',
    border: '1px solid #991b1b',
    color: '#fca5a5',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px',
    textAlign: 'center'
  },
  seatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat( auto-fill, minmax(140px, 1fr) )',
    gap: '12px',
    marginBottom: '20px'
  },
  seatCard: {
    borderRadius: '8px',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxSizing: 'border-box',
    minHeight: '170px'
  },
  emptySeatCard: {
    borderRadius: '8px',
    border: '1px dashed #334155',
    backgroundColor: '#0f172a',
    padding: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '170px'
  },
  seatBadge: {
    fontSize: '10px',
    color: '#94a3b8',
    fontWeight: 'bold'
  },
  voteBadge: {
    fontSize: '10px',
    backgroundColor: '#ca8a04',
    color: '#fff',
    padding: '1px 4px',
    borderRadius: '4px',
    fontWeight: 'bold'
  },
  hostBadge: {
    fontSize: '10px',
    color: '#f59e0b',
    fontWeight: 'bold'
  },
  videoBox: {
    width: '100%',
    height: '90px',
    backgroundColor: '#020617',
    borderRadius: '6px',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  deadOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: '12px',
    zIndex: 10
  },
  actionVoteBtn: {
    padding: '2px 6px',
    backgroundColor: '#ca8a04',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  actionIconBtn: {
    padding: '3px 6px',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer'
  },
  roleActionBtn: {
    width: '100%',
    padding: '4px',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 'bold',
    marginTop: '2px'
  },
  hostMicroBtn: {
    flex: 1,
    padding: '2px 4px',
    backgroundColor: '#475569',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '10px',
    cursor: 'pointer'
  },
  logContainer: {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px'
  },
  logBox: {
    maxHeight: '120px',
    overflowY: 'auto'
  },
  chatBoxContainer: {
    backgroundColor: '#18181b',
    border: '1px solid #7f1d1d',
    borderRadius: '8px',
    padding: '12px',
    marginTop: '16px'
  },
  chatMessagesArea: {
    maxHeight: '130px',
    overflowY: 'auto',
    backgroundColor: '#090d16',
    padding: '8px',
    borderRadius: '6px',
    fontSize: '13px'
  },
  sendChatBtn: {
    padding: '8px 16px',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};