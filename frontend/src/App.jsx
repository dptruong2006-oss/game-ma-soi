import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';

const socket = io('https://game-ma-soi.onrender.com');

// 🔴 AGORA APP ID CỦA BẠN
const AGORA_APP_ID = "f8b9cc77ff234823b6e4685127ebf475"; 

const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Component phát Video
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

  // Tự động đọc Mã Phòng từ URL (nếu có người bấm link chia sẻ)
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '123';
  });

  const [roomState, setRoomState] = useState({
    phase: 'Đang chờ tập hợp người chơi',
    players: {}
  });

  const [localTracks, setLocalTracks] = useState({ audioTrack: null, videoTrack: null });
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  // Cập nhật URL trình duyệt khi mã phòng thay đổi để tiện copy link
  useEffect(() => {
    const url = new URL(window.location);
    if (roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
    }
  }, [roomId]);

  // Lắng nghe dữ liệu phòng từ Server
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

  // Xử lý vào game
  const handleJoinGame = (e) => {
    e.preventDefault();
    if (!playerName.trim()) return alert("Vui lòng nhập tên!");
    if (!selectedSeat) return alert("Vui lòng bấm chọn 1 ghế!");

    if (isHost && existingHost && existingHost.id !== socket.id) {
      return alert("Phòng này đã có Quản Trò rồi!");
    }

    const myPlayerData = {
      id: socket.id || 'local_user',
      name: playerName.trim(),
      seat: selectedSeat,
      isHost: isHost
    };

    setRoomState(prev => ({
      ...prev,
      players: {
        ...prev.players,
        [myPlayerData.id]: myPlayerData
      }
    }));

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

  // Nút sao chép link mời bạn bè vào chung phòng
  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Đã sao chép link phòng! Gửi link này cho bạn bè để cùng vào phòng: " + roomId);
  };

  // Khởi tạo Camera/Mic
  useEffect(() => {
    if (!hasJoined) return;

    let isMounted = true;

    const initAgora = async () => {
      if (!AGORA_APP_ID) return;

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

        const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();

        if (isMounted) {
          setLocalTracks({ audioTrack, videoTrack });
        }

        await agoraClient.join(AGORA_APP_ID, roomId, null, socket.id || playerName);
        
        if (isMounted && audioTrack && videoTrack) {
          await agoraClient.publish([audioTrack, videoTrack]);
        }
      } catch (err) {
        console.error("Lỗi xin quyền Cam/Mic hoặc Agora Token:", err);
      }
    };

    initAgora();

    return () => {
      isMounted = false;
    };
  }, [hasJoined, roomId]);

  const toggleMic = async () => {
    if (localTracks.audioTrack) await localTracks.audioTrack.setEnabled(!isMicOn);
    setIsMicOn(!isMicOn);
  };

  const toggleVideo = async () => {
    if (localTracks.videoTrack) await localTracks.videoTrack.setEnabled(!isVideoOn);
    setIsVideoOn(!isVideoOn);
  };

  const claimHostRole = () => {
    if (existingHost) {
      return alert("Phòng này đã có người làm Quản Trò rồi!");
    }
    setIsHost(true);
    socket.emit('claim_host', { roomId, socketId: socket.id });
  };

  // --- MÀN HÌNH 1: SƠ ĐỒ GHẾ & TẠO/ĐỔI PHÒNG ---
  if (!hasJoined) {
    return (
      <div style={{ backgroundColor: '#020617', color: '#ffffff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ color: '#c084fc', marginBottom: '8px' }}>SƠ ĐỒ CHỌN GHẾ THAM GIA</h1>
        <p style={{ color: '#94a3b8', marginBottom: '24px' }}>Nhập tên, chọn ghế và bấm copy link mời bạn bè vào chung phòng</p>

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

          <button type="button" onClick={copyInviteLink} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', color: '#93c5fd', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            📋 Sao chép Link Mời Phòng Này
          </button>

          <div style={{ backgroundColor: '#1e293b', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>Bạn muốn làm Quản trò?</span>
            <button 
              type="button" 
              disabled={!!existingHost && !isHost}
              onClick={() => setIsHost(!isHost)} 
              style={{ 
                padding: '6px 16px', 
                borderRadius: '6px', 
                border: 'none', 
                backgroundColor: !!existingHost && !isHost ? '#333' : (isHost ? '#d97706' : '#334155'), 
                color: '#fff', 
                fontWeight: 'bold', 
                cursor: !!existingHost && !isHost ? 'not-allowed' : 'pointer' 
              }}
            >
              {isHost ? '👑 Đã Chọn: Quản Trò' : (existingHost ? '🔒 Đã Có Host' : '👤 Người Chơi Thường')}
            </button>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '14px', color: '#94a3b8' }}>Chọn 1 vị trí ghế (1 - 20):</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {[...Array(20)].map((_, index) => {
                const seatNum = index + 1;
                const isTaken = takenSeats.includes(seatNum);
                const isSelected = selectedSeat === seatNum;

                return (
                  <button
                    key={seatNum}
                    type="button"
                    disabled={isTaken}
                    onClick={() => setSelectedSeat(seatNum)}
                    style={{
                      padding: '12px 0',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #a855f7' : '1px solid #334155',
                      backgroundColor: isTaken ? '#1e293b' : (isSelected ? '#9333ea' : '#0f172a'),
                      color: isTaken ? '#64748b' : '#ffffff',
                      fontWeight: 'bold',
                      cursor: isTaken ? 'not-allowed' : 'pointer'
                    }}
                  >
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

  // --- MÀN HÌNH 2: BÀN CHƠI 20 GHẾ TRỰC TUYẾN ---
  return (
    <div style={{ backgroundColor: '#020617', color: '#ffffff', minHeight: '100vh', padding: '24px', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
      
      {/* HEADER TỔNG QUAN */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', backgroundColor: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={handleLeaveRoom} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#f8fafc', cursor: 'pointer' }}>
            ⬅️ Thoát Ra
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#c084fc' }}>PHÒNG: {roomId}</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Số người trong phòng: <span style={{ color: '#facc15', fontWeight: 'bold' }}>{playerList.length} người</span>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button onClick={copyInviteLink} style={{ padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', color: '#93c5fd', cursor: 'pointer' }}>
            📋 Copy Link Mời
          </button>

          <button onClick={toggleMic} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isMicOn ? '#059669' : '#dc2626', color: '#fff' }}>
            {isMicOn ? '🎤 Mic: Bật' : '🎙️ Mic: Tắt'}
          </button>

          <button onClick={toggleVideo} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer', backgroundColor: isVideoOn ? '#059669' : '#dc2626', color: '#fff' }}>
            {isVideoOn ? '📹 Cam: Bật' : '📷 Cam: Tắt'}
          </button>

          {!isHost && !existingHost ? (
            <button onClick={claimHostRole} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', border: '1px solid #d97706', backgroundColor: '#78350f', color: '#fbbf24', cursor: 'pointer' }}>
              👑 Nhận Làm Quản Trò
            </button>
          ) : (
            <div style={{ backgroundColor: '#78350f', padding: '8px 16px', borderRadius: '8px', border: '1px solid #d97706', color: '#fbbf24', fontWeight: 'bold', fontSize: '13px' }}>
              {isHost ? '👑 VAI TRÒ: QUẢN TRÒ' : '🔒 ĐÃ CÓ QUẢN TRÒ'}
            </div>
          )}
        </div>
      </header>

      {/* HIỂN THỊ CẢ 20 KHUNG GHẾ BÀN CHƠI */}
      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
        {[...Array(20)].map((_, index) => {
          const seatNum = index + 1;
          const occupant = playerList.find(p => parseInt(p.seat) === seatNum);

          const isMe = occupant && (occupant.id === socket.id || occupant.name === playerName);
          const remoteUser = occupant ? remoteUsers.find((u) => u.uid === occupant.id) : null;

          if (!occupant) {
            return (
              <div 
                key={seatNum} 
                style={{ 
                  borderRadius: '16px', 
                  border: '1px dashed #334155', 
                  padding: '16px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '180px',
                  opacity: 0.4
                }}
              >
                <span style={{ backgroundColor: '#1e293b', color: '#94a3b8', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold', marginBottom: '8px' }}>
                  Ghế #{seatNum}
                </span>
                <span style={{ color: '#475569', fontSize: '13px' }}>Trống</span>
              </div>
            );
          }

          return (
            <div 
              key={seatNum} 
              style={{ 
                position: 'relative', 
                borderRadius: '16px', 
                backgroundColor: '#0f172a', 
                border: isMe ? '2px solid #a855f7' : '2px solid #334155', 
                padding: '12px', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                <span style={{ backgroundColor: '#9333ea', color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold' }}>
                  Ghế #{seatNum}
                </span>

                {occupant?.isHost && (
                  <span style={{ backgroundColor: '#d97706', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '6px', fontWeight: 'bold' }}>
                    👑 Quản Trò
                  </span>
                )}
              </div>

              <div style={{ position: 'relative', width: '100%', height: '140px', backgroundColor: '#000000', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #1e293b' }}>
                {isMe ? (
                  localTracks.videoTrack && isVideoOn ? (
                    <AgoraVideoPlayer videoTrack={localTracks.videoTrack} isLocal={true} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 'bold' }}>
                        {playerName.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Cam đã tắt</span>
                    </div>
                  )
                ) : (
                  remoteUser?.hasVideo ? (
                    <AgoraVideoPlayer videoTrack={remoteUser.videoTrack} audioTrack={remoteUser.audioTrack} isLocal={false} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 'bold' }}>
                        {occupant.name.charAt(0).toUpperCase()}
                      </div>
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