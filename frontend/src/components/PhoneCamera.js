// PhoneCamera.js - Fixed WebRTC Version
import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import WebRTCManager from './services/WebRTCManager';

function PhoneCamera({ serverIP = '192.168.0.118', serverPort = '8080' }) {
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const webrtcRef = useRef(null);
  const streamRef = useRef(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [error, setError] = useState('');
  const [webrtcState, setWebrtcState] = useState('disconnected');
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [streamRequested, setStreamRequested] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);

  const getServerUrl = () => {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.hostname !== 'localhost' && currentUrl.hostname !== '127.0.0.1' && !currentUrl.hostname.startsWith('192.168.')) {
      return `${currentUrl.protocol}//${currentUrl.hostname}:${currentUrl.port || (currentUrl.protocol === 'https:' ? 443 : 80)}`;
    }
    return `http://${serverIP}:${serverPort}`;
  };

  useEffect(() => {
    connectToServer();
    return () => cleanup();
  }, []);

  const connectToServer = () => {
    const serverUrl = getServerUrl();
    console.log('📱 Phone connecting to:', serverUrl);
    
    socketRef.current = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current.on('connect', () => {
      console.log('📱 Phone connected to server');
      setIsConnected(true);
      setError('');
      setConnectionId(socketRef.current.id);
      
      // Initialize WebRTC manager
      webrtcRef.current = new WebRTCManager(socketRef.current);
      webrtcRef.current.onConnectionStateChange = (state) => {
        setWebrtcState(state);
        console.log('📹 WebRTC state:', state);
        
        if (state === 'connected') {
          console.log('✅ WebRTC connection established - streaming to desktop!');
        } else if (state === 'failed') {
          setError('WebRTC connection failed. Trying to reconnect...');
          // Auto-retry after failure
          setTimeout(() => {
            if (streamRef.current && webrtcRef.current) {
              webrtcRef.current.startCall(streamRef.current);
            }
          }, 3000);
        }
      };

      webrtcRef.current.onError = (error) => {
        console.error('❌ WebRTC error:', error);
        setError(`WebRTC error: ${error.message}`);
      };
      
      // Register as phone
      socketRef.current.emit('register-phone', {
        deviceInfo: {
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          webrtcSupported: !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)
        }
      });
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('📱 Disconnected from server:', reason);
      setIsConnected(false);
      setDesktopConnected(false);
      setStreamRequested(false);
      setWebrtcState('disconnected');
      setError('Disconnected from server');
    });

    socketRef.current.on('phone-registered', (data) => {
      console.log('📱 Phone registered successfully:', data);
      setError('');
    });

    // Desktop is available and ready to receive stream
    socketRef.current.on('desktop-ready', (data) => {
      console.log('🖥️ Desktop ready to receive stream:', data);
      setDesktopConnected(true);
    });

    // Desktop explicitly requests stream
    socketRef.current.on('stream-requested', (data) => {
      console.log('📱 Desktop requesting stream:', data);
      setStreamRequested(true);
      setDesktopConnected(true);
      
      // Automatically start WebRTC if camera is already running
      if (streamRef.current && webrtcRef.current && !cameraStarting) {
        console.log('📞 Auto-starting WebRTC call...');
        setTimeout(() => {
          webrtcRef.current.startCall(streamRef.current);
        }, 1000); // Give a moment for setup
      }
    });

    socketRef.current.on('connect_error', (err) => {
      console.error('❌ Connection failed:', err);
      setError(`Connection failed: ${err.message}`);
    });

    socketRef.current.on('reconnect', () => {
      console.log('🔄 Reconnected to server');
      setError('');
    });
  };

  const startCamera = async () => {
    if (cameraStarting) {
      console.log('⏳ Camera already starting...');
      return;
    }

    try {
      setCameraStarting(true);
      setError('');
      console.log('🎥 Starting camera...');
      
      // Check for secure context (HTTPS or localhost)
      if (!window.isSecureContext) {
        throw new Error('Camera requires HTTPS or localhost for security');
      }

      // Check WebRTC support
      if (!window.RTCPeerConnection) {
        throw new Error('WebRTC not supported in this browser');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not supported in this browser');
      }

      // Progressive camera constraints - start high, fallback to lower quality
      const constraints = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 30, min: 15 }
          },
          audio: false
        },
        {
          video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, min: 15 }
          },
          audio: false
        },
        {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15 }
          },
          audio: false
        },
        {
          video: {
            width: { min: 320 },
            height: { min: 240 }
          },
          audio: false
        },
        { video: true, audio: false }
      ];

      let stream = null;
      let lastError = null;

      for (let i = 0; i < constraints.length; i++) {
        try {
          console.log(`🎥 Trying camera constraint ${i + 1}/${constraints.length}:`, constraints[i]);
          stream = await navigator.mediaDevices.getUserMedia(constraints[i]);
          console.log('✅ Camera constraint succeeded');
          break;
        } catch (err) {
          console.log(`❌ Camera constraint ${i + 1} failed:`, err.name);
          lastError = err;
        }
      }

      if (!stream) {
        throw lastError || new Error('All camera configurations failed');
      }
      
      // Verify stream has video tracks
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        throw new Error('No video tracks in camera stream');
      }

      console.log('📹 Camera stream obtained:', {
        videoTracks: videoTracks.length,
        settings: videoTracks[0].getSettings()
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        videoRef.current.onloadedmetadata = () => {
          console.log('📹 Video metadata loaded:', 
            `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
          
          videoRef.current.play()
            .then(() => {
              setIsStreaming(true);
              setCameraStarting(false);
              console.log('🎥 Camera started successfully');
              
              // Automatically start WebRTC if desktop requested stream
              if (streamRequested && webrtcRef.current) {
                console.log('📞 Auto-starting WebRTC call...');
                setTimeout(() => {
                  webrtcRef.current.startCall(stream);
                }, 1500); // Give video time to stabilize
              }
            })
            .catch(err => {
              console.error('❌ Video play failed:', err);
              setError('Failed to start video playback');
              setCameraStarting(false);
            });
        };

        videoRef.current.onerror = (err) => {
          console.error('❌ Video element error:', err);
          setError('Video element error');
          setCameraStarting(false);
        };
      }
    } catch (err) {
      console.error('❌ Camera access failed:', err);
      setCameraStarting(false);
      
      let errorMessage = 'Camera access failed. ';
      
      if (err.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera permissions and reload the page.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else if (err.name === 'NotSupportedError') {
        errorMessage += 'Camera not supported in this browser.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage += 'Camera constraints not supported. Try a different device orientation.';
      } else {
        errorMessage += err.message || 'Please check camera permissions.';
      }
      
      setError(errorMessage);
    }
  };

  const startWebRTCStream = async () => {
    if (!webrtcRef.current || !streamRef.current) {
      setError('Camera must be started first');
      return;
    }

    if (!isConnected) {
      setError('Not connected to server');
      return;
    }

    if (webrtcState === 'connecting' || webrtcState === 'connected') {
      console.log('⏳ WebRTC already connecting/connected');
      return;
    }

    try {
      console.log('📞 Starting WebRTC stream manually...');
      setError('');
      await webrtcRef.current.startCall(streamRef.current);
    } catch (error) {
      console.error('❌ Failed to start WebRTC stream:', error);
      setError(`Failed to start video stream: ${error.message}`);
    }
  };

  const stopCamera = () => {
    console.log('🛑 Stopping camera...');
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('🛑 Stopped track:', track.kind);
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
    }
    
    setIsStreaming(false);
    setStreamRequested(false);
    setWebrtcState('disconnected');
    setCameraStarting(false);
    console.log('🛑 Camera stopped');
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  const toggleCamera = () => {
    if (isStreaming || cameraStarting) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const getStatusColor = () => {
    if (!isConnected) return '#dc3545';
    if (webrtcState === 'connected') return '#28a745';
    if (webrtcState === 'connecting') return '#ffc107';
    if (isStreaming) return '#17a2b8';
    return '#6c757d';
  };

  const getStatusText = () => {
    if (!isConnected) return '❌ Disconnected from server';
    if (webrtcState === 'connected') return '✅ Streaming to desktop via WebRTC';
    if (webrtcState === 'connecting') return '⏳ Connecting to desktop...';
    if (cameraStarting) return '⏳ Starting camera...';
    if (streamRequested && isStreaming) return '📹 Camera ready - connecting to desktop...';
    if (streamRequested) return '📞 Desktop ready - start camera to stream';
    if (isStreaming) return '📹 Camera active - waiting for desktop';
    return '⏳ Waiting for desktop connection';
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      padding: '20px',
      backgroundColor: '#000',
      color: '#fff',
      minHeight: '100vh',
      textAlign: 'center'
    }}>
      <h1>📱 Phone Camera - WebRTC Stream</h1>

      {/* Connection Status */}
      <div style={{
        padding: '15px',
        marginBottom: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        border: `2px solid ${getStatusColor()}`
      }}>
        <h3>🔗 Connection Status</h3>
        <p style={{ color: getStatusColor(), fontWeight: 'bold', fontSize: '16px' }}>
          {getStatusText()}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '10px', flexWrap: 'wrap' }}>
          <div>Socket: {isConnected ? '✅' : '❌'}</div>
          <div>WebRTC: {webrtcState}</div>
          <div>Camera: {cameraStarting ? '⏳' : isStreaming ? '🎥' : '📷'}</div>
          {connectionId && <div>ID: {connectionId.substring(0, 8)}...</div>}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          color: '#ff6b6b', 
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: 'rgba(255, 107, 107, 0.1)',
          border: '1px solid #ff6b6b',
          borderRadius: '8px'
        }}>
          <strong>⚠️ Error:</strong> {error}
        </div>
      )}

      {/* Camera Controls */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={toggleCamera}
          disabled={!isConnected || cameraStarting}
          style={{
            padding: '15px 30px',
            fontSize: '18px',
            backgroundColor: isStreaming 
              ? '#dc3545' 
              : cameraStarting 
                ? '#6c757d'
                : isConnected ? '#007bff' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '25px',
            cursor: (isConnected && !cameraStarting) ? 'pointer' : 'not-allowed',
            minWidth: '200px',
            fontWeight: 'bold'
          }}
        >
          {cameraStarting 
            ? '⏳ Starting...' 
            : isStreaming 
              ? '🛑 Stop Camera' 
              : '🎥 Start Camera'}
        </button>

        {isStreaming && webrtcState !== 'connected' && webrtcState !== 'connecting' && streamRequested && (
          <button
            onClick={startWebRTCStream}
            style={{
              padding: '15px 30px',
              fontSize: '18px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '25px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            📞 Connect to Desktop
          </button>
        )}
      </div>

      {/* Camera Preview */}
      <div style={{ 
        position: 'relative', 
        display: 'inline-block',
        borderRadius: '15px',
        overflow: 'hidden',
        border: '3px solid #333',
        maxWidth: '100%'
      }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            maxWidth: '400px',
            height: 'auto',
            backgroundColor: '#000'
          }}
        />

        {/* WebRTC Status Overlay */}
        {isStreaming && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            padding: '8px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: 'bold'
          }}>
            📹 {webrtcState === 'connected' 
              ? 'STREAMING' 
              : webrtcState === 'connecting' 
                ? 'CONNECTING' 
                : webrtcState.toUpperCase()}
          </div>
        )}

        {/* Connection indicator */}
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          width: '24px',
          height: '24px',
          backgroundColor: getStatusColor(),
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          {webrtcState === 'connected' ? '●' : '○'}
        </div>

        {(!isStreaming && !cameraStarting) && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '24px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '20px',
            borderRadius: '10px'
          }}>
            📷 Camera Inactive
          </div>
        )}

        {cameraStarting && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '18px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: '20px',
            borderRadius: '10px',
            textAlign: 'center'
          }}>
            <div style={{ marginBottom: '10px' }}>⏳</div>
            <div>Starting Camera...</div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{
        marginTop: '30px',
        padding: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '12px',
        textAlign: 'left',
        maxWidth: '500px',
        margin: '30px auto 0'
      }}>
        <h3>📋 Instructions:</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
          <li>Make sure desktop app is open and running</li>
          <li>Allow camera permissions when prompted</li>
          <li>Click "Start Camera" to begin</li>
          <li>WebRTC will automatically connect to desktop</li>
          <li>Video streams directly via WebRTC (no server relay)</li>
        </ol>

        <div style={{ 
          marginTop: '15px', 
          padding: '10px', 
          backgroundColor: 'rgba(0, 123, 255, 0.1)', 
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          <strong>💡 Tips:</strong><br/>
          • Use rear camera for better object detection<br/>
          • Ensure good lighting conditions<br/>
          • Keep phone steady while streaming<br/>
          • If connection fails, try restarting the camera
        </div>

        {/* Debug Info */}
        {isStreaming && streamRef.current && (
          <div style={{ 
            marginTop: '15px', 
            padding: '10px', 
            backgroundColor: 'rgba(108, 117, 125, 0.1)', 
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            <strong>🔧 Debug Info:</strong><br/>
            Video Tracks: {streamRef.current.getVideoTracks().length}<br/>
            {streamRef.current.getVideoTracks().length > 0 && (
              <>
                Track State: {streamRef.current.getVideoTracks()[0].readyState}<br/>
                Track Settings: {JSON.stringify(streamRef.current.getVideoTracks()[0].getSettings(), null, 2)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PhoneCamera;