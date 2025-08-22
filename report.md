# Design Report: Real-time WebRTC Object Detection

This report details the design choices, low-resource mode implementation, backpressure policy, and known issues for the real-time object detection system, as required by the interview task.

---

## 1. Design Choices

The system is architected around a decoupled frontend/backend model, orchestrated with Docker for reproducibility and ease of deployment.

* **Frontend**: A single **React** application serves both the phone's camera interface and the desktop's viewer. This simplifies development and ensures code consistency. The interface renders conditionally based on URL parameters (`?mode=phone`). The phone client is required to run in a standard mobile browser without a native app installation.

* **Signaling**: A lightweight **Node.js server using Socket.IO** was chosen to manage the WebRTC signaling (exchanging SDP offers/answers and ICE candidates). This technology is ideal for handling the many concurrent, low-CPU connections typical of a signaling gateway.

* **Real-time Transport**: Native browser **WebRTC** APIs are used for the peer-to-peer connection. This minimizes latency by sending the video `MediaStream` directly from the phone to the desktop browser, bypassing the server entirely for the media transport layer.

* **Inference Communication**: Detection results are sent from the inference engine back to the browser client via a WebSocket connection. [cite_start]The payload is a JSON object containing detection coordinates, labels, and the original `frame_id` and `capture_ts` to ensure perfect alignment between the video frame and its corresponding overlay on the browser[cite: 21].

---

## 2. Low-Resource Mode (WASM)

[cite_start]A low-resource path is a mandatory requirement to ensure the demo can run on modest laptops without a dedicated GPU[cite: 10]. This mode is implemented as follows:

* [cite_start]**Technology**: The low-resource mode uses **`onnxruntime-web`** to run inference directly in the browser via WebAssembly (WASM)[cite: 11, 41]. This offloads all inference computation from the server to the client, allowing the backend to remain extremely lightweight and reducing server costs.

* [cite_start]**Model**: A quantized **MobileNet-SSD** model from the ONNX Model Zoo is used[cite: 41, 63]. This model is designed specifically for edge devices, offering a robust balance between performance and accuracy. Quantization further reduces its size and computational cost, making it suitable for running in a browser environment.

* **Performance Optimizations**: To meet real-time constraints, several optimizations are applied:
    * [cite_start]**Downscaling**: Input frames from the video stream are programmatically downscaled to **320x240 pixels** before being passed to the model[cite: 11, 42]. This dramatically reduces the number of calculations required per frame.
    * [cite_start]**Adaptive Sampling**: The application targets a processing rate of **10–15 FPS**[cite: 11, 42]. This is achieved by not running detection on every single frame received. Instead, the inference engine processes frames on a fixed interval, skipping frames in between to keep pace with the live video.

---

## 3. Backpressure and Frame Handling Policy

[cite_start]To maintain system stability and a real-time feel under heavy load (e.g., network jitter or slow client hardware), a robust backpressure policy is essential[cite: 8].

* **Frame Queue**: Incoming video frames on the client-side are placed into a short, fixed-length queue with a maximum size of two frames.

* **Frame Thinning (Dropping)**: The core of the policy is to prioritize recency over completeness. [cite_start]If the inference engine cannot keep up and the frame queue becomes full, newly arriving frames are dropped immediately[cite: 43]. We always prioritize processing the **most recent frame** available in the queue and discard older ones. This "drop-oldest" strategy is critical for a real-time system, as it ensures the on-screen overlays correspond to what is happening *now*, rather than what happened seconds ago, thus minimizing the perceived end-to-end latency.

* **Monitoring**: The application is designed to monitor the queue size. If the queue remains full for an extended period, it serves as an indicator that the client device cannot handle the current load. Future improvements would involve using this metric to dynamically adjust performance, for instance by further reducing the target FPS or notifying the user.

---

## 4. Known Issues & Incomplete Tasks

Due to the tight deadline, a critical bug prevented the completion of all project deliverables.

* **Primary Issue**: The phone-to-browser WebRTC video stream is not working. The connection consistently enters a "failed" state during the Interactive Connectivity Establishment (ICE) negotiation phase. The most likely cause is a misconfiguration in the STUN/TURN server settings or a complex network environment (such as a Symmetric NAT) that requires an authenticated TURN server for successful NAT traversal. This issue prevented the `MediaStream` from being transmitted from the phone to the desktop client.

* **Consequent Incomplete Deliverables**:
    * [cite_start]**1-Minute Loom Video**: Could not be created, as this required demonstrating the live phone stream with real-time overlays, which was non-functional[cite: 7, 19].
    * [cite_start]**`metrics.json`**: The benchmark script (`./bench/run_bench.sh`) could not be run to produce performance metrics[cite: 6, 17]. The script's function depends on a successful end-to-end video pipeline to measure latency and FPS.

Given more time, resolving the WebRTC connectivity by implementing a properly configured TURN server would be the top priority.