// services/WebRTCManager.js - Fixed WebRTC Implementation
class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.isInitiator = false;
    this.targetId = null;
    this.connectionState = 'disconnected';
    this.isConnecting = false;
    this.iceCandidatesQueue = [];
    
    this.pcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    // Callbacks
    this.onConnectionStateChange = null;
    this.onVideoReceived = null;
    this.onError = null;
    
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.socket.on('webrtc-offer', async (data) => {
      console.log('📡 Received WebRTC offer from:', data.from);
      try {
        await this.handleOffer(data.offer, data.from);
      } catch (error) {
        console.error('❌ Error handling offer:', error);
      }
    });

    this.socket.on('webrtc-answer', async (data) => {
      console.log('📡 Received WebRTC answer from:', data.from);
      try {
        await this.handleAnswer(data.answer);
      } catch (error) {
        console.error('❌ Error handling answer:', error);
      }
    });

    this.socket.on('webrtc-ice', async (data) => {
      console.log('🧊 Received ICE candidate from:', data.from);
      try {
        await this.handleIceCandidate(data.candidate);
      } catch (error) {
        console.error('❌ Error handling ICE candidate:', error);
      }
    });

    // Handle phone availability for desktop
    this.socket.on('phone-available', (data) => {
      console.log('📱 Phone available:', data.phoneId);
      this.targetId = data.phoneId;
    });

    // Handle stream request for phone
    this.socket.on('stream-requested', (data) => {
      console.log('📱 Stream requested by desktop:', data.desktopId);
      this.targetId = data.desktopId;
      
      // Phone should initiate the call when stream is requested
      if (this.localStream && !this.isConnecting) {
        setTimeout(() => {
          this.startCall(this.localStream);
        }, 500); // Small delay to ensure proper setup
      }
    });
  }

  setupPeerConnection() {
    if (this.peerConnection) {
      console.log('🔄 Closing existing peer connection');
      this.peerConnection.close();
    }

    console.log('🔗 Setting up new peer connection');
    this.peerConnection = new RTCPeerConnection(this.pcConfig);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.targetId) {
        console.log('🧊 Sending ICE candidate to:', this.targetId);
        this.socket.emit('webrtc-ice', {
          candidate: event.candidate,
          target: this.targetId
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('🔗 WebRTC connection state:', state);
      this.connectionState = state;
      
      if (state === 'connected') {
        this.isConnecting = false;
        console.log('✅ WebRTC connection established successfully!');
      } else if (state === 'failed' || state === 'disconnected') {
        this.isConnecting = false;
        console.log('❌ WebRTC connection failed/disconnected');
        if (state === 'failed') {
          setTimeout(() => this.reconnect(), 3000);
        }
      } else if (state === 'connecting') {
        this.isConnecting = true;
        console.log('⏳ WebRTC connecting...');
      }
      
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log('🧊 ICE connection state:', iceState);
      
      if (iceState === 'failed') {
        console.log('❌ ICE connection failed, restarting...');
        this.peerConnection.restartIce();
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log('📹 Received remote video stream');
      const [remoteStream] = event.streams;
      this.remoteStream = remoteStream;
      
      // Verify stream has video tracks
      const videoTracks = remoteStream.getVideoTracks();
      console.log('📹 Video tracks received:', videoTracks.length);
      
      if (videoTracks.length > 0) {
        console.log('📹 Video track details:', videoTracks[0].getSettings());
      }
      
      if (this.onVideoReceived) {
        this.onVideoReceived(this.remoteStream);
      }
    };

    this.peerConnection.onnegotiationneeded = async () => {
      if (this.isInitiator && this.peerConnection.signalingState === 'stable') {
        console.log('🔄 Renegotiation needed');
        try {
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          
          this.socket.emit('webrtc-offer', {
            offer: offer,
            target: this.targetId
          });
        } catch (error) {
          console.error('❌ Renegotiation failed:', error);
        }
      }
    };

    // Add error handling
    this.peerConnection.onerror = (error) => {
      console.error('❌ WebRTC peer connection error:', error);
      if (this.onError) this.onError(error);
    };
  }

  // Phone calls desktop
  async startCall(localStream) {
    try {
      if (!this.targetId) {
        throw new Error('No target ID available');
      }

      if (this.isConnecting) {
        console.log('⏳ Already connecting, skipping...');
        return;
      }

      console.log('📞 Starting WebRTC call to:', this.targetId);
      this.localStream = localStream;
      this.isInitiator = true;
      this.isConnecting = true;
      
      this.setupPeerConnection();

      // Verify local stream has video
      const videoTracks = localStream.getVideoTracks();
      console.log('📹 Local video tracks:', videoTracks.length);
      
      if (videoTracks.length === 0) {
        throw new Error('No video tracks in local stream');
      }

      // Add local stream tracks
      localStream.getTracks().forEach(track => {
        console.log('➕ Adding track:', track.kind, track.enabled, track.readyState);
        this.peerConnection.addTrack(track, localStream);
      });

      // Create offer with specific constraints
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
        iceRestart: false
      });

      console.log('📝 Created offer:', offer.type);
      await this.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('webrtc-offer', {
        offer: offer,
        target: this.targetId
      });

      console.log('📤 WebRTC offer sent to:', this.targetId);
    } catch (error) {
      console.error('❌ Error starting WebRTC call:', error);
      this.isConnecting = false;
      if (this.onError) this.onError(error);
    }
  }

  // Desktop prepares to receive call
  async prepareToReceive(targetId = null) {
    try {
      if (targetId) {
        this.targetId = targetId;
      }
      
      this.isInitiator = false;
      this.setupPeerConnection();
      console.log('📱 Ready to receive WebRTC call');
    } catch (error) {
      console.error('❌ Error preparing to receive call:', error);
      if (this.onError) this.onError(error);
    }
  }

  async handleOffer(offer, fromId) {
    try {
      console.log('📄 Processing WebRTC offer from:', fromId);
      
      if (!this.targetId) {
        this.targetId = fromId;
      }
      
      if (!this.peerConnection) {
        this.setupPeerConnection();
      }
      
      // Set remote description
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('✅ Remote description set');

      // Process queued ICE candidates
      while (this.iceCandidatesQueue.length > 0) {
        const candidate = this.iceCandidatesQueue.shift();
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('✅ Queued ICE candidate processed');
        } catch (error) {
          console.error('❌ Error processing queued ICE candidate:', error);
        }
      }

      // Create answer
      const answer = await this.peerConnection.createAnswer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });
      
      console.log('📝 Created answer:', answer.type);
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit('webrtc-answer', {
        answer: answer,
        target: this.targetId
      });
      
      console.log('📤 WebRTC answer sent to:', this.targetId);
    } catch (error) {
      console.error('❌ Error handling offer:', error);
      if (this.onError) this.onError(error);
    }
  }

  async handleAnswer(answer) {
    try {
      if (!this.peerConnection) {
        throw new Error('No peer connection available');
      }
      
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('✅ WebRTC answer processed');

      // Process queued ICE candidates
      while (this.iceCandidatesQueue.length > 0) {
        const candidate = this.iceCandidatesQueue.shift();
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('✅ Queued ICE candidate processed');
        } catch (error) {
          console.error('❌ Error processing queued ICE candidate:', error);
        }
      }
    } catch (error) {
      console.error('❌ Error handling answer:', error);
      if (this.onError) this.onError(error);
    }
  }

  async handleIceCandidate(candidate) {
    try {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('✅ ICE candidate added immediately');
      } else {
        console.log('⏳ Queuing ICE candidate (no remote description yet)');
        this.iceCandidatesQueue.push(candidate);
      }
    } catch (error) {
      console.error('❌ Error adding ICE candidate:', error);
    }
  }

  async reconnect() {
    if (this.connectionState === 'connected' || this.isConnecting) {
      return;
    }
    
    console.log('🔄 Attempting WebRTC reconnection...');
    this.disconnect();
    
    // Wait a bit before reconnecting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (this.isInitiator && this.localStream) {
      await this.startCall(this.localStream);
    } else {
      await this.prepareToReceive();
    }
  }

  disconnect() {
    console.log('🔌 Disconnecting WebRTC...');
    
    this.isConnecting = false;
    this.iceCandidatesQueue = [];
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log('🛑 Stopped local track:', track.kind);
      });
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.connectionState = 'disconnected';
    
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange('disconnected');
    }
  }

  getConnectionState() {
    return this.connectionState;
  }

  hasRemoteStream() {
    return !!this.remoteStream;
  }

  // Get detailed connection stats for debugging
  async getStats() {
    if (!this.peerConnection) {
      return null;
    }
    
    try {
      const stats = await this.peerConnection.getStats();
      const statsReport = {};
      
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          statsReport.inboundVideo = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            framesReceived: report.framesReceived,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight
          };
        }
        
        if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
          statsReport.outboundVideo = {
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent,
            framesSent: report.framesSent,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight
          };
        }
      });
      
      return statsReport;
    } catch (error) {
      console.error('❌ Error getting WebRTC stats:', error);
      return null;
    }
  }
}

export default WebRTCManager;