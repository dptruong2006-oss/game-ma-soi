import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const socket = io('https://game-ma-soi.onrender.com');
const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475";
const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

const AgoraVideoPlayer = ({ videoTrack, audioTrack, isLocal }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !videoTrack) return;
    try {
      videoTrack.play(containerRef.current);
      if (!isLocal && audioTrack) audioTrack.play();
    } catch (e) {}
    return () => {
      try {
        if (videoTrack && videoTrack.isPlaying) videoTrack.stop();
      } catch (e) {}
    };
  }, [videoTrack, audioTrack, isLocal]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', objectFit: 'cover' }}>
      {!isLocal && (
        <button onClick={() => { if (audioTrack) audioTrack.play(); }} style={{ position: 'absolute', bottom: '5px', right: '5px', zIndex: 5, fontSize: '9px', padding: '2px 6px', background: '#eab308', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#000' }}>
          ▶ Bật tiếng
        </button>
      )}
    </div>
  );
};

export default function App() {
  const [hasJoined, setHasJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [wolfInputMsg, setWolfInputMsg] = useState('');
  const [ghostInputMsg, setGhostInputMsg] = useState('');
  
  // State hiệu ứng chém anime & rung màn hình
  const [isSlashing, setIsSlashing] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'phong-mac-dinh-123';
  });

  const [roomState, setRoomState] = useState({
    phase: 'LOBBY',
    players: {},
    wolfMessages: [],
    ghostMessages: [],
    votes: {},
    settings: { wolfCount: 2, guardCount: 1, seerCount: 1, witchCount: 1, infectedCount: 0, villagerCount: 2 }
  });

  const [localTracks, setLocalTracks] = useState({ audioTrack: null, videoTrack: null });
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  // Âm thanh hiệu ứng chuyển Đêm / Ngày 
  const playSoundEffect = (phase) => {
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
  };

  useEffect(() => {
    const url = new URL(window.location);
    if (roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
    }
  }, [roomId]);

  useEffect(() => {
    socket.on('room_state_update', (state) => {
      if (state && state.phase && state.phase !== roomState.phase) {
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
    });

    socket.on('seer_result', (data) => {
      alert(`🔮 KẾT QUẢ TIÊN TRI (Soi ghế #${data.seat} - ${data.name}): ${data.isWolf ? '🐺 Đây là SÓI!' : '🛡️ Người vô tội (Không phải Sói)!'}`);
    });

    socket.on('notification', (data) => {
      alert(data.message);
    });

    return () => {
      socket.off('room_state_update');
      socket.off('seer_result');
      socket.off('notification');
    };
  }, [roomState.phase]);

  const playerList = Object.values(roomState.players || {});
  const existingHost = playerList.find(p => p.isHost === true);
  const takenSeats = playerList.map(p => p.seat);
  const myPlayerInfo = roomState.players[socket.id];
  const isNight = roomState.phase === 'NIGHT';
  const isDay = roomState.phase === 'DAY';
  const isDead = myPlayerInfo && myPlayerInfo.isAlive === false;

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
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Đã sao chép link mời phòng: " + roomId);
  };

  // CHẶN HOÀN TOÀN MIC & CAM KHI SANG ĐÊM (Trừ Sói và Host)
  useEffect(() => {
    if (!myPlayerInfo) return;

    const allowedToSpeak = myPlayerInfo.canSpeak !== false;
    const allowedToCam = myPlayerInfo.canCam !== false;

    // Xử lý Audio (Mic)
    if (localTracks.audioTrack) {
      if (!allowedToSpeak) {
        localTracks.audioTrack.setEnabled(false);
        setIsMicOn(false);
        agoraClient.unpublish([localTracks.audioTrack]).catch(() => {});
      } else if (isMicOn) {
        localTracks.audioTrack.setEnabled(true);
        agoraClient.publish([localTracks.audioTrack]).catch(() => {});
      }
    }

    // Xử lý Video (Cam)
    if (localTracks.videoTrack) {
      if (!allowedToCam) {
        localTracks.videoTrack.setEnabled(false);
        setIsVideoOn(false);
        agoraClient.unpublish([localTracks.videoTrack]).catch(() => {});
      } else if (isVideoOn) {
        localTracks.videoTrack.setEnabled(true);
        agoraClient.publish([localTracks.videoTrack]).catch(() => {});
      }
    }
  }, [myPlayerInfo?.canSpeak, myPlayerInfo?.canCam, isNight]);

  useEffect(() => {
    if (!hasJoined) return;
    let isMounted = true;
    const initAgora = async () => {
      try {
        agoraClient.on('user-published', async (user, mediaType) => {
          await agoraClient.subscribe(user, mediaType);
          if (isMounted) {
            setRemoteUsers(prev => {
              const exists = prev.find(u => u.uid === user.uid);
              return exists ? prev.map(u => u.uid === user.uid ? user : u) : [...prev, user];
            });
          }
        });
        agoraClient.on('user-left', (user) => {
          if (isMounted) setRemoteUsers(prev => prev.filter(u => u.uid !== user.uid));
        });

        const res = await fetch(`https://game-ma-soi.onrender.com/api/agora-token?channelName=${roomId}`);
        const data = await res.json();
        await agoraClient.join(AGORA_APP_ID, roomId, data.token, socket.id);

        let audioTrack = null, videoTrack = null;
        try { audioTrack = await AgoraRTC.createMicrophoneAudioTrack(); } catch (e) { setIsMicOn(false); }
        try { videoTrack = await AgoraRTC.createCameraVideoTrack(); } catch (e) { setIsVideoOn(false); }

        if (isMounted) {
          setLocalTracks({ audioTrack, videoTrack });
          const tracks = [];
          if (audioTrack) tracks.push(audioTrack);
          if (videoTrack) tracks.push(videoTrack);
          if (tracks.length > 0) await agoraClient.publish(tracks);
        }
      } catch (err) {}
    };
    initAgora();
    return () => { isMounted = false; agoraClient.removeAllListeners(); };
  }, [hasJoined, roomId]);

  if (!hasJoined) {
    return (
      <div style={{ backgroundColor: '#020617', color: '#fff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ color: '#c084fc', marginBottom: '8px' }}>SƠ ĐỒ CHỌN GHẾ MA SÓI</h1>
        <form onSubmit={handleJoinGame} style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '24px', borderRadius: '16px', width: '100%', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#94a3b8', fontSize: '14px' }}>Tên Của Bạn:</label>
              <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff', boxSizing: 'border-box' }} required />
            </div>
            <div style={{ width: '140px' }}>
              <label style={{ color: '#94a3b8', fontSize: '14px' }}>Mã Phòng:</label>
              <input type="text" value={roomId} onChange={e => setRoomId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff', boxSizing: 'border-box' }} required />
            </div>
          </div>
          <button type="button" onClick={copyInviteLink} style={{ padding: '10px', borderRadius: '8px', background: '#1e3a8a', color: '#93c5fd', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>📋 Sao chép Link Mời</button>
          <div style={{ background: '#1e293b', padding: '12px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Đăng ký Quản Trò:</span>
            <button type="button" disabled={!!existingHost} onClick={() => setIsHost(!isHost)} style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', background: isHost ? '#d97706' : (existingHost ? '#334155' : '#2563eb'), color: '#fff', fontWeight: 'bold', cursor: existingHost ? 'not-allowed' : 'pointer' }}>
              {isHost ? '👑 Quản Trò' : (existingHost ? '🔒 Đã có Host' : '🎯 Nhận Host')}
            </button>
          </div>
          <div>
            <label style={{ color: '#94a3b8', fontSize: '14px', display: 'block', marginBottom: '10px' }}>Chọn Ghế (1 - 20):</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {[...Array(20)].map((_, i) => {
                const sNum = i + 1;
                const taken = takenSeats.includes(sNum);
                const sel = selectedSeat === sNum;
                return (
                  <button key={sNum} type="button" disabled={taken} onClick={() => setSelectedSeat(sNum)} style={{ padding: '10px', borderRadius: '8px', border: sel ? '2px solid #a855f7' : '1px solid #334155', background: taken ? '#1e293b' : (sel ? '#9333ea' : '#0f172a'), color: taken ? '#64748b' : '#fff', fontWeight: 'bold', cursor: taken ? 'not-allowed' : 'pointer' }}>
                    {taken ? `Ghế ${sNum} (X)` : `Ghế ${sNum}`}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="submit" style={{ padding: '12px', background: '#10b981', color: '#fff', fontWeight: 'bold', fontSize: '16px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>VÀO BÀN (GHẾ SỐ {selectedSeat || '...'})</button>
        </form>
      </div>
    );
  }

  const settings = roomState.settings || {};

  return (
    <div className={isShaking ? 'card-shake' : ''} style={{ backgroundColor: isNight ? '#090d16' : '#0f172a', color: '#fff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', transition: 'background-color 0.8s ease', position: 'relative', overflow: 'hidden' }}>
      
      {/* Hiệu ứng đường chém anime khi chuyển đêm */}
      {isSlashing && <div className="slash-effect" />}

      {/* HIỆU ỨNG BAN ĐÊM: Sấm sét, sương mù máu, bầy hồn ma rùng rợn & âm thanh tiếng cười ma quái */}
      {isNight && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
          <div className="night-blood-overlay" />
          <div className="lightning-effect" />

          <div className="creepy-ghost" style={{ top: '10%', left: '5%', animationDuration: '4.5s', animationDelay: '0s' }}>
            <div style={{ fontSize: '3.5rem' }}>👻</div>
          </div>
          <div className="creepy-ghost" style={{ top: '65%', left: '12%', animationDuration: '6s', animationDelay: '1.5s' }}>
            <div style={{ fontSize: '4.5rem' }}>💀</div>
          </div>
          <div className="creepy-ghost" style={{ top: '25%', right: '8%', animationDuration: '5.2s', animationDelay: '0.8s' }}>
            <div style={{ fontSize: '5rem' }}>👻</div>
          </div>
          <div className="creepy-ghost" style={{ top: '70%', right: '18%', animationDuration: '4s', animationDelay: '2s' }}>
            <div style={{ fontSize: '3rem' }}>👁️‍🗨️</div>
          </div>
          <div className="creepy-ghost" style={{ top: '40%', left: '45%', animationDuration: '7s', animationDelay: '3.2s' }}>
            <div style={{ fontSize: '4rem' }}>👻</div>
          </div>
          <div className="creepy-ghost" style={{ top: '15%', right: '40%', animationDuration: '5.8s', animationDelay: '1.1s' }}>
            <div style={{ fontSize: '3.8rem' }}>💀</div>
          </div>

          {/* Âm thanh tiếng cười ma quái & gió hú (Chuyển Đêm) */}
          <audio 
            autoPlay 
            loop 
            src="https://actions.google.com/sounds/v1/horror/evil_laugh.ogg" 
            onPlay={(e) => { e.currentTarget.volume = 0.5; }} 
          />
          <audio 
            autoPlay 
            loop 
            src="https://actions.google.com/sounds/v1/ambiences/creepy_wind.ogg" 
            onPlay={(e) => { e.currentTarget.volume = 0.3; }} 
          />
        </div>
      )}

      {/* Nội dung chính của Trò chơi */}
      <div style={{ position: 'relative', zIndex: 20 }}>
        {/* Thanh Header trạng thái */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: isNight ? '#020617' : '#1e293b', padding: '16px', borderRadius: '12px', border: isNight ? '1px solid #1e1b4b' : '1px solid #334155', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={handleLeaveRoom} style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#475569', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>⬅️ Thoát</button>
            <div>
              <h1 style={{ margin: 0, fontSize: '18px', color: '#c084fc' }}>PHÒNG: {roomId}</h1>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 'bold' }}>
                Thời gian: <span style={{ color: isNight ? '#a78bfa' : '#facc15' }}>{isNight ? '🌙 BAN ĐÊM (RÙNG RỢN)' : '☀️ BAN NGÀY (SÁNG SỦA)'}</span>
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={copyInviteLink} style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e3a8a', color: '#93c5fd', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>📋 Link Mời</button>
            <button 
              onClick={() => { 
                if (!isHost && isNight && myPlayerInfo?.role !== 'WOLF') {
                  return alert('Ban đêm bạn bị cấm bật mic (chỉ Sói mới được nói chuyện)!');
                }
                const nextMic = !isMicOn;
                setIsMicOn(nextMic); 
                localTracks.audioTrack?.setEnabled(nextMic); 
              }} 
              style={{ padding: '8px 12px', borderRadius: '8px', background: isMicOn ? '#059669' : '#dc2626', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {isMicOn ? '🎤 Mic Bật' : '🎙️ Mic Tắt'}
            </button>
            <button 
              onClick={() => { 
                if (!isHost && isNight) {
                  return alert('Ban đêm tất cả camera đều bị tắt tự động!');
                }
                const nextCam = !isVideoOn;
                setIsVideoOn(nextCam); 
                localTracks.videoTrack?.setEnabled(nextCam); 
              }} 
              style={{ padding: '8px 12px', borderRadius: '8px', background: isVideoOn ? '#059669' : '#dc2626', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {isVideoOn ? '📹 Cam Bật' : '📷 Cam Tắt'}
            </button>
          </div>
        </header>

        {/* Bảng điều khiển Quản Trò độc nhất */}
        {isHost && (
          <div style={{ background: '#1e293b', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #d97706', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ color: '#f59e0b', margin: 0 }}>👑 Bảng Điều Khiển Quản Trò</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => socket.emit('change_phase', { roomId, phase: 'NIGHT' })} style={{ padding: '6px 12px', background: '#312e81', color: '#a5b4fc', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🌙 Đổi sang Đêm</button>
                <button onClick={() => socket.emit('change_phase', { roomId, phase: 'DAY' })} style={{ padding: '6px 12px', background: '#b45309', color: '#fef3c7', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>☀️ Đổi sang Ngày</button>
                <button onClick={() => socket.emit('clear_votes', { roomId })} style={{ padding: '6px 12px', background: '#78716c', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🧹 Xóa Bảng Vote</button>
                <button onClick={() => socket.emit('start_game', { roomId })} style={{ padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>🚀 Bắt Đầu Ván Đấu</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', fontSize: '13px' }}>
              <span>🐺 Sói: <select value={settings.wolfCount} onChange={e => socket.emit('update_settings', { roomId, settings: { wolfCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(5)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}</select></span>
              <span>🛡️ Bảo Vệ: <select value={settings.guardCount} onChange={e => socket.emit('update_settings', { roomId, settings: { guardCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select></span>
              <span>🔮 Tiên Tri: <select value={settings.seerCount} onChange={e => socket.emit('update_settings', { roomId, settings: { seerCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select></span>
              <span>🧪 Phù Thủy: <select value={settings.witchCount} onChange={e => socket.emit('update_settings', { roomId, settings: { witchCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select></span>
              <span>🦠 Người Bệnh: <select value={settings.infectedCount || 0} onChange={e => socket.emit('update_settings', { roomId, settings: { infectedCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select></span>
              <span>🧑 Dân Làng: <select value={settings.villagerCount} onChange={e => socket.emit('update_settings', { roomId, settings: { villagerCount: parseInt(e.target.value) } })} style={{ background: '#020617', color: '#fff', border: '1px solid #475569' }}>{[...Array(8)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select></span>
            </div>
          </div>
        )}

        {/* Hiển thị vai trò cá nhân */}
        {myPlayerInfo?.role && (
          <div style={{ background: '#3b0764', border: '1px solid #a855f7', padding: '10px 20px', borderRadius: '10px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🔒 Vai trò bí mật của bạn:</span>
            <strong style={{ color: '#facc15' }}>
              {myPlayerInfo.role === 'WOLF' && '🐺 Sói Ma Sói'}
              {myPlayerInfo.role === 'GUARD' && '🛡️ Bảo Vệ'}
              {myPlayerInfo.role === 'SEER' && '🔮 Tiên Tri'}
              {myPlayerInfo.role === 'WITCH' && '🧪 Phù Thủy'}
              {myPlayerInfo.role === 'INFECTED' && '🦠 Người Bệnh (Nhiễm Dịch)'}
              {myPlayerInfo.role === 'VILLAGER' && '🧑 Dân Làng'}
            </strong>
          </div>
        )}

        {/* Giao diện Bàn Chơi & Phòng Chat (Sói / Hồn Ma) */}
        <div style={{ display: 'grid', gridTemplateColumns: (myPlayerInfo?.role === 'WOLF' && isNight) || isDead ? '1fr 320px' : '1fr', gap: '20px' }}>
          
          {/* Lưới Ghế Ngồi Video */}
          <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px' }}>
            {[...Array(20)].map((_, index) => {
              const seatNum = index + 1;
              const occupant = playerList.find(p => parseInt(p.seat) === seatNum);
              const isMe = occupant && occupant.id === socket.id;
              const remoteUser = occupant ? remoteUsers.find(u => u.uid === occupant.id) : null;

              const isShielded = occupant?.statusEffect === 'GUARDED';
              const isInfected = occupant?.role === 'INFECTED' || occupant?.statusEffect === 'INFECTED';
              
              let cardClass = '';
              if (isShielded) {
                cardClass = 'guard-shield-active';
              } else if (isInfected) {
                cardClass = 'plague-infected-card';
              } else if (isNight) {
                cardClass = 'target-selecting-glow';
              }

              if (!occupant) {
                return (
                  <div key={seatNum} style={{ borderRadius: '14px', border: '1px dashed #334155', padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '160px', opacity: 0.3 }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>Ghế #{seatNum} (Trống)</span>
                  </div>
                );
              }

              return (
                <div key={seatNum} className={cardClass} style={{ position: 'relative', borderRadius: '14px', background: '#0f172a', border: isMe ? '2px solid #a855f7' : '1px solid #334155', padding: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: occupant.isAlive === false ? 0.5 : 1 }}>
                  {occupant.statusEffect && (
                    <div style={{ position: 'absolute', top: '6px', right: '6px', background: '#dc2626', color: '#fff', fontSize: '9px', padding: '2px 5px', borderRadius: '9999px', fontWeight: 'bold', zIndex: 5 }}>
                      {occupant.statusEffect}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '6px' }}>
                    <span style={{ background: '#9333ea', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>Ghế #{seatNum}</span>
                    {occupant.isHost && <span style={{ background: '#d97706', color: '#fff', fontSize: '9px', padding: '2px 6px', borderRadius: '4px' }}>👑 Host</span>}
                  </div>
                  <div style={{ width: '100%', height: '120px', background: '#000', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {occupant.isAlive === false && (
                      <div style={{ position: 'absolute', zIndex: 4, color: '#ef4444', fontWeight: 'bold', background: 'rgba(0,0,0,0.7)', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        👻 ĐÃ CHẾT
                      </div>
                    )}
                    {isMe ? (
                      localTracks.videoTrack && isVideoOn ? <AgoraVideoPlayer videoTrack={localTracks.videoTrack} isLocal={true} /> : <span>Tắt Cam</span>
                    ) : (
                      remoteUser?.videoTrack ? <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} /> : <span>Chờ Video</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{occupant.name} {isMe ? "(Bạn)" : ""}</span>
                    
                    {isNight && occupant.isAlive && (
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {isHost && (
                          <>
                            <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={{ fontSize: '9px', padding: '2px 4px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🛡️</button>
                            <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ fontSize: '9px', padding: '2px 4px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🐺</button>
                            <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ fontSize: '9px', padding: '2px 4px', background: '#9333ea', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🔮</button>
                          </>
                        )}
                        {!isHost && isMe && myPlayerInfo?.role === 'GUARD' && (
                          <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={{ fontSize: '9px', padding: '3px 6px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🛡️ Bảo Vệ</button>
                        )}
                        {!isHost && isMe && myPlayerInfo?.role === 'WOLF' && (
                          <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ fontSize: '9px', padding: '3px 6px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🐺 Cắn</button>
                        )}
                        {!isHost && isMe && myPlayerInfo?.role === 'SEER' && (
                          <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ fontSize: '9px', padding: '3px 6px', background: '#9333ea', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🔮 Soi</button>
                        )}
                        {!isHost && isMe && myPlayerInfo?.role === 'WITCH' && (
                          <>
                            <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'WITCH_SAVE' })} style={{ fontSize: '9px', padding: '3px 6px', background: '#059669', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>🧪 Cứu</button>
                            <button onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'WITCH_POISON' })} style={{ fontSize: '9px', padding: '3px 6px', background: '#7c2d12', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>☠️ Độc</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {isDay && occupant.isAlive && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                      <span style={{ fontSize: '11px', color: '#facc15', marginBottom: '4px' }}>
                        Phiếu bầu: {Object.values(roomState.votes || {}).filter(s => s === seatNum).length} 票
                      </span>
                      {!isHost && (
                        <button 
                          onClick={() => socket.emit('cast_vote', { roomId, targetSeat: seatNum })}
                          style={{ width: '100%', padding: '4px', background: '#b45309', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          🗳️ Vote Loại
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </main>

          {/* Khung Chat Riêng Dành Cho Sói hoặc Hồn Ma */}
          {((myPlayerInfo?.role === 'WOLF' && isNight) || isDead) && (
            <aside style={{ background: '#18181b', border: '1px solid #71717a', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', height: '480px' }}>
              <h3 style={{ color: isDead ? '#a1a1aa' : '#ef4444', margin: '0 0 10px 0', fontSize: '15px' }}>
                {isDead ? '👻 Hang Hồn Ma (Trò chuyện người âm)' : '🐺 Hang Sói (Bàn chiến thuật đêm)'}
              </h3>
              <div style={{ flex: 1, background: '#09090b', borderRadius: '8px', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                {(isDead ? (roomState.ghostMessages || []) : (roomState.wolfMessages || [])).map((m, idx) => (
                  <div key={idx} style={{ fontSize: '12px' }}>
                    <span style={{ color: isDead ? '#d4d4d8' : '#f87171', fontWeight: 'bold' }}>{m.sender}: </span>
                    <span style={{ color: '#e4e4e7' }}>{m.text}</span>
                    <span style={{ color: '#71717a', fontSize: '10px', marginLeft: '6px' }}>{m.time}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input 
                  type="text" 
                  placeholder={isDead ? "Tám chuyện với các hồn ma khác..." : "Bàn kế hoạch với đồng bọn..."} 
                  value={isDead ? ghostInputMsg : wolfInputMsg} 
                  onChange={e => isDead ? setGhostInputMsg(e.target.value) : setWolfInputMsg(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (isDead) {
                        if (!ghostInputMsg.trim()) return;
                        socket.emit('send_ghost_message', { roomId, text: ghostInputMsg.trim() });
                        setGhostInputMsg('');
                      } else {
                        if (!wolfInputMsg.trim()) return;
                        socket.emit('send_wolf_message', { roomId, text: wolfInputMsg.trim() });
                        setWolfInputMsg('');
                      }
                    }
                  }}
                  style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #3f3f46', background: '#09090b', color: '#fff', fontSize: '12px' }}
                />
                <button 
                  onClick={() => {
                    if (isDead) {
                      if (!ghostInputMsg.trim()) return;
                      socket.emit('send_ghost_message', { roomId, text: ghostInputMsg.trim() });
                      setGhostInputMsg('');
                    } else {
                      if (!wolfInputMsg.trim()) return;
                      socket.emit('send_wolf_message', { roomId, text: wolfInputMsg.trim() });
                      setWolfInputMsg('');
                    }
                  }} 
                  style={{ padding: '8px 12px', background: isDead ? '#71717a' : '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Gửi
                </button>
              </div>
            </aside>
          )}

        </div>
      </div>
    </div>
  );
}