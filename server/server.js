// Fixed server.js - Complete Socket.IO Server with ngrok & WebRTC pair tracking

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Enable CORS for all routes
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["*"],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Socket.IO with enhanced CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store active connections and streams
const connections = new Map();
const phoneStreams = new Map();
const webrtcPairs = new Map(); // Track WebRTC connections (peer -> peer)
let ngrokUrl = null;

// Enhanced ngrok detection and management with HTTPS preference
const detectNgrokUrl = () => {
  try {
    // Priority 1: Environment variable (for Docker/production)
    if (process.env.NGROK_URL) {
      ngrokUrl = process.env.NGROK_URL;
      console.log('🌐 Ngrok URL from environment:', ngrokUrl);
      return ngrokUrl;
    }

    // Priority 2: Check ngrok status API (most reliable)
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: 4040,
      path: '/api/tunnels',
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data);
          // Prefer HTTPS tunnel for camera access
          const httpsTunnel = tunnels.tunnels?.find(t => t.proto === 'https');
          const httpTunnel = tunnels.tunnels?.find(t => t.proto === 'http');
          
          if (httpsTunnel) {
            ngrokUrl = httpsTunnel.public_url;
            console.log('🌐 Ngrok HTTPS URL detected:', ngrokUrl);
          } else if (httpTunnel) {
            ngrokUrl = httpTunnel.public_url;
            console.log('🌐 Ngrok HTTP URL detected (camera may not work):', ngrokUrl);
          }
        } catch (err) {
          console.log('⚠️ Failed to parse ngrok API response');
        }
      });
    });

    req.on('error', () => {
      // Silent fail - ngrok not running
    });

    req.on('timeout', () => {
      req.destroy();
    });

    req.end();

    // Priority 3: Try to read from ngrok log file
    const ngrokLogPath = path.join(__dirname, 'ngrok.log');
    if (fs.existsSync(ngrokLogPath)) {
      const logContent = fs.readFileSync(ngrokLogPath, 'utf8');
      const httpsMatch = logContent.match(/url=https:\/\/[\w\-\.]+\.ngrok\.io/);
      const httpMatch = logContent.match(/url=http:\/\/[\w\-\.]+\.ngrok\.io/);
      
      if (httpsMatch) {
        ngrokUrl = httpsMatch[0].replace('url=', '');
        console.log('🌐 Ngrok HTTPS URL from log:', ngrokUrl);
      } else if (httpMatch && !ngrokUrl) {
        ngrokUrl = httpMatch[0].replace('url=', '');
        console.log('🌐 Ngrok HTTP URL from log (camera may not work):', ngrokUrl);
      }
    }

  } catch (error) {
    // Silent fail - ngrok not available
  }
  
  return ngrokUrl;
};

// Serve static files for phone interface
app.use('/static', express.static(path.join(__dirname, 'public')));

