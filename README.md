# Real-time WebRTC Multi-Object Detection

This project is a real-time, multi-object detection system that streams live video from a phone's browser to a desktop browser via WebRTC. It performs inference using either a server-side model or a client-side WASM model and overlays the detection results onto the video feed.

[cite_start]This submission fulfills the requirements of the interview task. [cite: 1]

---

## 🚀 One-Command Start

**Prerequisites**: Docker & Docker Compose must be installed.

[cite_start]To build and run the entire application in its default low-resource (WASM) mode, execute the following command: [cite: 13, 73]

```bash
# Clone the repository, make the script executable, and start the services
git clone <your-repo-url>
cd <repo-folder>
chmod +x start.sh
./start.sh