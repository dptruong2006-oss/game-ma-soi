// Khởi tạo Agora Video/Audio Call an toàn, tách biệt từng thiết bị
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

        // 3. Khởi tạo Mic và Cam riêng biệt để tránh lỗi xung đột phần cứng
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