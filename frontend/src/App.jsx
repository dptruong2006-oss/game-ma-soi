import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const socket = io(); // Hoặc cấu hình URL server của bạn
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Global Styles cho các hiệu ứng CSS (Lắc màn hình, Chém dao, Chớp giật, v.v.)
const GlobalStyles = () => (
  <style>{`
    @keyframes shake {
      0% { transform: translate(1px, 1px) rotate(0deg); }
      20% { transform: translate(-3px, 0px) rotate(-1deg); }
      40% { transform: translate(1px, -1px) rotate(1deg); }
      60% { transform: translate(-3px, 1px) rotate(0deg); }
      80% { transform: translate(-1px, -1px) rotate(1deg); }
      100% { transform: translate(1px, -2px) rotate(-1deg); }
    }
    .card-shake {
      animation: shake 0.5s;
      animation-iteration-count: infinite;
    }
    .slash-effect {
      position: fixed;
      inset: 0;
      background: radial-gradient(circle, rgba(239,68,68,0.8) 0%, rgba(0,0,0,0) 70%);
      pointer-events: none;
      z-index: 999;
      animation: flash 0.3s ease-out;
    }
    @keyframes flash {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }
  `}</style>
);

// Component hiển thị Thẻ Ghế Ngồi của từng người chơi
function SeatCard({ seatNum, occupant, isMe, remoteUser, isNight, isDay, isHost, myRole, localTracks, isVideoOn, voteCount, socket }) {
  const videoRef = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(false);

  useEffect(() => {
    if (remoteUser && videoRef.current) {
      if (remoteUser.videoTrack) {
        remoteUser.videoTrack.play(videoRef.current);
      }
      if (remoteUser.audioTrack) {
        remoteUser.audioTrack.play();
        setAudioEnabled(true);
      }
    }
  }, [remoteUser]);

  useEffect(() => {
    if (isMe && videoRef.current && localTracks.videoTrack) {
      if (isVideoOn) {
        localTracks.videoTrack.play(videoRef.current);
      } else {
        localTracks.videoTrack.stop();
      }
    }
  }, [isMe, localTracks.videoTrack, isVideoOn]);

  if (!occupant) {
    return (
      <div style={styles.emptySeatCard}>
        <span style={{ fontSize: '12px', color: '#475569' }}>Ghế {seatNum} (Trống)</span>
      </div>
    );
  }

  const isDead = occupant.status === 'DEAD';

  return (
    <div style={{
      ...styles.seatCard,
      background: isMe ? '#1e293b' : '#0f172a',
      border: isMe ? '2px solid #38bdf8' : '1px solid #334155'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <span style={styles.seatBadge}>Ghế {seatNum}</span>
        {voteCount > 0 && <span style={styles.voteBadge}>🗳️ {voteCount}</span>}
        {occupant.isHost && <span style={styles.hostBadge}>👑 Host</span>}
      </div>

      <div style={styles.videoBox}>
        <div ref={videoRef} style={styles.videoPlayerContainer} />
        {isDead && <div style={styles.deadOverlay}>👻 ĐÃ CHẾT</div>}
      </div>

      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f8fafc', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {occupant.name} {isMe && '(Bạn)'}
      </div>
    </div>
  );
}

export default function App() {
  const [hasJoined, setHasJoined] = useState(false);
  const [roomId, setRoomId] = useState('phong-123');
  const [playerName, setPlayerName] = useState('');
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [existingHost, setExistingHost] = useState(null);
  const [takenSeats, setTakenSeats] = useState([]);
  
  const [isConnected, setIsConnected] = useState(true);
  const [isNight, setIsNight] = useState(false);
  const [isDay, setIsDay] = useState(true);
  const [timeLeft, setTimeLeft] = useState(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isSlashing, setIsSlashing] = useState(false);

  const [playerList, setPlayerList] = useState([]);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [myPlayerInfo, setMyPlayerInfo] = useState(null);
  const [isAlive, setIsAlive] = useState(true);

  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [localTracks, setLocalTracks] = useState({ audioTrack: null, videoTrack: null });

  const [roleSetup, setRoleSetup] = useState({ wolves: 1, seers: 1, guards: 1, witches: 1 });
  const [voteCounts, setVoteCounts] = useState({});
  const [publicLogs, setPublicLogs] = useState([]);
  const [wolfChatList, setWolfChatList] = useState([]);
  const [chatMessage, setChatMessage] = useState('');

  const chatScrollRef = useRef(null);
  const laughAudioRef = useRef(null);
  const windAudioRef = useRef(null);

  useEffect(() => {
    // Lắng nghe các sự kiện Socket cơ bản ở đây
    socket.on('room_update', (data) => {
      if (data.playerList) setPlayerList(data.playerList);
      if (data.takenSeats) setTakenSeats(data.takenSeats);
      if (data.existingHost !== undefined) setExistingHost(data.existingHost);
    });

    return () => {
      socket.off('room_update');
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

        {isHost && (
          <div style={styles.hostControlPanel}>
            <h3 style={{ color: '#f59e0b', margin: '0 0 10px 0' }}>👑 Bảng Điều Khiển Quản Trò (Host)</h3>
            
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

        {!isAlive && (
          <div style={styles.deadWarningBanner}>
            👻 Bạn đã qua đời! Bạn chỉ có thể quan sát diễn biến trận đấu và không thể nói/vote.
          </div>
        )}

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

// Bảng Styles Inline hoàn chỉnh
const styles = {
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    objectFit: 'cover'
  },
  lobbyContainer: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'sans-serif'
  },
  lobbyTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#c084fc',
    marginBottom: '20px',
    textAlign: 'center'
  },
  lobbyForm: {
    background: '#1e293b',
    padding: '24px',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
  },
  label: {
    fontSize: '14px',
    color: '#94a3b8',
    marginBottom: '4px',
    display: 'block'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  smallInput: {
    width: '50px',
    padding: '4px',
    background: '#1e293b',
    border: '1px solid #475569',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
    textAlign: 'center'
  },
  copyBtn: {
    padding: '8px 12px',
    background: '#334155',
    color: '#38bdf8',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  hostBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#0f172a',
    padding: '12px',
    borderRadius: '8px'
  },
  hostBtn: {
    padding: '8px 16px',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    fontSize: '13px'
  },
  seatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px'
  },
  seatBtn: {
    padding: '10px 4px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    transition: 'all 0.2s'
  },
  submitBtn: {
    padding: '14px',
    background: '#9333ea',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '16px',
    cursor: 'pointer',
    marginTop: '10px'
  },
  gameContainer: {
    minHeight: '100vh',
    color: '#f8fafc',
    padding: '16px',
    fontFamily: 'sans-serif',
    transition: 'background-color 0.5s ease',
    position: 'relative'
  },
  disconnectBanner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    background: '#dc2626',
    color: '#fff',
    textAlign: 'center',
    padding: '6px',
    zIndex: 1000,
    fontSize: '13px',
    fontWeight: 'bold'
  },
  nightEffectsOverlay: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    marginBottom: '16px',
    flexWrap: 'wrap',
    gap: '12px'
  },
  leaveBtn: {
    padding: '6px 12px',
    background: '#475569',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  timerBadge: {
    background: '#334155',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px'
  },
  copyBtnHeader: {
    padding: '6px 12px',
    background: '#0284c7',
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
    background: '#1e293b',
    border: '1px solid #f59e0b',
    padding: '14px',
    borderRadius: '8px',
    marginBottom: '16px'
  },
  hostActionBtn: {
    padding: '6px 12px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  roleBanner: {
    background: '#2e1065',
    border: '1px solid #7e22ce',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  deadWarningBanner: {
    background: '#450a0a',
    border: '1px solid #991b1b',
    color: '#fca5a5',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px'
  },
  seatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
    marginBottom: '16px'
  },
  emptySeatCard: {
    height: '140px',
    border: '1px dashed #334155',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15, 23, 42, 0.4)'
  },
  seatCard: {
    height: '140px',
    borderRadius: '8px',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'relative',
    boxSizing: 'border-box'
  },
  seatBadge: {
    fontSize: '10px',
    background: '#334155',
    padding: '2px 6px',
    borderRadius: '4px',
    color: '#cbd5e1'
  },
  voteBadge: {
    fontSize: '10px',
    background: '#dc2626',
    padding: '2px 6px',
    borderRadius: '4px',
    color: '#fff',
    fontWeight: 'bold'
  },
  hostBadge: {
    fontSize: '10px',
    background: '#d97706',
    padding: '2px 6px',
    borderRadius: '4px',
    color: '#fff'
  },
  videoBox: {
    width: '100%',
    flex: 1,
    background: '#020617',
    borderRadius: '4px',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  deadOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ef4444',
    fontSize: '12px',
    fontWeight: 'bold',
    zIndex: 10
  },
  logContainer: {
    background: '#1e293b',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid #334155'
  },
  logBox: {
    maxHeight: '100px',
    overflowY: 'auto'
  },
  chatBoxContainer: {
    background: '#1e293b',
    border: '1px solid #ef4444',
    padding: '12px',
    borderRadius: '8px'
  },
  chatMessagesArea: {
    height: '120px',
    overflowY: 'auto',
    background: '#0f172a',
    padding: '8px',
    borderRadius: '6px',
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