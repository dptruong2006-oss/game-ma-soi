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
    } catch (e) {
      console.warn("Lỗi phát stream:", e);
    }
    return () => {
      try {
        videoTrack?.stop();
        audioTrack?.stop();
      } catch (e) {}
    };
  }, [videoTrack, audioTrack, isLocal]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
};

export default function App() {
  const [hasJoined, setHasJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [isHost, setIsHost] = useState(false);

  // Tự động bóc tách Mã Phòng từ URL (hỗ trợ vào chung phòng qua link mời)
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'phong-mac-dinh-123';
  });

  const [roomState, setRoomState] = useState({
    phase: 'LOBBY',
    players: {}
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

    return () => {
      socket.off('room_state_update');
    };
  }, []);

  const playerList = Object.values(roomState.players || {});
  const existingHost = playerList.find(p => p.isHost === true);
  const takenSeats = playerList.map(p => p.seat);

  const handleJoinGame = (e) => {
    e.preventDefault();
    if (!playerName.trim()) return alert("Vui lòng nhập tên!");
    if (!selectedSeat) return alert("Vui lòng chọn 1 ghế!");

    if (isHost && existingHost && existingHost.id !== socket.id) {
      return alert("Phòng này đã có Quản Trò rồi!");
    }

    setHasJoined(true);
    socket.emit('join_room', {
      roomId,
      name: playerName.trim(),
      seat: selectedSeat,
      isHost: isHost
    });
  };

  const handleLeaveRoom = () => {
    localTracks.audioTrack?.close();
    localTracks.videoTrack?.close();
    agoraClient.leave();
    setHasJoined(false);
    setIsHost(false);
    setSelectedSeat(null);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Đã sao chép link mời phòng: " + roomId);
  };

  // Khởi tạo Agora Video/Audio Call an toàn, tách biệt thiết bị để tránh xung đột
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
              if (exists) return prev.map((u) => (u.uid === user.uid ? user : u));
              return [...prev, user];
            });
          }
        });

        agoraClient.on('user-unpublished', (user) => {
          if (isMounted) setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        });

        // 1. Lấy Token từ server Render
        const res = await fetch(`https://game-ma-soi.onrender.com/api/agora-token?channelName=${roomId}`);
        const data = await res.json();

        // 2. Join channel
        await agoraClient.join(AGORA_APP_ID, roomId, data.token, socket.id);

        // 3. Khởi tạo Mic và Cam riêng biệt để tránh lỗi xung đột phần cứng hoặc trình duyệt chặn đồng thời
        let audioTrack = null;
        let videoTrack = null;

        try {
          audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        } catch (err) {
          console.warn("Không thể bật Micro:", err);
          setIsMicOn(false);
        }

        try {
          videoTrack = await AgoraRTC.createCameraVideoTrack();
        } catch (err) {
          console.warn("Không thể bật Camera:", err);
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
    };
  }, [hasJoined, roomId]);

  const toggleMic = async () => {
    if (localTracks.audioTrack) {
      const newState = !isMicOn;
      await localTracks.audioTrack.setEnabled(newState);
      setIsMicOn(newState);
    }
  };

  const toggleVideo = async () => {
    if (localTracks.videoTrack) {
      const newState = !isVideoOn;
      await localTracks.videoTrack.setEnabled(newState);
      setIsVideoOn(newState);
    }
  };

  // MÀN HÌNH CHỌN GHẾ VÀ VÀO PHÒNG
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
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Vai trò Quản Trò?</span>
            <button type="button" disabled={!!existingHost && !isHost} onClick={() => setIsHost(!isHost)} style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', backgroundColor: isHost ? '#d97706' : '#334155', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
              {isHost ? '👑 Quản Trò' : (existingHost ? '🔒 Đã có Host' : '👤 Người Chơi')}
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

  // MÀN HÌNH BÀN CHƠI TRỰC TUYẾN
  return (
    <div style={{ backgroundColor: '#020617', color: '#ffffff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', backgroundColor: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={handleLeaveRoom} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#f8fafc', cursor: 'pointer' }}>⬅️ Thoát</button>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#c084fc' }}>PHÒNG: {roomId}</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Số người: <span style={{ color: '#facc15', fontWeight: 'bold' }}>{playerList.length}</span></p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button onClick={copyInviteLink} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', color: '#93c5fd', cursor: 'pointer' }}>📋 Copy Link</button>
          <button onClick={toggleMic} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isMicOn ? '#059669' : '#dc2626', color: '#fff' }}>{isMicOn ? '🎤 Mic: Bật' : '🎙️ Mic: Tắt'}</button>
          <button onClick={toggleVideo} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isVideoOn ? '#059669' : '#dc2626', color: '#fff' }}>{isVideoOn ? '📹 Cam: Bật' : '📷 Cam: Tắt'}</button>
        </div>
      </header>

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
              
              {/* Hiệu ứng trạng thái ban đêm: Chỉ Quản Trò (isHost) mới nhìn thấy hiệu ứng tác động lên người chơi */}
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
                  remoteUser ? (
                    <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 'bold' }}>{occupant.name.charAt(0).toUpperCase()}</div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Chờ Video</span>
                    </div>
                  )
                )}
              </div>

              <span style={{ marginTop: '8px', fontWeight: 'bold', fontSize: '14px', color: '#f8fafc' }}>
                {occupant.name} {isMe ? "(Bạn)" : ""}
              </span>
            </div>
          );
        })}
      </main>
    </div>
  );
}