// Main routes
app.get('/', (req, res) => {
  const mode = req.query.mode;
  const currentNgrok = detectNgrokUrl();
  
  if (mode === 'phone') {
    // Serve phone camera interface
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📱 Phone Camera</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: #000;
            color: #fff;
            overflow-x: hidden;
        }
        .container { 
            max-width: 100vw; 
            margin: 0 auto; 
            padding: 10px;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .header {
            background: rgba(0,0,0,0.8);
            padding: 15px;
            text-align: center;
            border-radius: 10px;
            margin-bottom: 15px;
        }
        .status {
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 10px;
            text-align: center;
            font-weight: bold;
        }
        .status.connected { background: #1a5f3f; border: 2px solid #28a745; }
        .status.disconnected { background: #5f1a1a; border: 2px solid #dc3545; }
        .status.error { background: #5f3a1a; border: 2px solid #ffc107; }
        
        .video-container {
            position: relative;
            flex-grow: 1;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #222;
            border-radius: 15px;
            overflow: hidden;
            margin-bottom: 15px;
        }
        
        video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            max-height: 70vh;
        }
        
        .overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 14px;
        }
        
        .connection-indicator {
            position: absolute;
            top: 10px;
            right: 10px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .connection-indicator.connected { background: #28a745; }
        .connection-indicator.disconnected { background: #dc3545; }
        
        .controls {
            display: flex;
            gap: 10px;
            padding: 0 10px;
            margin-bottom: 15px;
        }
        
        button {
            flex: 1;
            padding: 15px;
            font-size: 16px;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
            min-height: 50px;
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-primary { background: #007bff; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-warning { background: #ffc107; color: #000; }
        .btn-success { background: #28a745; color: white; }
        
        button:active:not(:disabled) {
            transform: scale(0.95);
        }
        
        .debug {
            background: rgba(40, 40, 40, 0.9);
            padding: 15px;
            border-radius: 10px;
            font-size: 12px;
            font-family: monospace;
            max-height: 150px;
            overflow-y: auto;
            line-height: 1.4;
        }
        
        .debug strong { color: #ffc107; }
        
        @media (max-width: 480px) {
            .container { padding: 5px; }
            .controls { flex-direction: column; }
            button { font-size: 18px; padding: 18px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📱 Phone Camera Stream</h1>
        </div>
        
        <div id="status" class="status disconnected">
            🔗 Connecting to server...
        </div>
        
        <div class="video-container">
            <video id="video" autoplay playsinline muted></video>
            <canvas id="canvas" style="display: none;"></canvas>
            <div id="overlay" class="overlay" style="display: none;">
                📡 Ready
            </div>
            <div id="connectionIndicator" class="connection-indicator disconnected">●</div>
        </div>
        
        <div class="controls">
            <button id="toggleBtn" class="btn-primary" disabled>🎥 Start Camera</button>
            <button id="reconnectBtn" class="btn-warning">🔄 Reconnect</button>
        </div>
        
        <div id="debug" class="debug">
            <strong>Debug Info:</strong><br>
            Initializing connection...
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        class PhoneCameraApp {
            constructor() {
                this.socket = null;
                this.stream = null;
                this.isStreaming = false;
                this.isConnected = false;
                this.framesSent = 0;
                this.connectionAttempts = 0;
                
                this.video = document.getElementById('video');
                this.canvas = document.getElementById('canvas');
                this.status = document.getElementById('status');
                this.overlay = document.getElementById('overlay');
                this.indicator = document.getElementById('connectionIndicator');
                this.toggleBtn = document.getElementById('toggleBtn');
                this.reconnectBtn = document.getElementById('reconnectBtn');
                this.debug = document.getElementById('debug');
                
                this.setupEventListeners();
                this.connectToServer();
                this.updateDebug('App initialized');
            }
            
            setupEventListeners() {
                this.toggleBtn.addEventListener('click', () => this.toggleCamera());
                this.reconnectBtn.addEventListener('click', () => this.reconnect());
                
                // Handle visibility changes
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        this.pauseStreaming();
                    } else {
                        this.resumeStreaming();
                    }
                });
            }
            
            getServerUrl() {
                const currentUrl = new URL(window.location.href);
                // Use the same host and port as current page
                return \`\${currentUrl.protocol}//\${currentUrl.host}\`;
            }
            
            connectToServer() {
                const serverUrl = this.getServerUrl();
                this.connectionAttempts++;
                
                this.updateStatus('Connecting...', 'disconnected');
                this.updateDebug(\`Connecting to: \${serverUrl} (attempt \${this.connectionAttempts})\`);
                
                if (this.socket) {
                    this.socket.disconnect();
                }
                
                this.socket = io(serverUrl, {
                    transports: ['websocket', 'polling'],
                    timeout: 20000,
                    forceNew: true,
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000
                });
                
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.connectionAttempts = 0;
                    this.updateStatus('✅ Connected to Desktop', 'connected');
                    this.updateDebug(\`Connected! Socket ID: \${this.socket.id}\`);
                    this.toggleBtn.disabled = false;
                    
                    // Register as phone
                    this.socket.emit('register-phone', {
                        deviceInfo: {
                            userAgent: navigator.userAgent,
                            timestamp: new Date().toISOString(),
                            viewport: \`\${window.innerWidth}x\${window.innerHeight}\`
                        }
                    });
                });
                
                this.socket.on('disconnect', (reason) => {
                    this.isConnected = false;
                    this.updateStatus('❌ Disconnected', 'disconnected');
                    this.updateDebug(\`Disconnected: \${reason}\`);
                    this.toggleBtn.disabled = true;
                    
                    if (reason !== 'io client disconnect') {
                        setTimeout(() => this.connectToServer(), 3000);
                    }
                });
                
                this.socket.on('connect_error', (error) => {
                    this.updateStatus(\`⚠️ Connection Failed: \${error.message || error}\`, 'error');
                    this.updateDebug(\`Connection error: \${error.message || error}\`);
                });
                
                this.socket.on('phone-registered', (data) => {
                    this.updateDebug(\`Phone registered: \${data.connectionId}\`);
                });
                
                this.socket.on('stream-requested', (data) => {
                    this.updateDebug('Stream requested by desktop');
                    if (!this.isStreaming && this.stream) {
                        this.startFrameCapture();
                    }
                });
            }
            
            async toggleCamera() {
                if (this.isStreaming) {
                    this.stopCamera();
                } else {
                    await this.startCamera();
                }
            }
            
            async startCamera() {
                try {
                    this.updateDebug('Requesting camera access...');
                    
                    // Check if we're on HTTPS or localhost
                    const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
                    
                    if (!isSecureContext) {
                        throw new Error('Camera requires HTTPS. Please use ngrok or enable HTTPS.');
                    }
                    
                    // Check if getUserMedia is available
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                        throw new Error('Camera API not supported in this browser.');
                    }
                    
                    // Progressive camera constraints - start with basic and fallback
                    const constraints = [
                        // Try high quality first
                        {
                            video: {
                                facingMode: { ideal: 'environment' },
                                width: { ideal: 1280 },
                                height: { ideal: 720 }
                            },
                            audio: false
                        },
                        // Fallback to medium quality
                        {
                            video: {
                                facingMode: 'environment',
                                width: { ideal: 640 },
                                height: { ideal: 480 }
                            },
                            audio: false
                        },
                        // Fallback to any camera
                        {
                            video: {
                                width: { ideal: 640 },
                                height: { ideal: 480 }
                            },
                            audio: false
                        },
                        // Last resort - any video
                        { video: true, audio: false }
                    ];
                    
                    let lastError = null;
                    
                    for (let i = 0; i < constraints.length; i++) {
                        try {
                            this.updateDebug('Trying camera config ' + (i + 1) + '/' + constraints.length + '...');
                            this.stream = await navigator.mediaDevices.getUserMedia(constraints[i]);
                            break;
                        } catch (error) {
                            lastError = error;
                            this.updateDebug('Config ' + (i + 1) + ' failed: ' + error.name);
                            continue;
                        }
                    }
                    
                    if (!this.stream) {
                        throw lastError || new Error('All camera configurations failed');
                    }
                    
                    this.video.srcObject = this.stream;
                    
                    this.video.onloadedmetadata = () => {
                        this.video.play().then(() => {
                            this.isStreaming = true;
                            this.toggleBtn.textContent = '🛑 Stop Camera';
                            this.toggleBtn.className = 'btn-danger';
                            this.overlay.style.display = 'block';
                            this.updateDebug(\`Camera started: \${this.video.videoWidth}x\${this.video.videoHeight}\`);
                            
                            if (this.isConnected) {
                                this.startFrameCapture();
                            }
                        });
                    };
                    
                } catch (error) {
                    let message = 'Camera access denied';
                    if (error.name === 'NotAllowedError') {
                        message = '⚠️ Camera permission denied. Please allow camera access and reload.';
                    } else if (error.name === 'NotFoundError') {
                        message = '⚠️ No camera found on device.';
                    }
                    
                    this.updateStatus(message, 'error');
                    this.updateDebug(\`Camera error: \${error.name} - \${error.message}\`);
                }
            }
            
            stopCamera() {
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                    this.stream = null;
                }
                
                this.video.srcObject = null;
                this.isStreaming = false;
                this.framesSent = 0;
                
                this.toggleBtn.textContent = '🎥 Start Camera';
                this.toggleBtn.className = 'btn-primary';
                this.overlay.style.display = 'none';
                
                if (this.socket && this.isConnected) {
                    this.socket.emit('phone-stream-control', { action: 'stop' });
                }
                
                this.updateDebug('Camera stopped');
            }
            
            startFrameCapture() {
                if (!this.isConnected || !this.socket || !this.isStreaming) {
                    return;
                }
                
                this.updateDebug('Starting frame capture...');
                this.socket.emit('phone-stream-control', { action: 'start' });
                
                const captureFrame = () => {
                    if (!this.isStreaming || !this.isConnected || !this.video.readyState) {
                        return;
                    }
                    
                    try {
                        const ctx = this.canvas.getContext('2d');
                        
                        // Optimize canvas size
                        const maxWidth = 640;
                        const maxHeight = 480;
                        const aspectRatio = this.video.videoWidth / this.video.videoHeight;
                        
                        let canvasWidth = Math.min(this.video.videoWidth, maxWidth);
                        let canvasHeight = Math.min(this.video.videoHeight, maxHeight);
                        
                        if (canvasWidth / canvasHeight !== aspectRatio) {
                            if (canvasWidth / aspectRatio <= maxHeight) {
                                canvasHeight = canvasWidth / aspectRatio;
                            } else {
                                canvasWidth = canvasHeight * aspectRatio;
                            }
                        }
                        
                        this.canvas.width = canvasWidth;
                        this.canvas.height = canvasHeight;
                        
                        ctx.drawImage(this.video, 0, 0, canvasWidth, canvasHeight);
                        
                        const imageData = this.canvas.toDataURL('image/jpeg', 0.7);
                        
                        this.socket.emit('phone-frame', {
                            imageData,
                            timestamp: Date.now(),
                            frameNumber: ++this.framesSent,
                            width: canvasWidth,
                            height: canvasHeight
                        });
                        
                        this.overlay.textContent = \`📡 Streaming (\${this.framesSent})\`;
                        
                    } catch (error) {
                        this.updateDebug(\`Frame capture error: \${error.message}\`);
                    }
                };
                
                // Start capture loop at ~15 FPS
                const frameLoop = () => {
                    if (this.isStreaming && this.isConnected) {
                        requestAnimationFrame(() => {
                            captureFrame();
                            setTimeout(frameLoop, 1000 / 15);
                        });
                    }
                };
                
                frameLoop();
            }
            
            pauseStreaming() {
                if (this.socket && this.isConnected) {
                    this.socket.emit('phone-stream-control', { action: 'pause' });
                }
            }
            
            resumeStreaming() {
                if (this.socket && this.isConnected && this.isStreaming) {
                    this.socket.emit('phone-stream-control', { action: 'resume' });
                    this.startFrameCapture();
                }
            }
            
            reconnect() {
                this.updateDebug('Manual reconnection...');
                this.connectToServer();
            }
            
            updateStatus(message, type) {
                this.status.textContent = message;
                this.status.className = \`status \${type}\`;
                
                this.indicator.className = \`connection-indicator \${type === 'connected' ? 'connected' : 'disconnected'}\`;
            }
            
            updateDebug(message) {
                const timestamp = new Date().toLocaleTimeString();
                const line = \`\${timestamp}: \${message}\`;
                
                const currentContent = this.debug.innerHTML;
                const lines = currentContent.split('<br>');
                
                // Keep only last 10 lines
                if (lines.length > 10) {
                    lines.splice(1, lines.length - 10);
                }
                
                lines.push(line);
                this.debug.innerHTML = lines.join('<br>');
                this.debug.scrollTop = this.debug.scrollHeight;
            }
        }
        
        // Initialize app when page loads
        document.addEventListener('DOMContentLoaded', () => {
            new PhoneCameraApp();
        });
    </script>
</body>
</html>
    `);
  } else {
    // Regular server status page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>🎯 Object Detection Server</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
          .status { padding: 15px; background: #d4edda; border-radius: 8px; margin: 20px 0; }
          .link { display: inline-block; margin: 10px 0; padding: 15px 25px; background: #007bff; color: white; text-decoration: none; border-radius: 8px; }
          .ngrok { background: #28a745; }
          .phone { background: #17a2b8; }
          .debug { background: #f8f9fa; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎯 Object Detection Server</h1>
          <div class="status">
            <h3>✅ Server Status: Running</h3>
            <p><strong>WebSocket connections:</strong> ${io.engine.clientsCount}</p>
            <p><strong>Active phone streams:</strong> ${phoneStreams.size}</p>
            <p><strong>WebRTC pairs:</strong> ${webrtcPairs.size}</p>
            <p><strong>Server time:</strong> ${new Date().toLocaleString()}</p>
            ${currentNgrok ? `<p><strong>🌐 Ngrok URL:</strong> ${currentNgrok}</p>` : '<p><strong>🏠 Local network only</strong></p>'}
          </div>
          
          <h3>🔗 Quick Access Links:</h3>
          <a href="http://192.168.0.118:3000" class="link">🖥️ Desktop App (React)</a><br>
          
          ${currentNgrok && currentNgrok.startsWith('https') ? 
            `<a href="${currentNgrok}/?mode=phone" class="link ngrok">📱 Phone Camera (HTTPS - Recommended)</a><br>` : 
            ''
          }
          
          <a href="/?mode=phone" class="link phone">📱 Phone Camera (Local Network)</a><br>
          
          ${currentNgrok && currentNgrok.startsWith('http://') ? 
            `<a href="${currentNgrok}/?mode=phone" class="link" style="background: #ffc107; color: #000;">📱 Phone Camera (HTTP - Camera may not work)</a><br>` : 
            ''
          }
          
          <div style="margin: 15px 0; padding: 15px; background: ${currentNgrok && currentNgrok.startsWith('https') ? '#d4edda' : '#fff3cd'}; border-radius: 8px; border: 1px solid ${currentNgrok && currentNgrok.startsWith('https') ? '#c3e6cb' : '#ffeaa7'};">
            <strong>📱 For Phone Camera Access:</strong><br>
            ${currentNgrok && currentNgrok.startsWith('https') ? 
              '✅ HTTPS ngrok detected - Camera should work properly!' : 
              currentNgrok && currentNgrok.startsWith('http://') ?
                '⚠️ HTTP ngrok detected - Camera may be blocked by browser security.' :
                '⚠️ No HTTPS available - Camera will only work on same WiFi network.'
            }<br><br>
            
            <strong>🔒 Camera Requirements:</strong><br>
            • HTTPS connection (recommended) OR same WiFi network<br>
            • Camera permissions allowed in browser<br>
            • No other apps using the camera<br><br>
            
            ${!currentNgrok || !currentNgrok.startsWith('https') ? `
              <strong>🌐 To enable HTTPS access:</strong><br>
              1. Install ngrok: <code>npm install -g ngrok</code><br>
              2. Run: <code>ngrok http 8080</code><br>
              3. Use the HTTPS URL provided by ngrok<br>
              4. Refresh this page to auto-detect ngrok
            ` : ''}
          </div>
          
          <h3>📋 API Endpoints:</h3>
          <div class="debug">
            <strong>Available endpoints:</strong><br>
            GET  /                    - This status page<br>
            GET  /?mode=phone        - Phone camera interface<br>
            GET  /status             - JSON status<br>
            GET  /api/connections    - Connection info<br>
            GET  /api/phones         - Phone stream info<br>
            GET  /api/ngrok-url      - Get ngrok URL if available<br>
            WebSocket: /socket.io/   - Real-time communication
          </div>
          
          <h3>🔧 Setup Instructions:</h3>
          <ol>
            <li><strong>Desktop:</strong> Open <code>http://192.168.0.118:3000</code> in your browser</li>
            <li><strong>Phone:</strong> Scan QR code from desktop app OR visit <code>${currentNgrok ? currentNgrok : 'http://192.168.0.118:8080'}/?mode=phone</code></li>
            <li><strong>Allow camera permissions</strong> on phone when prompted</li>
            <li><strong>Start streaming</strong> from either device</li>
          </ol>
        </div>
      </body>
      </html>
    `);
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    connections: io.engine.clientsCount,
    phoneStreams: phoneStreams.size,
    ngrokUrl: ngrokUrl,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// API endpoint for ngrok URL
app.get('/api/ngrok-url', (req, res) => {
  const currentNgrok = detectNgrokUrl();
  res.json({
    ngrokUrl: currentNgrok,
    available: !!currentNgrok,
    lastChecked: new Date().toISOString()
  });
});

// Enhanced Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`📱 Client connected: ${socket.id} from ${socket.handshake.address}`);
  
  // Store connection info with enhanced metadata
  connections.set(socket.id, {
    id: socket.id,
    type: 'unknown',
    connectedAt: new Date(),
    lastActivity: new Date(),
    address: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent']
  });

  // Send connection established with server info
  socket.emit('connection-established', {
    connectionId: socket.id,
    serverTime: new Date().toISOString(),
    ngrokUrl: ngrokUrl
  });

  // Enhanced phone registration
  socket.on('register-phone', (data) => {
    console.log(`📱 Phone registered: ${socket.id}`);
    
    const connectionInfo = connections.get(socket.id) || {};
    connections.set(socket.id, {
      ...connectionInfo,
      type: 'phone',
      deviceInfo: data.deviceInfo || {},
      lastActivity: new Date()
    });
    
    socket.emit('phone-registered', {
      success: true,
      connectionId: socket.id,
      serverTime: new Date().toISOString(),
      ngrokUrl: ngrokUrl
    });
    
    // Notify desktop clients about new phone
    socket.broadcast.emit('phone-available', {
      phoneId: socket.id,
      deviceInfo: data.deviceInfo,
      connectedAt: new Date().toISOString()
    });
    
    console.log(`📱 Phone ${socket.id.substring(0, 8)}... registered successfully`);
  });

  // Enhanced desktop registration
  socket.on('register-desktop', (data) => {
    console.log(`🖥️ Desktop registered: ${socket.id}`);
    
    const connectionInfo = connections.get(socket.id) || {};
    connections.set(socket.id, {
      ...connectionInfo,
      type: 'desktop',
      lastActivity: new Date()
    });
    
    // Get list of available phones
    const availablePhones = Array.from(connections.values())
      .filter(conn => conn.type === 'phone')
      .map(conn => ({
        id: conn.id,
        deviceInfo: conn.deviceInfo,
        connectedAt: conn.connectedAt,
        lastActivity: conn.lastActivity
      }));
    
    socket.emit('desktop-registered', {
      success: true,
      connectionId: socket.id,
      availablePhones: availablePhones,
      serverTime: new Date().toISOString(),
      ngrokUrl: ngrokUrl
    });
    
    console.log(`🖥️ Desktop ${socket.id.substring(0, 8)}... registered, ${availablePhones.length} phones available`);
  });

  // Enhanced frame handling with performance tracking
  socket.on('phone-frame', (data) => {
    const connection = connections.get(socket.id);
    if (!connection || connection.type !== 'phone') return;

    // Update connection activity
    connection.lastActivity = new Date();
    
    // Enhanced frame data with metadata
    const frameData = {
      ...data,
      phoneId: socket.id,
      receivedAt: new Date().toISOString(),
      serverTimestamp: Date.now()
    };
    
    // Store latest frame data
    phoneStreams.set(socket.id, frameData);

    // Broadcast to all desktop clients with enhanced data
    socket.broadcast.emit('frame-from-phone', frameData);

    // Performance logging (throttled)
    if (Math.random() < 0.05) { // Log ~5% of frames
      console.log(`📸 Frame from ${socket.id.substring(0, 8)}... (${data.frameNumber || 'unknown'}) - ${data.width}x${data.height}`);
    }
  });

  // Enhanced stream control
  socket.on('phone-stream-control', (data) => {
    const { action } = data;
    console.log(`📱 Phone ${socket.id.substring(0, 8)}... stream ${action}`);
    
    const connection = connections.get(socket.id);
    if (connection) {
      connection.lastActivity = new Date();
      connection.streamStatus = action;
    }
    
    // Notify desktop clients with enhanced status
    socket.broadcast.emit('phone-stream-status', {
      phoneId: socket.id,
      action: action,
      timestamp: new Date().toISOString(),
      connectionInfo: {
        id: socket.id.substring(0, 8),
        deviceInfo: connection?.deviceInfo?.userAgent?.substring(0, 50) + '...'
      }
    });
  });

  // Desktop requesting phone stream
  socket.on('request-phone-stream', (data) => {
    const { phoneId } = data;
    console.log(`🖥️ Desktop ${socket.id.substring(0, 8)}... requesting stream from phone ${phoneId?.substring(0, 8)}...`);
    
    if (phoneId && connections.has(phoneId)) {
      socket.to(phoneId).emit('stream-requested', {
        desktopId: socket.id,
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('phone-not-found', {
        phoneId: phoneId,
        availablePhones: Array.from(connections.values())
          .filter(conn => conn.type === 'phone')
          .map(conn => conn.id)
      });
    }
  });

  // WebRTC signaling with enhanced logging + pair-tracking
  socket.on('webrtc-offer', (data) => {
    console.log(`🔄 WebRTC offer: ${socket.id.substring(0, 8)}... → ${data.target?.substring(0, 8)}...`);
    // track pair (both directions)
    if (data.target) {
      webrtcPairs.set(socket.id, data.target);
      webrtcPairs.set(data.target, socket.id);
    }
    socket.to(data.target).emit('webrtc-offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    console.log(`🔄 WebRTC answer: ${socket.id.substring(0, 8)}... → ${data.target?.substring(0, 8)}...`);
    if (data.target) {
      webrtcPairs.set(socket.id, data.target);
      webrtcPairs.set(data.target, socket.id);
    }
    socket.to(data.target).emit('webrtc-answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('webrtc-ice', (data) => {
    socket.to(data.target).emit('webrtc-ice', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Enhanced ping/pong for connection health
  socket.on('ping', (data) => {
    socket.emit('pong', {
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
      clientTime: data?.timestamp,
      connectionId: socket.id
    });
  });

  // Connection quality monitoring
  socket.on('connection-quality', (data) => {
    const connection = connections.get(socket.id);
    if (connection) {
      connection.quality = data;
      connection.lastActivity = new Date();
    }
  });

  // Enhanced error handling
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id.substring(0, 8)}...:`, error);
    
    const connection = connections.get(socket.id);
    if (connection) {
      connection.lastError = {
        error: error.message || error,
        timestamp: new Date().toISOString()
      };
    }
  });

  // Enhanced disconnection handling
  socket.on('disconnect', (reason) => {
    console.log(`📱 Client disconnected: ${socket.id.substring(0, 8)}... (${reason})`);
    
    const connection = connections.get(socket.id);
    
    if (connection) {
      // Log connection stats
      const connectionDuration = new Date() - connection.connectedAt;
      console.log(`📊 Connection stats for ${socket.id.substring(0, 8)}...: ${Math.round(connectionDuration / 1000)}s duration, type: ${connection.type}`);
      
      // Clean up phone stream if it was a phone
      if (connection.type === 'phone') {
        phoneStreams.delete(socket.id);
        
        // Notify desktop clients that phone is gone
        socket.broadcast.emit('phone-disconnected', {
          phoneId: socket.id,
          timestamp: new Date().toISOString(),
          reason: reason,
          connectionDuration: connectionDuration
        });
        
        console.log(`📱 Phone stream ${socket.id.substring(0, 8)}... cleaned up`);
      }
    }
    
    // Clean up WebRTC pairs
    if (webrtcPairs.has(socket.id)) {
      const peer = webrtcPairs.get(socket.id);
      webrtcPairs.delete(peer);
      webrtcPairs.delete(socket.id);
      socket.broadcast.emit('webrtc-pair-removed', { removed: socket.id, peer });
      console.log(`🔗 Cleaned up WebRTC pair: ${socket.id.substring(0,8)} ↔ ${peer?.substring(0,8)}`);
    } else {
      // Also check if any peer points to this socket and remove them
      for (const [a, b] of webrtcPairs.entries()) {
        if (b === socket.id) {
          webrtcPairs.delete(a);
          webrtcPairs.delete(socket.id);
          socket.broadcast.emit('webrtc-pair-removed', { removed: socket.id, peer: a });
          console.log(`🔗 Cleaned up WebRTC pair: ${a.substring(0,8)} ↔ ${socket.id.substring(0,8)}`);
          break;
        }
      }
    }

    // Remove connection
    connections.delete(socket.id);
  });
});

// Enhanced cleanup and maintenance
setInterval(() => {
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  
  // Clean up old phone streams
  for (const [phoneId, streamData] of phoneStreams.entries()) {
    const streamAge = now - new Date(streamData.receivedAt);
    if (streamAge > 5 * 60 * 1000) { // 5 minutes
      console.log(`🧹 Cleaning up old stream from ${phoneId.substring(0, 8)}...`);
      phoneStreams.delete(phoneId);
    }
  }
  
  // Clean up stale connections
  for (const [socketId, connection] of connections.entries()) {
    if (connection.lastActivity < thirtyMinutesAgo) {
      console.log(`🧹 Cleaning up stale connection ${socketId.substring(0, 8)}...`);
      connections.delete(socketId);
    }
  }

  // Clean up stale webrtcPairs where peer is gone
  for (const [a, b] of webrtcPairs.entries()) {
    if (!connections.has(a) || !connections.has(b)) {
      console.log(`🧹 Cleaning up stale WebRTC pair ${a.substring(0,8)} <-> ${b ? b.substring(0,8) : 'unknown'}`);
      webrtcPairs.delete(a);
      if (b) webrtcPairs.delete(b);
    }
  }
  
  // Update ngrok URL periodically
  detectNgrokUrl();
  
}, 60000); // Run every minute

// Additional API endpoints for debugging and monitoring
app.get('/api/connections', (req, res) => {
  const connectionList = Array.from(connections.entries()).map(([id, conn]) => ({
    id: id.substring(0, 8) + '...',
    type: conn.type,
    connectedAt: conn.connectedAt,
    lastActivity: conn.lastActivity,
    address: conn.address,
    userAgent: conn.userAgent?.substring(0, 50) + '...',
    quality: conn.quality,
    streamStatus: conn.streamStatus,
    lastError: conn.lastError
  }));

  res.json({
    totalConnections: connections.size,
    connections: connectionList,
    summary: {
      phones: connectionList.filter(c => c.type === 'phone').length,
      desktops: connectionList.filter(c => c.type === 'desktop').length,
      unknown: connectionList.filter(c => c.type === 'unknown').length
    }
  });
});

app.get('/api/phones', (req, res) => {
  const phoneList = Array.from(phoneStreams.entries()).map(([id, stream]) => ({
    id: id.substring(0, 8) + '...',
    lastFrame: stream.receivedAt,
    frameAge: new Date() - new Date(stream.receivedAt),
    frameNumber: stream.frameNumber,
    dimensions: `${stream.width}x${stream.height}`,
    dataSize: stream.imageData?.length || 0
  }));

  res.json({
    totalPhones: phoneStreams.size,
    phones: phoneList,
    activeStreams: phoneList.filter(p => p.frameAge < 10000).length // Active in last 10 seconds
  });
});

app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
    },
    connections: {
      total: connections.size,
      phones: Array.from(connections.values()).filter(c => c.type === 'phone').length,
      desktops: Array.from(connections.values()).filter(c => c.type === 'desktop').length
    },
    streams: {
      active: phoneStreams.size,
      recentFrames: Array.from(phoneStreams.values()).filter(s => 
        new Date() - new Date(s.receivedAt) < 30000
      ).length
    },
    ngrok: {
      available: !!ngrokUrl,
      url: ngrokUrl
    },
    timestamp: new Date().toISOString()
  });
});

// Catch-all for phone interface routing
app.get('*', (req, res) => {
  if (req.query.mode === 'phone') {
    // Redirect to main route with mode parameter
    res.redirect('/?mode=phone');
  } else {
    res.status(404).send(`
      <h1>404 - Page Not Found</h1>
      <p>Available routes:</p>
      <ul>
        <li><a href="/">Server Status</a></li>
        <li><a href="/?mode=phone">Phone Camera</a></li>
        <li><a href="/status">API Status</a></li>
        <li><a href="/api/health">Health Check</a></li>
      </ul>
    `);
  }
});

// Start server with enhanced startup info
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log('');
  console.log('🚀 ================================');
  console.log('🎯 Object Detection Server Started');
  console.log('🚀 ================================');
  console.log('');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Server URL: http://192.168.0.118:${PORT}`);
  console.log('');
  console.log('🔗 Quick Access URLs:');
  console.log(`   🖥️  Desktop App:     http://192.168.0.118:3000`);
  console.log(`   📱  Phone Camera:    http://192.168.0.118:${PORT}/?mode=phone`);
  console.log(`   📊  Server Status:   http://192.168.0.118:${PORT}`);
  console.log(`   🔧  API Health:      http://192.168.0.118:${PORT}/api/health`);
  console.log('');
  console.log('🌐 Ngrok Detection:');
  const initialNgrok = detectNgrokUrl();
  if (initialNgrok) {
    console.log(`   ✅  Ngrok URL: ${initialNgrok}`);
    console.log(`   📱  External Phone: ${initialNgrok}/?mode=phone`);
  } else {
    console.log('   ⚠️   No ngrok detected - local network only');
    console.log('   💡  To enable external access:');
    console.log('       1. Install ngrok: npm install -g ngrok');
    console.log(`       2. Run: ngrok http ${PORT}`);
    console.log('       3. Restart server to auto-detect ngrok URL');
  }
  console.log('');
  console.log('📋 Docker Support:');
  console.log('   🐳  Expose ports: 8080 (Socket.IO) and 3000 (React)');
  console.log('   🔧  Set NGROK_URL env var if using ngrok in container');
  console.log('');
  console.log('✅ Server ready for connections!');
  console.log('================================');
  console.log('');
  
  // Periodic ngrok check
  setInterval(() => {
    const currentNgrok = detectNgrokUrl();
    if (currentNgrok !== ngrokUrl) {
      if (currentNgrok) {
        console.log(`🌐 Ngrok URL updated: ${currentNgrok}`);
        ngrokUrl = currentNgrok;
        
        // Notify all connected clients about ngrok URL change
        io.emit('ngrok-updated', {
          ngrokUrl: currentNgrok,
          timestamp: new Date().toISOString()
        });
      } else if (ngrokUrl) {
        console.log('⚠️ Ngrok URL no longer available');
        ngrokUrl = null;
        
        io.emit('ngrok-unavailable', {
          timestamp: new Date().toISOString()
        });
      }
    }
  }, 30000); // Check every 30 seconds
});
