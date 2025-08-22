// frontend/src/components/DesktopViewer.js
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import WebRTCManager from '../services/WebRTCManager';
import InferenceManager from '../services/InferenceManager';
import MetricsCollector from '../services/MetricsCollector';

const DesktopViewer = () => {
  // Refs for video and canvas elements
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const qrCanvasRef = useRef(null);

  // State management
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [detections, setDetections] = useState([]);
  const [metrics, setMetrics] = useState({
    fps: 0,
    latency: 0,
    processed: 0
  });
  const [inferenceMode, setInferenceMode] = useState('wasm'); // 'wasm' or 'server'

  // Manager instances
  const webrtcRef = useRef(null);
  const inferenceRef = useRef(null);
  const metricsRef = useRef(null);

  useEffect(() => {
    initializeManagers();
    generateQRCode();
    
    return () => {
      cleanup();
    };
  }, []);

  const initializeManagers = async () => {
    // Initialize metrics collector
    metricsRef.current = new MetricsCollector();
    metricsRef.current.onMetricsUpdate = (newMetrics) => {
      setMetrics(newMetrics);
    };

    // Initialize inference manager
    inferenceRef.current = new InferenceManager(inferenceMode);
    inferenceRef.current.onDetectionComplete = (results) => {
      // Update detections and metrics
      setDetections(results.detections || []);
      metricsRef.current.recordDetection(results);
    };
    await inferenceRef.current.initialize();

    // Initialize WebRTC manager
    webrtcRef.current = new WebRTCManager();
    webrtcRef.current.onConnectionStateChange = (state) => {
      setConnectionStatus(state);
    };
    webrtcRef.current.onVideoReceived = (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // --- FIX: Start playing the video ---
        // The .play() method returns a promise, which we handle here.
        videoRef.current.play().catch(error => {
          console.error('Error attempting to play video:', error);
        });
        // --- End of Fix ---

        startInference();
      }
    };

    // Start as viewer (receives video)
    await webrtcRef.current.answerCall();
  };

  const generateQRCode = async () => {
    const phoneUrl = `${window.location.origin}?mode=phone`;
    try {
      await QRCode.toCanvas(qrCanvasRef.current, phoneUrl, {
        width: 200,
        margin: 2
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  };

  const startInference = () => {
    const processFrame = async () => {
      if (!videoRef.current || !canvasRef.current || !inferenceRef.current) {
        requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Set canvas size to match video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Draw current video frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Capture frame for inference
      const frameData = {
        canvas: canvas,
        timestamp: performance.now(),
        frameId: Date.now().toString()
      };

      try {
        // Run inference
        const results = await inferenceRef.current.detect(frameData);
        
        if (results && results.detections) {
          // Record metrics
          metricsRef.current.recordFrame(frameData.timestamp, performance.now());
          
          // Draw bounding boxes
          drawDetections(ctx, results.detections, canvas.width, canvas.height);
          setDetections(results.detections);
        }
      } catch (error) {
        console.error('Inference error:', error);
      }

      // Continue processing
      requestAnimationFrame(processFrame);
    };

    processFrame();
  };

  const drawDetections = (ctx, detections, width, height) => {
    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.font = '14px Arial';

    detections.forEach(detection => {
      const { label, score, xmin, ymin, xmax, ymax } = detection;
      
      // Convert normalized coordinates to pixel coordinates
      const x = xmin * width;
      const y = ymin * height;
      const boxWidth = (xmax - xmin) * width;
      const boxHeight = (ymax - ymin) * height;

      // Draw bounding box
      ctx.strokeRect(x, y, boxWidth, boxHeight);

      // Draw label background
      const text = `${label} (${(score * 100).toFixed(1)}%)`;
      const textMetrics = ctx.measureText(text);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(x, y - 20, textMetrics.width + 10, 20);

      // Draw label text
      ctx.fillStyle = '#000000';
      ctx.fillText(text, x + 5, y - 5);
      ctx.fillStyle = '#00ff00';
    });
  };

  const cleanup = () => {
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
    }
    if (inferenceRef.current) {
      inferenceRef.current.cleanup();
    }
    if (metricsRef.current) {
      metricsRef.current.stop();
    }
  };

  const handleModeChange = async (newMode) => {
    setInferenceMode(newMode);
    if (inferenceRef.current) {
      await inferenceRef.current.switchMode(newMode);
    }
  };

  return (
    <div className="desktop-viewer">
      <div className="header">
        <h1>WebRTC Object Detection Viewer</h1>
        <div className="controls">
          <label>
            Inference Mode:
            <select value={inferenceMode} onChange={(e) => handleModeChange(e.target.value)}>
              <option value="wasm">WASM (Low Resource)</option>
              <option value="server">Server (High Performance)</option>
            </select>
          </label>
        </div>
      </div>

      <div className="main-content">
        <div className="video-section">
          {connectionStatus === 'disconnected' && (
            <div className="connection-prompt">
              <h2>Scan QR Code with Your Phone</h2>
              <canvas ref={qrCanvasRef} />
              <p>Or visit: {window.location.origin}?mode=phone</p>
            </div>
          )}
          
          {connectionStatus === 'connected' && (
            <div className="video-container">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ display: 'none' }} // Hidden, we show canvas instead
              />
              <canvas ref={canvasRef} className="detection-canvas" />
            </div>
          )}
        </div>

        <div className="info-panel">
          <div className="status">
            <h3>Status</h3>
            <p>Connection: <span className={`status-${connectionStatus}`}>{connectionStatus}</span></p>
            <p>Mode: {inferenceMode.toUpperCase()}</p>
          </div>

          <div className="metrics">
            <h3>Metrics</h3>
            <p>FPS: {metrics.fps.toFixed(1)}</p>
            <p>Latency: {metrics.latency.toFixed(0)}ms</p>
            <p>Processed: {metrics.processed}</p>
          </div>

          {detections.length > 0 && (
            <div className="detections">
              <h3>Current Detections</h3>
              {detections.map((det, idx) => (
                <div key={idx} className="detection-item">
                  {det.label} ({(det.score * 100).toFixed(1)}%)
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesktopViewer;