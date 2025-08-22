# 🎯 WebRTC Real-Time Object Detection

A real-time demo that streams video from a phone (or laptop webcam) to a browser via WebRTC, performs object detection, and overlays bounding boxes in near real-time.

---

## ✨ Features

- 📱 **Phone Camera Streaming** – capture video directly from phone browser  
- 🌐 **WebRTC Signaling Server** – low-latency peer-to-peer streaming  
- 🖥️ **Desktop Viewer** – receive and overlay detections on live video  
- 🤖 **Object Detection Overlay** – bounding boxes + labels drawn in browser  
- ⚡ **Two Modes** –  
  - **WASM (default):** lightweight, runs in browser (TensorFlow.js / ONNX runtime)  
  - **Server:** inference on backend (Python / ONNX) for higher accuracy  
- 📊 **Metrics Collection** – auto-download `metrics.json` with FPS, latency, bandwidth  
- 🔄 **Backpressure Handling** – frame dropping & queue control to avoid lag  
- 🔗 **Ngrok Integration** – optional HTTPS tunnel for remote phone access  

---

## 🚀 Quick Start

### 1. Clone & Start
```bash
git clone <your-repo-url>
cd webrtc-object-detection
chmod +x start.sh
./start.sh             # default (wasm mode)
./start.sh --mode server # run with server inference
./start.sh --ngrok       # run with HTTPS remote access
