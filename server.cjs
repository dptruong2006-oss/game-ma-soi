import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

// Thay bằng URL Server Render của bạn
const SERVER_URL = "https://game-ma-soi.onrender.com"; 

const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true
});

const clientAgora = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

export default function WerewolfGame() {
  // --- States Quản lý Người chơi & Phòng ---
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState("phong-mac-dinh-123");
  const [userName, setUserName] = useState("");
  const [mySeat, setMySeat] = useState(1);
  const [userId] = useState(() => "user_" + Math.random().toString(36).substring(2, 9));

  // --- States Game Sync từ Server ---
  const [roomState, setRoomState] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [notifications, setNotifications] = useState([]);

  // --- States Media (Cam/Mic) ---
  const [micActive, setMicActive] = useState(false);
  const [camActive, setCamActive] = useState(false);
  const localAudioTrack = useRef(null);
  const localVideoTrack = useRef(null);

  // --- States Chức năng Đêm & Modal ---
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [seerResultModal, setSeerResultModal] = useState(null);
  const [witchTarget, setWitchTarget] = useState(null);

  // --- States Chat ---
  const [wolfChatMsg, setWolfChatMsg] = useState("");
  const [wolfLogs, setWolfLogs] = useState([]);
  const [ghostChatMsg, setGhostChatMsg] = useState("");
  const [ghostLogs, setGhostLogs] = useState([]);

  // --- Form Settings state cho Host ---
  const [tempSettings, setTempSettings] = useState({
    wolfCount: 2,
    guardCount: 1,
    seerCount: 1,
    witchCount: 1,
    infectedCount: 0,
    villagerCount: 2,
    dayDuration: 120,
    nightDuration: 60
  });

  // 1. Lắng nghe các sự kiện WebSocket
  useEffect(() => {
    socket.connect();

    socket.on('room_state_update', (data) => {
      setRoomState(data);
      if (data.settings) setTempSettings(data.settings);
    });

    socket.on('timer_update', ({ timeLeft }) => {
      setTimeLeft(timeLeft);
    });

    socket.on('notification', ({ message }) => {
      setNotifications(prev => [message, ...prev.slice(0, 4)]);
    });

    socket.on('wolf_message_receive', (msg) => {
      setWolfLogs(prev => [...prev, msg]);
    });

    socket.on('ghost_message_receive', (msg) => {
      setGhostLogs(prev => [...prev, msg]);
    });

    socket.on('seer_result', (result) => {
      setSeerResultModal(result);
    });

    socket.on('witch_target_info', ({ targetSeat }) => {
      setWitchTarget(targetSeat);
    });

    return () => {
      socket.off('room_state_update');
      socket.off('timer_update');
      socket.off('notification');
      socket.off('wolf_message_receive');
      socket.off('ghost_message_receive');
      socket.off('seer_result');
      socket.off('witch_target_info');
      socket.disconnect();
    };
  }, []);

  // 2. Tham gia phòng
  const handleJoinRoom = () => {
    if (!userName.trim()) return alert("Vui lòng nhập tên của bạn!");
    
    socket.emit('join_room', {
      roomId,
      userId,
      name: userName,
      seat: parseInt(mySeat),
      isHost: false
    });

    joinAgoraChannel(roomId, userId);
    setJoined(true);
  };

  // 3. Khởi tạo Agora RTC
  const joinAgoraChannel = async (channel, uid) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/agora-token?channelName=${channel}&uid=${uid}`);
      const data = await res.json();
      await clientAgora.join(process.env.REACT_APP_AGORA_APP_ID || "f8b9cc77ff234823b6e4685127ebf475", channel, data.token, uid);
    } catch (err) {
      console.error("Lỗi tham gia Agora:", err);
    }
  };

  // Bật/Tắt Microphone
  const toggleMic = async () => {
    if (!micActive) {
      localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
      await clientAgora.publish([localAudioTrack.current]);
      setMicActive(true);
    } else {
      if (localAudioTrack.current) {
        localAudioTrack.current.stop();
        localAudioTrack.current.close();
      }
      setMicActive(false);
    }
  };

  // Bật/Tắt Camera
  const toggleCam = async () => {
    if (!camActive) {
      localVideoTrack.current = await AgoraRTC.createCameraVideoTrack();
      await clientAgora.publish([localVideoTrack.current]);
      localVideoTrack.current.play(`cam-container-${userId}`);
      setCamActive(true);
    } else {
      if (localVideoTrack.current) {
        localVideoTrack.current.stop();
        localVideoTrack.current.close();
      }
      setCamActive(false);
    }
  };

  // --- Các hành động của Host ---
  const handleSaveSettings = () => {
    socket.emit('update_settings', { roomId, settings: tempSettings });
    setShowSettingsModal(false);
  };

  const handleStartGame = () => {
    socket.emit('start_game', { roomId });
  };

  const handleChangePhase = (phase) => {
    socket.emit('change_phase', { roomId, phase });
  };

  const handleClearVotes = () => {
    socket.emit('clear_votes', { roomId });
  };

  // --- Các hành động Người Chơi ---
  const handleCastVote = (targetSeat) => {
    socket.emit('cast_vote', { roomId, targetSeat });
  };

  const handleNightAction = (targetSeat, actionType) => {
    socket.emit('apply_night_action', { roomId, targetSeat, actionType });
  };

  const handleSendWolfChat = () => {
    if (!wolfChatMsg.trim()) return;
    socket.emit('send_wolf_chat', { roomId, message: wolfChatMsg });
    setWolfChatMsg("");
  };

  const handleSendGhostChat = () => {
    if (!ghostChatMsg.trim()) return;
    socket.emit('send_ghost_chat', { roomId, message: ghostChatMsg });
    setGhostChatMsg("");
  };

  // Lấy thông tin bản thân từ RoomState
  const myPlayer = roomState?.players?.[userId];
  const isHost = myPlayer?.isHost;

  if (!joined) {
    return (
      <div style={styles.loginContainer}>
        <h2>🐺 Ma Sói - Tham Gia Phòng</h2>
        <input style={styles.input} placeholder="Tên người chơi" value={userName} onChange={e => setUserName(e.target.value)} />
        <input style={styles.input} placeholder="Mã Phòng" value={roomId} onChange={e => setRoomId(e.target.value)} />
        <select style={styles.input} value={mySeat} onChange={e => setMySeat(e.target.value)}>
          {[...Array(15)].map((_, i) => (
            <option key={i + 1} value={i + 1}>Ghế #{i + 1}</option>
          ))}
        </select>
        <button style={styles.btnPrimary} onClick={handleJoinRoom}>Vào Phòng Game</button>
      </div>
    );
  }

  return (
    <div style={styles.appContainer}>
      {/* 1. Header & Thanh trạng thái */}
      <header style={styles.header}>
        <div>
          <h3>PHÒNG: {roomId}</h3>
          <span>Thời gian: <b>{roomState?.phase === 'NIGHT' ? '🌙 BAN ĐÊM' : roomState?.phase === 'DAY' ? '☀️ BAN NGÀY' : '⏳ PHÒNG CHỜ'}</b> ({timeLeft}s)</span>
        </div>

        <div style={styles.actionGroup}>
          <button style={micActive ? styles.btnSuccess : styles.btnDanger} onClick={toggleMic} disabled={!myPlayer?.canSpeak}>
            {micActive ? '🎙️ Mic Bật' : '🎙️ Mic Tắt'}
          </button>
          <button style={camActive ? styles.btnSuccess : styles.btnDanger} onClick={toggleCam} disabled={!myPlayer?.canCam}>
            {camActive ? '📹 Cam Bật' : '📹 Cam Tắt'}
          </button>
          <button style={styles.btnSecondary} onClick={() => window.location.reload()}>Thoát</button>
        </div>
      </header>

      {/* Thông báo sự kiện */}
      {notifications.length > 0 && (
        <div style={styles.notificationBar}>
          {notifications[0]}
        </div>
      )}

      {/* 2. Bảng Điều Khiển Quản Trò (Host Only) */}
      {isHost && (
        <div style={styles.hostPanel}>
          <span>👑 <b>Bảng Điều Khiển Quản Trò</b></span>
          <div style={styles.actionGroup}>
            <button style={styles.btnWarning} onClick={() => setShowSettingsModal(true)}>⚙️ Cài Đặt Ván Đấu</button>
            <button style={styles.btnInfo} onClick={() => handleChangePhase('NIGHT')}>🌙 Sang Đêm</button>
            <button style={styles.btnInfo} onClick={() => handleChangePhase('DAY')}>☀️ Sang Ngày</button>
            <button style={styles.btnWarning} onClick={handleClearVotes}>🧹 Xóa Bảng Vote</button>
            <button style={styles.btnPrimary} onClick={handleStartGame}>🚀 Bắt Đầu Ván Đấu</button>
          </div>
        </div>
      )}

      {/* 3. Hiển thị vai trò bí mật */}
      <div style={styles.roleBar}>
        🔒 Vai trò bí mật của bạn: <b>{myPlayer?.role || 'Chưa chia bài'}</b>
        {!myPlayer?.isAlive && <span style={{ color: 'red', marginLeft: '10px' }}>(ĐÃ CHẾT ☠️)</span>}
      </div>

      {/* 4. Sơ đồ các ghế người chơi (Grid 14-15 ghế) */}
      <div style={styles.seatsGrid}>
        {[...Array(15)].map((_, idx) => {
          const seatNum = idx + 1;
          const playerOnSeat = Object.values(roomState?.players || {}).find(p => p.seat === seatNum);

          return (
            <div key={seatNum} style={{ ...styles.seatCard, border: playerOnSeat ? '2px solid #6366f1' : '1px dashed #4b5563' }}>
              <div style={styles.seatHeader}>
                <span>Ghế #{seatNum}</span>
                {playerOnSeat?.isHost && <span style={styles.hostBadge}>Host</span>}
              </div>

              {playerOnSeat ? (
                <div style={styles.seatBody}>
                  <div id={`cam-container-${playerOnSeat.userId}`} style={styles.camBox}>
                    {!camActive && <span>{playerOnSeat.name}</span>}
                  </div>
                  
                  <div style={styles.playerInfo}>
                    <b>{playerOnSeat.name} {playerOnSeat.userId === userId ? '(Bạn)' : ''}</b>
                    <div>Trạng thái: {playerOnSeat.isAlive ? '🟢 Sống' : '☠️ Đã chết'}</div>
                    {playerOnSeat.role && <div>Bài: {playerOnSeat.role}</div>}
                  </div>

                  {/* Thao tác tương tác ban ngày (Vote) */}
                  {roomState?.phase === 'DAY' && myPlayer?.isAlive && playerOnSeat.isAlive && (
                    <button style={styles.btnVote} onClick={() => handleCastVote(seatNum)}>
                      ✋ Vote ({Object.values(roomState.votes || {}).filter(v => v === seatNum).length})
                    </button>
                  )}

                  {/* Thao tác tương tác ban đêm theo Vai trò */}
                  {roomState?.phase === 'NIGHT' && myPlayer?.isAlive && playerOnSeat.isAlive && (
                    <div style={styles.nightActions}>
                      {myPlayer.role === 'WOLF' && (
                        <button style={styles.btnDangerSmall} onClick={() => handleNightAction(seatNum, 'WOLF')}>🐺 Cắn</button>
                      )}
                      {myPlayer.role === 'GUARD' && (
                        <button style={styles.btnInfoSmall} onClick={() => handleNightAction(seatNum, 'GUARD')}>🛡️ Bảo vệ</button>
                      )}
                      {myPlayer.role === 'SEER' && (
                        <button style={styles.btnWarningSmall} onClick={() => handleNightAction(seatNum, 'SEER_CHECK')}>👁️ Soi</button>
                      )}
                      {myPlayer.role === 'WITCH' && (
                        <button style={styles.btnDangerSmall} onClick={() => handleNightAction(seatNum, 'WITCH_POISON')}>🧪 Độc</button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={styles.emptySeat}>Ghế Trống</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5. Chức năng riêng của Phù Thủy (Cứu người bị cắn) */}
      {roomState?.phase === 'NIGHT' && myPlayer?.role === 'WITCH' && myPlayer?.isAlive && (
        <div style={styles.specialPanel}>
          🧪 <b>Bảng Phù Thủy:</b> 
          {witchTarget ? ` Đêm nay Ghế #${witchTarget} bị Sói cắn!` : ' Sói chưa cắn ai.'}
          {witchTarget && !myPlayer.hasUsedHeal && (
            <button style={styles.btnSuccess} onClick={() => handleNightAction(witchTarget, 'WITCH_SAVE')}>
              💊 Dùng Bình Cứu Ghế #{witchTarget}
            </button>
          )}
        </div>
      )}

      {/* 6. Trò chuyện Sói & Chat Hồn Ma */}
      <div style={styles.chatSection}>
        {/* Chat riêng Sói */}
        {myPlayer?.role === 'WOLF' && (
          <div style={styles.chatBox}>
            <h4>🐺 Trò Chuyện Phe Sói</h4>
            <div style={styles.chatLogs}>
              {wolfLogs.map((m, i) => (
                <div key={i}><b>{m.sender}:</b> {m.message}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input style={styles.inputSmall} value={wolfChatMsg} onChange={e => setWolfChatMsg(e.target.value)} placeholder="Nhắn cho Sói..." />
              <button style={styles.btnPrimarySmall} onClick={handleSendWolfChat}>Gửi</button>
            </div>
          </div>
        )}

        {/* Chat Hồn Ma */}
        {!myPlayer?.isAlive && (
          <div style={styles.chatBox}>
            <h4>👻 Trò Chuyện Hồn Ma</h4>
            <div style={styles.chatLogs}>
              {ghostLogs.map((m, i) => (
                <div key={i}><b>{m.sender}:</b> {m.message}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input style={styles.inputSmall} value={ghostChatMsg} onChange={e => setGhostChatMsg(e.target.value)} placeholder="Nhắn cho ma..." />
              <button style={styles.btnPrimarySmall} onClick={handleSendGhostChat}>Gửi</button>
            </div>
          </div>
        )}
      </div>

      {/* --- Modal Popups --- */}
      {/* Modal 1: Cài đặt phòng (Host) */}
      {showSettingsModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBody}>
            <h3>⚙️ Cài Đặt Luật Chơi & Vai Trò</h3>
            
            <div style={styles.formRow}>
              <label>⏱️ T.Gian Ban Ngày (giây):</label>
              <input type="number" value={tempSettings.dayDuration} onChange={e => setTempSettings({ ...tempSettings, dayDuration: parseInt(e.target.value) })} />
            </div>
            <div style={styles.formRow}>
              <label>⏱️ T.Gian Ban Đêm (giây):</label>
              <input type="number" value={tempSettings.nightDuration} onChange={e => setTempSettings({ ...tempSettings, nightDuration: parseInt(e.target.value) })} />
            </div>

            <hr />
            <h4>Số lượng Vai Trò:</h4>
            <div style={styles.formRow}><label>🐺 Số Sói:</label><input type="number" value={tempSettings.wolfCount} onChange={e => setTempSettings({ ...tempSettings, wolfCount: parseInt(e.target.value) })} /></div>
            <div style={styles.formRow}><label>👁️ Tiên Tri:</label><input type="number" value={tempSettings.seerCount} onChange={e => setTempSettings({ ...tempSettings, seerCount: parseInt(e.target.value) })} /></div>
            <div style={styles.formRow}><label>🛡️ Bảo Vệ:</label><input type="number" value={tempSettings.guardCount} onChange={e => setTempSettings({ ...tempSettings, guardCount: parseInt(e.target.value) })} /></div>
            <div style={styles.formRow}><label>🧪 Phù Thủy:</label><input type="number" value={tempSettings.witchCount} onChange={e => setTempSettings({ ...tempSettings, witchCount: parseInt(e.target.value) })} /></div>

            <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
              <button style={styles.btnSuccess} onClick={handleSaveSettings}>Lưu Cấu Hình</button>
              <button style={styles.btnDanger} onClick={() => setShowSettingsModal(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Kết quả soi của Tiên Tri */}
      {seerResultModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBody}>
            <h3>👁️ Kết Quả Soi Bài</h3>
            <p>Ghế <b>#{seerResultModal.seat}</b> ({seerResultModal.name}) thuộc phe:</p>
            <h2 style={{ color: seerResultModal.isWolf ? 'red' : 'green' }}>
              {seerResultModal.isWolf ? '🐺 PHE SÓI' : '🧑 PHE DÂN LÀNG'}
            </h2>
            <button style={styles.btnPrimary} onClick={() => setSeerResultModal(null)}>Đã Đọc</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline CSS Stylesheet
const styles = {
  loginContainer: { width: '350px', margin: '100px auto', padding: '20px', background: '#1e1e2e', color: '#fff', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '15px' },
  appContainer: { background: '#0f172a', minHeight: '100vh', color: '#f8fafc', padding: '15px', fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '15px', borderRadius: '8px' },
  notificationBar: { background: '#3b82f6', padding: '10px', marginTop: '10px', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold' },
  hostPanel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#334155', padding: '10px 15px', marginTop: '10px', borderRadius: '6px' },
  roleBar: { background: '#581c87', padding: '12px', marginTop: '10px', borderRadius: '6px', textAlign: 'center' },
  seatsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginTop: '15px' },
  seatCard: { background: '#1e293b', borderRadius: '8px', padding: '10px', minHeight: '130px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  seatHeader: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' },
  hostBadge: { background: '#eab308', color: '#000', padding: '2px 5px', borderRadius: '4px', fontSize: '10px' },
  seatBody: { display: 'flex', flexDirection: 'column', gap: '5px' },
  camBox: { height: '50px', background: '#090d16', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' },
  playerInfo: { fontSize: '12px' },
  emptySeat: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' },
  nightActions: { display: 'flex', gap: '4px', marginTop: '5px' },
  specialPanel: { background: '#831843', padding: '10px', marginTop: '10px', borderRadius: '6px', display: 'flex', gap: '10px', alignItems: 'center' },
  chatSection: { display: 'flex', gap: '15px', marginTop: '15px' },
  chatBox: { flex: 1, background: '#1e293b', padding: '10px', borderRadius: '8px' },
  chatLogs: { height: '100px', overflowY: 'auto', background: '#0f172a', padding: '8px', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalBody: { background: '#1e293b', padding: '20px', borderRadius: '8px', minWidth: '320px', color: '#fff' },
  formRow: { display: 'flex', justifyContent: 'space-between', margin: '8px 0', alignItems: 'center' },
  input: { padding: '8px', borderRadius: '4px', border: 'none' },
  inputSmall: { flex: 1, padding: '6px', borderRadius: '4px', border: 'none' },
  actionGroup: { display: 'flex', gap: '8px' },
  btnPrimary: { background: '#6366f1', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnPrimarySmall: { background: '#6366f1', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' },
  btnSecondary: { background: '#64748b', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnSuccess: { background: '#22c55e', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnDanger: { background: '#ef4444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnDangerSmall: { background: '#ef4444', color: '#fff', border: 'none', padding: '4px 6px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' },
  btnWarning: { background: '#f59e0b', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnWarningSmall: { background: '#f59e0b', color: '#fff', border: 'none', padding: '4px 6px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' },
  btnInfo: { background: '#06b6d4', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' },
  btnInfoSmall: { background: '#06b6d4', color: '#fff', border: 'none', padding: '4px 6px', borderRadius: '3px', fontSize: '10px', cursor: 'pointer' },
  btnVote: { background: '#8b5cf6', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', marginTop: '4px', cursor: 'pointer' }
};