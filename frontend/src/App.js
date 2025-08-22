// App.js - Fixed WebRTC Desktop Version
import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import QRCode from 'qrcode';
import PhoneCamera from './components/PhoneCamera';
import WebRTCManager from './components/services/WebRTCManager';
import io from 'socket.io-client';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const webrtcRef = useRef(null);
  const [model, setModel] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [detections, setDetections] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [backendInfo, setBackendInfo] = useState('');
  const [isDetectionActive, setIsDetectionActive] = useState(false);
  const [inputSource, setInputSource] = useState('none'); // Changed from 'laptop' to 'none'
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [ngrokUrl, setNgrokUrl] = useState('');
  const [phoneUrl, setPhoneUrl] = useState('');
  const [webrtcState, setWebrtcState] = useState('disconnected');
  const [phoneId, setPhoneId] = useState('');
  const [availablePhones, setAvailablePhones] = useState([]);
  
  const SERVER_IP = '192.168.0.118';
  const SERVER_PORT = '8080';
  
  const fpsRef = useRef({ frames: 0, lastTime: Date.now() });
  const detectionLoopRef = useRef(null);

  const urlParams = new URLSearchParams(window.location.search);
  const isPhoneView = urlParams.get('mode') === 'phone';

  if (isPhoneView) {
    return <PhoneCamera serverIP={SERVER_IP} serverPort={SERVER_PORT} />;
  }

  // Check for ngrok URL
  useEffect(() => {
    const checkNgrokUrl = async () => {
      try {
        const response = await fetch(`http://${SERVER_IP}:${SERVER_PORT}/api/ngrok-url`);
        if (response.ok) {
          const data = await response.json();
          if (data.ngrokUrl) {
            setNgrokUrl(data.ngrokUrl);
          }
        }
      } catch (error) {
        console.log('No ngrok URL available');
      }
    };

    checkNgrokUrl();
    const interval = setInterval(checkNgrokUrl, 10000);
    return () => clearInterval(interval);
  }, []);

  // Initialize Socket.IO and WebRTC
  useEffect(() => {
    const initSocket = () => {
      const serverUrl = `http://${SERVER_IP}:${SERVER_PORT}`;
      console.log('🖥️ Desktop connecting to server:', serverUrl);
      
      socketRef.current = io(serverUrl, {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      socketRef.current.on('connect', () => {
        console.log('🖥️ Desktop connected to server');
        setConnectionStatus('Connected');
        
        // Initialize WebRTC manager
        webrtcRef.current = new WebRTCManager(socketRef.current);
        webrtcRef.current.onConnectionStateChange = (state) => {
          setWebrtcState(state);
          console.log('📹 WebRTC state changed:', state);
          
          if (state === 'connected') {
            console.log('✅ WebRTC connection established - video should be streaming!');
          } else if (state === 'disconnected' || state === 'failed') {
            // Reset video source if WebRTC disconnects
            if (inputSource === 'phone' && videoRef.current) {
              videoRef.current.srcObject = null;
              setIsStreaming(false);
            }
          }
        };
        
        webrtcRef.current.onVideoReceived = (stream) => {
          console.log('📹 Received WebRTC video stream from phone');
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setIsStreaming(true);
            setInputSource('phone');
            
            // Force video to play and handle metadata
            videoRef.current.onloadedmetadata = () => {
              console.log('📹 Video metadata loaded:', 
                `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
              
              videoRef.current.play()
                .then(() => {
                  console.log('✅ Video playing successfully');
                  // Auto-start detection when video starts
                  if (model && !isDetectionActive) {
                    setIsDetectionActive(true);
                  }
                })
                .catch(err => {
                  console.error('❌ Video play failed:', err);
                });
            };

            // Handle video ready state
            videoRef.current.oncanplay = () => {
              console.log('📹 Video can start playing');
            };

            // Handle video errors
            videoRef.current.onerror = (err) => {
              console.error('❌ Video element error:', err);
            };
          }
        };

        webrtcRef.current.onError = (error) => {
          console.error('❌ WebRTC error:', error);
        };
        
        // Prepare to receive WebRTC calls
        webrtcRef.current.prepareToReceive();
        
        // Register as desktop
        socketRef.current.emit('register-desktop', {
          type: 'desktop',
          timestamp: new Date().toISOString()
        });
      });

      socketRef.current.on('disconnect', (reason) => {
        console.log('🖥️ Disconnected from server:', reason);
        setConnectionStatus('Disconnected');
        setPhoneConnected(false);
        setWebrtcState('disconnected');
        setAvailablePhones([]);
      });

      socketRef.current.on('desktop-registered', (data) => {
        console.log('🖥️ Desktop registered:', data);
        setAvailablePhones(data.availablePhones || []);
      });

      socketRef.current.on('phone-available', (data) => {
        console.log('📱 Phone connected:', data);
        setPhoneConnected(true);
        setPhoneId(data.phoneId);
        
        // Add to available phones if not already there
        setAvailablePhones(prev => {
          const exists = prev.find(p => p.id === data.phoneId);
          if (!exists) {
            return [...prev, { id: data.phoneId, deviceInfo: data.deviceInfo, connectedAt: data.connectedAt }];
          }
          return prev;
        });
        
        // Tell WebRTC manager about the phone
        if (webrtcRef.current) {
          webrtcRef.current.targetId = data.phoneId;
        }
      });

      socketRef.current.on('phone-disconnected', (data) => {
        console.log('📱 Phone disconnected:', data);
        const disconnectedPhoneId = data.phoneId;
        
        setAvailablePhones(prev => prev.filter(p => p.id !== disconnectedPhoneId));
        
        if (phoneId === disconnectedPhoneId) {
          setPhoneConnected(false);
          setPhoneId('');
          setWebrtcState('disconnected');
          
          // Stop video if it was from phone
          if (inputSource === 'phone') {
            setIsStreaming(false);
            setInputSource('none');
            if (videoRef.current) {
              videoRef.current.srcObject = null;
            }
          }
        }
      });

      socketRef.current.on('connect_error', (err) => {
        console.error('🖥️ Desktop connection failed:', err);
        setConnectionStatus('Connection Failed');
      });

      socketRef.current.on('reconnect', () => {
        console.log('🔄 Reconnected to server');
        setConnectionStatus('Connected');
      });
    };

    initSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }
    };
  }, []);

  // Initialize TensorFlow.js
  useEffect(() => {
    const initializeTensorFlow = async () => {
      try {
        console.log('🔧 Initializing TensorFlow.js...');
        setIsModelLoading(true);
        
        await tf.ready();
        const backend = tf.getBackend();
        setBackendInfo(backend);
        console.log(`✅ TensorFlow.js ready with backend: ${backend}`);
        
        console.log('📦 Loading COCO-SSD model...');
        const loadedModel = await cocoSsd.load({
          base: 'mobilenet_v2'
        });
        
        setModel(loadedModel);
        setIsModelLoading(false);
        console.log('✅ Model loaded successfully!');
        
      } catch (error) {
        console.error('❌ TensorFlow initialization failed:', error);
        setIsModelLoading(false);
      }
    };

    initializeTensorFlow();
  }, []);

  // Fixed: Start laptop camera function
  const startLaptopCamera = async () => {
    try {
      console.log('🎥 Starting laptop camera...');
      
      // Stop any existing stream first
      if (inputSource === 'laptop' && videoRef.current?.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setInputSource('laptop');
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play()
            .then(() => {
              setIsStreaming(true);
              console.log('🎥 Laptop camera started successfully');
              
              // Auto-start detection if model is loaded
              if (model && !isDetectionActive) {
                setIsDetectionActive(true);
              }
            })
            .catch(err => {
              console.error('❌ Video play failed:', err);
            });
        };
      }
    } catch (error) {
      console.error('❌ Laptop camera failed:', error);
      alert('Failed to access laptop camera: ' + error.message);
    }
  };

  // Request phone camera stream
  const requestPhoneStream = () => {
    if (!phoneConnected || !phoneId) {
      alert('No phone connected. Scan QR code first.');
      return;
    }

    console.log('📱 Requesting phone stream from:', phoneId);
    
    // Stop laptop camera if running
    if (inputSource === 'laptop' && videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }

    socketRef.current.emit('request-phone-stream', {
      phoneId: phoneId,
      timestamp: new Date().toISOString()
    });
  };

  // Stop camera
  const stopCamera = () => {
    console.log('🛑 Stopping camera...');
    
    if (inputSource === 'laptop' && videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    if (webrtcRef.current && inputSource === 'phone') {
      webrtcRef.current.disconnect();
    }
    
    setIsStreaming(false);
    setIsDetectionActive(false);
    setDetections([]);
    setFrameCount(0);
    setFps(0);
    setInputSource('none');
    setWebrtcState('disconnected');
    console.log('🛑 Camera stopped');
  };

  // Toggle detection
  const toggleDetection = () => {
    if (!isStreaming) {
      alert('Start a camera first before detection');
      return;
    }
    
    setIsDetectionActive(prev => !prev);
    if (!isDetectionActive) {
      console.log('🎯 Detection started');
    } else {
      console.log('⏸️ Detection paused');
      setDetections([]);
    }
  };

  // Object detection function
  const detectObjects = useCallback(async () => {
    if (!model || !videoRef.current || !canvasRef.current || !isStreaming || !isDetectionActive) {
      if (isStreaming && videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Ensure video has dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    try {
      const predictions = await model.detect(video);
      
      const filteredDetections = predictions
        .filter(detection => detection.score >= 0.6)
        .map(detection => ({
          class: detection.class,
          confidence: Math.round(detection.score * 100),
          bbox: detection.bbox,
          id: `${detection.class}_${Math.random().toString(36).substr(2, 9)}`
        }));

      setDetections(filteredDetections);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Draw bounding boxes
      filteredDetections.forEach(detection => {
        const [x, y, width, height] = detection.bbox;
        const color = detection.class === 'person' ? '#00FF00' : '#FF0000';
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);
        
        const label = `${detection.class} ${detection.confidence}%`;
        ctx.font = 'bold 16px Arial';
        const textWidth = ctx.measureText(label).width;
        
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 30, textWidth + 20, 25);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, x + 10, y - 10);
      });
      
      setFrameCount(prev => prev + 1);
      
      const now = Date.now();
      fpsRef.current.frames++;
      if (now - fpsRef.current.lastTime >= 1000) {
        setFps(fpsRef.current.frames);
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
      }

    } catch (error) {
      console.error('Detection error:', error);
    }
  }, [model, isStreaming, isDetectionActive]);

  // Detection loop
  useEffect(() => {
    if (model && isStreaming && isDetectionActive) {
      const runDetection = () => {
        detectObjects();
        detectionLoopRef.current = requestAnimationFrame(runDetection);
      };
      
      runDetection();
      
      return () => {
        if (detectionLoopRef.current) {
          cancelAnimationFrame(detectionLoopRef.current);
        }
      };
    }
  }, [model, isStreaming, isDetectionActive, detectObjects]);

  // Generate QR code
  useEffect(() => {
    const generateQRCode = async () => {
      try {
        let finalPhoneUrl;
        
        if (ngrokUrl) {
          finalPhoneUrl = `${ngrokUrl}/?mode=phone`;
        } else {
          finalPhoneUrl = `http://${SERVER_IP}:${SERVER_PORT}/?mode=phone`;
        }
        
        setPhoneUrl(finalPhoneUrl);
        
        const qrUrl = await QRCode.toDataURL(finalPhoneUrl, {
          width: 200,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        
        setQrCodeUrl(qrUrl);
        console.log('📱 QR Code generated for:', finalPhoneUrl);
      } catch (error) {
        console.error('QR code generation failed:', error);
      }
    };

    generateQRCode();
  }, [ngrokUrl, SERVER_IP, SERVER_PORT]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }
    };
  }, []);

  const getConnectionStatusColor = () => {
    if (webrtcState === 'connected') return '#28a745';
    if (connectionStatus === 'Connected') return '#007bff';
    return '#dc3545';
  };

  const getInputSourceDisplay = () => {
    if (!isStreaming) return '📷 Inactive';
    if (inputSource === 'laptop') return '🎥 Laptop';
    if (inputSource === 'phone') return '📱 Phone WebRTC';
    return '📷 Unknown';
  };

  return (
    <div style={{ 
      fontFamily: 'Arial, sans-serif', 
      padding: '20px',
      backgroundColor: '#f0f0f0',
      minHeight: '100vh'
    }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>
        🎯 WebRTC Object Detection System
      </h1>

      {/* Enhanced Status Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '15px',
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: '#fff',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        flexWrap: 'wrap'
      }}>
        <div style={{ padding: '5px 10px', borderRadius: '20px', backgroundColor: model ? '#d4edda' : '#f8d7da', color: model ? '#155724' : '#721c24' }}>
          Model: {isModelLoading ? '⏳ Loading...' : model ? '✅ Ready' : '❌ Failed'}
        </div>
        <div>Backend: {backendInfo || 'Unknown'}</div>
        <div style={{ color: getConnectionStatusColor() }}>
          Server: {connectionStatus}
        </div>
        <div style={{ color: webrtcState === 'connected' ? '#28a745' : '#dc3545' }}>
          WebRTC: {webrtcState}
        </div>
        <div style={{ color: phoneConnected ? '#28a745' : '#6c757d' }}>
          Phones: {availablePhones.length} connected
        </div>
        <div>
          Camera: {getInputSourceDisplay()}
        </div>
        <div>Frame: {frameCount}</div>
        <div>FPS: {fps}</div>
        <div style={{ color: isDetectionActive ? '#28a745' : '#6c757d' }}>
          Detection: {isDetectionActive ? '🎯 Active' : '⏸️ Paused'}
        </div>
        <div>Objects: {detections.length}</div>
      </div>

      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
        
        {/* Main Detection Area */}
        <div style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            width="640"
            height="480"
            autoPlay
            playsInline
            muted
            style={{ display: 'none' }}
          />
          
          <canvas
            ref={canvasRef}
            width="640"
            height="480"
            style={{
              border: '3px solid #333',
              borderRadius: '12px',
              backgroundColor: '#000',
              boxShadow: '0 8px 16px rgba(0,0,0,0.3)'
            }}
          />
          
          {!isStreaming && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'white',
              fontSize: '16px',
              textAlign: 'center',
              backgroundColor: 'rgba(0,0,0,0.8)',
              padding: '20px',
              borderRadius: '12px'
            }}>
              <div style={{ display: 'flex', gap: '15px', flexDirection: 'column' }}>
                <button
                  onClick={startLaptopCamera}
                  disabled={isModelLoading}
                  style={{
                    padding: '15px 30px',
                    fontSize: '16px',
                    backgroundColor: isModelLoading ? '#6c757d' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '25px',
                    cursor: isModelLoading ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {isModelLoading ? '⏳ Loading Model...' : '🎥 Use Laptop Camera'}
                </button>
                
                <button
                  onClick={requestPhoneStream}
                  disabled={isModelLoading || !phoneConnected}
                  style={{
                    padding: '15px 30px',
                    fontSize: '16px',
                    backgroundColor: isModelLoading || !phoneConnected ? '#6c757d' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '25px',
                    cursor: isModelLoading || !phoneConnected ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {!phoneConnected ? '📱 No Phone Connected' : '📱 Use Phone Camera (WebRTC)'}
                </button>
              </div>
            </div>
          )}

          {/* Camera Controls */}
          {isStreaming && (
            <div style={{
              position: 'absolute',
              bottom: '15px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '10px'
            }}>
              <button
                onClick={toggleDetection}
                disabled={!model}
                style={{
                  padding: '12px 24px',
                  fontSize: '14px',
                  backgroundColor: isDetectionActive ? '#dc3545' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '25px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {isDetectionActive ? '⏸️ Stop Detection' : '🎯 Start Detection'}
              </button>
              <button
                onClick={stopCamera}
                style={{
                  padding: '12px 24px',
                  fontSize: '14px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '25px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                🛑 Stop Camera
              </button>
            </div>
          )}

          {/* Input Source Indicator */}
          {isStreaming && (
            <div style={{
              position: 'absolute',
              top: '15px',
              left: '15px',
              padding: '8px 15px',
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              borderRadius: '20px',
              fontSize: '14px',
              fontWeight: 'bold'
            }}>
              {getInputSourceDisplay()}
            </div>
          )}

          {/* WebRTC Status Indicator */}
          {inputSource === 'phone' && (
            <div style={{
              position: 'absolute',
              top: '15px',
              right: '15px',
              padding: '8px 15px',
              backgroundColor: webrtcState === 'connected' ? 'rgba(40, 167, 69, 0.9)' : 'rgba(220, 53, 69, 0.9)',
              color: 'white',
              borderRadius: '20px',
              fontSize: '14px',
              fontWeight: 'bold'
            }}>
              📡 {webrtcState === 'connected' ? 'STREAMING' : webrtcState.toUpperCase()}
            </div>
          )}
        </div>

        {/* Detection Results & Connection Panel */}
        <div style={{
          width: '350px',
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          height: 'fit-content'
        }}>
          {/* Live Detections */}
          <h3>🎯 Live Detections</h3>
          
          {detections.length === 0 ? (
            <p style={{ color: '#666', fontStyle: 'italic', marginBottom: '20px' }}>
              {isDetectionActive ? 'No objects detected' : 'Detection paused'}
            </p>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '20px' }}>
              {detections.map(detection => (
                <div
                  key={detection.id}
                  style={{
                    padding: '10px',
                    margin: '8px 0',
                    backgroundColor: detection.class === 'person' ? '#e8f5e8' : '#ffe8e8',
                    borderRadius: '8px',
                    borderLeft: `4px solid ${detection.class === 'person' ? '#00FF00' : '#FF0000'}`
                  }}
                >
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
                    {detection.class.charAt(0).toUpperCase() + detection.class.slice(1)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    Confidence: {detection.confidence}%
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Phone Connection Section */}
          <div style={{ borderTop: '1px solid #eee', paddingTop: '20px' }}>
            <h4>📱 Phone Connection</h4>
            <div style={{
              padding: '15px',
              backgroundColor: phoneConnected ? '#d4edda' : '#f8d7da',
              borderRadius: '8px',
              marginBottom: '15px',
              color: phoneConnected ? '#155724' : '#721c24'
            }}>
              <div><strong>Status:</strong> {phoneConnected ? '✅ Phone Connected' : '❌ No Phone Connected'}</div>
              <div><strong>WebRTC:</strong> {webrtcState}</div>
              {availablePhones.length > 0 && (
                <div><strong>Available:</strong> {availablePhones.length} phone(s)</div>
              )}
            </div>

            {qrCodeUrl && (
              <div style={{ textAlign: 'center' }}>
                <img 
                  src={qrCodeUrl} 
                  alt="QR Code for Phone Connection"
                  style={{ 
                    width: '150px', 
                    height: '150px',
                    border: '2px solid #ddd',
                    borderRadius: '12px',
                    marginBottom: '10px'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                  📱 <strong>Scan with phone</strong><br/>
                  WebRTC camera interface
                </p>
                <p style={{ fontSize: '10px', color: '#999', marginBottom: '10px', wordBreak: 'break-all' }}>
                  URL: {phoneUrl}
                </p>
                <div style={{ 
                  fontSize: '11px', 
                  color: '#666',
                  backgroundColor: '#f8f9fa',
                  padding: '10px',
                  borderRadius: '8px',
                  textAlign: 'left'
                }}>
                  <strong>📋 Setup:</strong><br/>
                  1. Scan QR code with phone<br/>
                  2. Allow camera permissions<br/>
                  3. Start camera on phone<br/>
                  4. WebRTC will auto-connect<br/>
                  {ngrokUrl ? '🌐 External access via ngrok' : '📶 Same WiFi required'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;