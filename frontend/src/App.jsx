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
      if (!isLocal && audioTrack) {
        audioTrack.play();
      }
    } catch (e) {
      console.warn("Lỗi phát stream:", e);
    }
    return () => {
      try {
        if (videoTrack && videoTrack.isPlaying) {
          videoTrack.stop();
        }
      } catch (e) {}
    };
  }, [videoTrack, audioTrack, isLocal]);

  const handleForcePlay = () => {
    try {
      if (videoTrack) videoTrack.play(containerRef.current);
      if (!isLocal && audioTrack) audioTrack.play();
      alert("Đã bật tiếng thành công!");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', objectFit: 'cover' }}>
      {!isLocal && (
        <button 
          onClick={handleForcePlay} 
          style={{ position: 'absolute', bottom: '5px', right: '5px', zIndex: 5, fontSize: '10px', padding: '3px 8px', background: '#eab308', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#000' }}
        >
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

  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'phong-mac-dinh-123';
  });

  const [roomState, setRoomState] = useState({
    phase: 'LOBBY',
    players: {},
    settings: { wolfCount: 2, guardCount: 1, seerCount: 1, witchCount: 1 }
  });

  const [localTracks, setLocalTracks] = useState({ audioTrack: null, videoTrack: null });
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  useEffect(() => {
    const url = new URL(window.location);
    if (roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
    }
  }, [roomId]);

  useEffect(() => {
    socket.on('room_state_update', (state) => {
      if (state && state.players) {
        setRoomState(state);
      }
    });

    socket.on('seer_result', (data) => {
      alert(`🔮 KẾT QUẢ TIÊN TRI (Soi ghế #${data.seat} - ${data.name}): ${data.isWolf ? '🐺 Đây là SÓI!' : '🛡️ Đây là người vô tội (Không phải Sói)!'}`);
    });

    return () => {
      socket.off('room_state_update');
      socket.off('seer_result');
    };
  }, []);

  const playerList = Object.values(roomState.players || {});
  const existingHost = playerList.find(p => p.isHost === true);
  const takenSeats = playerList.map(p => p.seat);

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (!playerName.trim()) return alert("Vui lòng nhập tên!");
    if (!selectedSeat) return alert("Vui lòng chọn 1 ghế!");

    if (isHost && existingHost) {
      return alert("Phòng này đã có Quản Trò!");
    }

    setHasJoined(true);
    socket.emit('join_room', {
      roomId,
      name: playerName.trim(),
      seat: selectedSeat,
      isHost: isHost
    });
  };

  const handleLeaveRoom = async () => {
    try {
      localTracks.audioTrack?.close();
      localTracks.videoTrack?.close();
      await agoraClient.leave();
    } catch (e) {}
    setLocalTracks({ audioTrack: null, videoTrack: null });
    setRemoteUsers([]);
    setHasJoined(false);
    setIsHost(false);
    setSelectedSeat(null);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Đã sao chép link mời phòng: " + roomId);
  };

  useEffect(() => {
    if (!hasJoined) return;
    let isMounted = true;

    const initAgora = async () => {
      try {
        agoraClient.on('user-published', async (user, mediaType) => {
          await agoraClient.subscribe(user, mediaType);
          if (isMounted) {
            setRemoteUsers((prev) => {
              const exists = prev.find((u) => u.uid === user.uid);
              if (exists) {
                return prev.map((u) => (u.uid === user.uid ? user : u));
              }
              return [...prev, user];
            });
          }
        });

        agoraClient.on('user-unpublished', (user, mediaType) => {
          if (isMounted) {
            setRemoteUsers((prev) => prev.map(u => (u.uid === user.uid ? { ...u } : u)));
          }
        });

        agoraClient.on('user-left', (user) => {
          if (isMounted) {
            setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
          }
        });

        const res = await fetch(`https://game-ma-soi.onrender.com/api/agora-token?channelName=${roomId}`);
        const data = await res.json();

        await agoraClient.join(AGORA_APP_ID, roomId, data.token, socket.id);

        let audioTrack = null;
        let videoTrack = null;

        try {
          audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        } catch (err) {
          setIsMicOn(false);
        }

        try {
          videoTrack = await AgoraRTC.createCameraVideoTrack();
        } catch (err) {
          setIsVideoOn(false);
        }

        if (isMounted) {
          setLocalTracks({ audioTrack, videoTrack });
          const tracksToPublish = [];
          if (audioTrack) tracksToPublish.push(audioTrack);
          if (videoTrack) tracksToPublish.push(videoTrack);
          
          if (tracksToPublish.length > 0) {
            await agoraClient.publish(tracksToPublish);
          }
        }
      } catch (err) {
        console.error("Lỗi kết nối Agora:", err);
      }
    };

    initAgora();

    return () => {
      isMounted = false;
      agoraClient.removeAllListeners();
    };
  }, [hasJoined, roomId]);

  const toggleMic = async () => {
    if (localTracks.audioTrack) {
      try {
        const newState = !isMicOn;
        await localTracks.audioTrack.setEnabled(newState);
        setIsMicOn(newState);
      } catch (e) {}
    } else {
      try {
        const newAudio = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish(newAudio);
        setLocalTracks(prev => ({ ...prev, audioTrack: newAudio }));
        setIsMicOn(true);
      } catch (e) {}
    }
  };

  const toggleVideo = async () => {
    if (localTracks.videoTrack) {
      try {
        const newState = !isVideoOn;
        await localTracks.videoTrack.setEnabled(newState);
        setIsVideoOn(newState);
      } catch (e) {}
    } else {
      try {
        const newVideo = await AgoraRTC.createCameraVideoTrack();
        await agoraClient.publish(newVideo);
        setLocalTracks(prev => ({ ...prev, videoTrack: newVideo }));
        setIsVideoOn(true);
      } catch (e) {}
    }
  };

  if (!hasJoined) {
    return (
      <div style={{ backgroundColor: '#020617', color: '#ffffff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ color: '#c084fc', marginBottom: '8px' }}>SƠ ĐỒ CHỌN GHẾ MA SÓI</h1>
        <p style={{ color: '#94a3b8', marginBottom: '24px' }}>Nhập tên, chọn vị trí ngồi và gửi link mời bạn bè</p>

        <form onSubmit={handleJoinGame} style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '24px', borderRadius: '16px', width: '100%', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#94a3b8' }}>Tên Của Bạn:</label>
              <input type="text" placeholder="Nhập tên..." value={playerName} onChange={(e) => setPlayerName(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #334155', backgroundColor: '#020617', color: '#fff', boxSizing: 'border-box' }} required />
            </div>

            <div style={{ width: '160px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#94a3b8' }}>Mã Phòng:</label>
              <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #334155', backgroundColor: '#020617', color: '#fff', boxSizing: 'border-box' }} required />
            </div>
          </div>

          <button type="button" onClick={copyInviteLink} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', color: '#93c5fd', fontWeight: 'bold', cursor: 'pointer' }}>
            📋 Sao chép Link Mời Phòng
          </button>

          <div style={{ backgroundColor: '#1e293b', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Vai trò Quản Trò (Chỉ 1 người duy nhất):</span>
            <button 
              type="button" 
              disabled={!!existingHost} 
              onClick={() => setIsHost(!isHost)} 
              style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', backgroundColor: isHost ? '#d97706' : (existingHost ? '#334155' : '#2563eb'), color: '#fff', fontWeight: 'bold', cursor: existingHost ? 'not-allowed' : 'pointer' }}
            >
              {isHost ? '👑 Quản Trò (Đã chọn)' : (existingHost ? '🔒 Đã có Quản Trò' : '🎯 Nhận làm Quản Trò')}
            </button>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: '#94a3b8' }}>Chọn Ghế (1 - 20):</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {[...Array(20)].map((_, index) => {
                const seatNum = index + 1;
                const isTaken = takenSeats.includes(seatNum);
                const isSelected = selectedSeat === seatNum;
                return (
                  <button key={seatNum} type="button" disabled={isTaken} onClick={() => setSelectedSeat(seatNum)} style={{ padding: '12px 0', borderRadius: '8px', border: isSelected ? '2px solid #a855f7' : '1px solid #334155', backgroundColor: isTaken ? '#1e293b' : (isSelected ? '#9333ea' : '#0f172a'), color: isTaken ? '#64748b' : '#ffffff', fontWeight: 'bold', cursor: isTaken ? 'not-allowed' : 'pointer' }}>
                    {isTaken ? `Ghế ${seatNum} (Đã có)` : `Ghế ${seatNum}`}
                  </button>
                );
              })}
            </div>
          </div>

          <button type="submit" style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#10b981', color: '#fff', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}>
            VÀO BÀN CHƠI (GHẾ SỐ {selectedSeat || '...'})
          </button>
        </form>
      </div>
    );
  }

  const myPlayerInfo = roomState.players[socket.id];
  const settings = roomState.settings || { wolfCount: 2, guardCount: 1, seerCount: 1, witchCount: 1 };

  return (
    <div style={{ backgroundColor: '#020617', color: '#ffffff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', backgroundColor: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={handleLeaveRoom} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#f8fafc', cursor: 'pointer' }}>⬅️ Thoát</button>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#c084fc' }}>PHÒNG: {roomId}</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Trạng thái: <span style={{ color: '#facc15', fontWeight: 'bold' }}>{roomState.phase}</span></p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: 'none', backgroundColor: '#eab308', color: '#000', cursor: 'pointer' }}>🔊 Tải lại Cam/Mic</button>
          <button onClick={copyInviteLink} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', color: '#93c5fd', cursor: 'pointer' }}>📋 Copy Link</button>
          <button onClick={toggleMic} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isMicOn ? '#059669' : '#dc2626', color: '#fff' }}>{isMicOn ? '🎤 Mic: Bật' : '🎙️ Mic: Tắt'}</button>
          <button onClick={toggleVideo} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isVideoOn ? '#059669' : '#dc2626', color: '#fff' }}>{isVideoOn ? '📹 Cam: Bật' : '📷 Cam: Tắt'}</button>
        </div>
      </header>

      {/* Bảng điều khiển dành riêng cho Quản Trò (Host) độc nhất */}
      {isHost && (
        <div style={{ backgroundColor: '#1e293b', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #d97706', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <h3 style={{ color: '#f59e0b', margin: 0 }}>👑 Bảng Điều Khiển Quản Trò (Tùy chỉnh số lượng chức năng)</h3>
          
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>🐺 Sói:</span>
              <select 
                value={settings.wolfCount}
                onChange={(e) => socket.emit('update_settings', { roomId, settings: { wolfCount: parseInt(e.target.value) } })}
                style={{ padding: '4px 8px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569' }}
              >
                {[...Array(6)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>🛡️ Bảo Vệ:</span>
              <select 
                value={settings.guardCount}
                onChange={(e) => socket.emit('update_settings', { roomId, settings: { guardCount: parseInt(e.target.value) } })}
                style={{ padding: '4px 8px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569' }}
              >
                {[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>🔮 Tiên Tri:</span>
              <select 
                value={settings.seerCount}
                onChange={(e) => socket.emit('update_settings', { roomId, settings: { seerCount: parseInt(e.target.value) } })}
                style={{ padding: '4px 8px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569' }}
              >
                {[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>🧪 Phù Thủy:</span>
              <select 
                value={settings.witchCount}
                onChange={(e) => socket.emit('update_settings', { roomId, settings: { witchCount: parseInt(e.target.value) } })}
                style={{ padding: '4px 8px', borderRadius: '6px', backgroundColor: '#0f172a', color: '#fff', border: '1px solid #475569' }}
              >
                {[...Array(3)].map((_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <button 
              onClick={() => socket.emit('start_game', { roomId })}
              style={{ marginLeft: 'auto', padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
            >
              🚀 Bắt Đầu Ván Đấu & Random Vai Trò
            </button>
          </div>
        </div>
      )}

      {/* Hiển thị vai trò riêng tư của chính người chơi đó */}
      {myPlayerInfo?.role && (
        <div style={{ backgroundColor: '#3b0764', border: '1px solid #a855f7', padding: '12px 20px', borderRadius: '12px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold' }}>🔒 Vai trò bí mật của bạn:</span>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#facc15' }}>
            {myPlayerInfo.role === 'WOLF' && '🐺 Sói Ma Sói'}
            {myPlayerInfo.role === 'GUARD' && '🛡️ Bảo Vệ'}
            {myPlayerInfo.role === 'SEER' && '🔮 Tiên Tri'}
            {myPlayerInfo.role === 'WITCH' && '🧪 Phù Thủy'}
            {myPlayerInfo.role === 'VILLAGER' && '🧑 Dân Làng'}
          </span>
        </div>
      )}

      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
        {[...Array(20)].map((_, index) => {
          const seatNum = index + 1;
          const occupant = playerList.find(p => parseInt(p.seat) === seatNum);
          const isMe = occupant && occupant.id === socket.id;
          const remoteUser = occupant ? remoteUsers.find((u) => u.uid === occupant.id) : null;

          if (!occupant) {
            return (
              <div key={seatNum} style={{ borderRadius: '16px', border: '1px dashed #334155', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '180px', opacity: 0.4 }}>
                <span style={{ backgroundColor: '#1e293b', color: '#94a3b8', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold', marginBottom: '8px' }}>Ghế #{seatNum}</span>
                <span style={{ color: '#475569', fontSize: '13px' }}>Trống</span>
              </div>
            );
          }

          return (
            <div key={seatNum} style={{ position: 'relative', borderRadius: '16px', backgroundColor: '#0f172a', border: isMe ? '2px solid #a855f7' : '2px solid #334155', padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              
              {occupant.statusEffect && isHost && (
                <div style={{ position: 'absolute', top: '8px', right: '8px', backgroundColor: '#dc2626', color: '#ffffff', fontSize: '10px', padding: '2px 6px', borderRadius: '9999px', fontWeight: 'bold', zIndex: 10 }}>
                  {occupant.statusEffect === 'WOLF_TARGET' && '🐺 Sói nhắm'}
                  {occupant.statusEffect === 'GUARDED' && '🛡️ Bảo vệ'}
                  {occupant.statusEffect === 'WITCH_SAVED' && '🧪 Phù thủy cứu'}
                  {occupant.statusEffect === 'WITCH_KILLED' && '☠️ Độc sát'}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                <span style={{ backgroundColor: '#9333ea', color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold' }}>Ghế #{seatNum}</span>
                {occupant?.isHost && <span style={{ backgroundColor: '#d97706', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '6px', fontWeight: 'bold' }}>👑 Quản Trò</span>}
              </div>

              <div style={{ position: 'relative', width: '100%', height: '140px', backgroundColor: '#000000', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #1e293b' }}>
                {isMe ? (
                  localTracks.videoTrack && isVideoOn ? (
                    <AgoraVideoPlayer videoTrack={localTracks.videoTrack} isLocal={true} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 'bold' }}>{occupant.name.charAt(0).toUpperCase()}</div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Tắt Cam</span>
                    </div>
                  )
                ) : (
                  remoteUser && remoteUser.videoTrack ? (
                    <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 'bold' }}>{occupant.name.charAt(0).toUpperCase()}</div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Chờ Video</span>
                    </div>
                  )
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginTop: '8px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#f8fafc' }}>
                  {occupant.name} {isMe ? "(Bạn)" : ""}
                </span>

                {isHost && roomState.phase === 'NIGHT' && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button title="Bảo vệ" onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'GUARD' })} style={{ fontSize: '10px', padding: '2px 5px', cursor: 'pointer', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px' }}>🛡️</button>
                    <button title="Sói cắn" onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'WOLF' })} style={{ fontSize: '10px', padding: '2px 5px', cursor: 'pointer', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px' }}>🐺</button>
                    <button title="Tiên tri soi" onClick={() => socket.emit('apply_night_action', { roomId, targetSeat: seatNum, actionType: 'SEER_CHECK' })} style={{ fontSize: '10px', padding: '2px 5px', cursor: 'pointer', background: '#9333ea', color: '#fff', border: 'none', borderRadius: '4px' }}>🔮</button>
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </main>
    </div>
  );
}