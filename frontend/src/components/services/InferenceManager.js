// src/services/InferenceManager.js
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';

export class InferenceManager {
  constructor(mode = 'wasm') {
    this.mode = mode;
    this.model = null;
    this.isLoading = false;
    this.frameQueue = [];
    this.maxQueueSize = 3;
    this.isProcessing = false;
    
    // Performance tracking
    this.frameId = 0;
    this.processedFrames = 0;
    this.droppedFrames = 0;
    
    // Callbacks
    this.onDetection = null;
    this.onMetrics = null;
  }

  async initialize() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    console.log(`🔧 Initializing ${this.mode} mode inference...`);
    
    try {
      await tf.ready();
      console.log(`✅ TensorFlow.js backend: ${tf.getBackend()}`);
      
      if (this.mode === 'wasm') {
        await this.loadWasmModel();
      }
      
      this.isLoading = false;
      return true;
    } catch (error) {
      console.error('❌ Inference initialization failed:', error);
      this.isLoading = false;
      return false;
    }
  }

  async loadWasmModel() {
    try {
      // Try to load COCO-SSD if available
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      this.model = await cocoSsd.load({
        base: 'mobilenet_v2'
      });
      console.log('✅ COCO-SSD model loaded');
    } catch (error) {
      console.warn('⚠️ COCO-SSD not available, using fallback');
      // Use MobileNet for classification as fallback
      const mobilenet = await import('@tensorflow-models/mobilenet');
      this.model = await mobilenet.load();
      console.log('✅ MobileNet fallback model loaded');
    }
  }

  // Process frame with required JSON format
  async processFrame(imageData, sourceType = 'phone') {
    const frameId = `${Date.now()}_${this.frameId++}`;
    const captureTs = Date.now();
    
    // Create frame object with required format
    const frame = {
      frame_id: frameId,
      capture_ts: captureTs,
      recv_ts: captureTs, // Same as capture for local processing
      inference_ts: null,
      detections: [],
      imageData: imageData,
      sourceType: sourceType
    };

    // Add to queue with backpressure handling
    if (this.frameQueue.length >= this.maxQueueSize) {
      const dropped = this.frameQueue.shift();
      this.droppedFrames++;
      console.warn(`⚠️ Frame dropped (queue full): ${dropped.frame_id}`);
    }
    
    this.frameQueue.push(frame);
    
    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }
    
    return frameId;
  }

  async processQueue() {
    if (this.isProcessing || this.frameQueue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.frameQueue.length > 0) {
      const frame = this.frameQueue.shift();
      
      try {
        if (this.mode === 'wasm') {
          await this.processFrameWasm(frame);
        } else {
          await this.processFrameServer(frame);
        }
        
        this.processedFrames++;
        
        // Send metrics update
        if (this.onMetrics) {
          this.onMetrics({
            processed: this.processedFrames,
            dropped: this.droppedFrames,
            queueSize: this.frameQueue.length,
            latency: frame.inference_ts - frame.capture_ts
          });
        }
        
      } catch (error) {
        console.error(`❌ Frame processing error: ${frame.frame_id}`, error);
      }
    }
    
    this.isProcessing = false;
  }

  async processFrameWasm(frame) {
    if (!this.model) {
      throw new Error('Model not loaded');
    }

    try {
      // Convert base64 to image element
      const img = await this.base64ToImage(frame.imageData);
      
      // Run inference
      const startTime = Date.now();
      let detections = [];
      
      if (this.model.detect) {
        // COCO-SSD model
        const predictions = await this.model.detect(img);
        detections = this.formatCocoSsdDetections(predictions);
      } else {
        // MobileNet classification fallback
        const predictions = await this.model.classify(img);
        detections = this.formatMobileNetDetections(predictions);
      }
      
      frame.inference_ts = Date.now();
      frame.detections = detections;
      
      console.log(`🎯 Processed ${frame.frame_id}: ${detections.length} objects in ${frame.inference_ts - startTime}ms`);
      
      // Send results with proper format
      if (this.onDetection) {
        this.onDetection({
          frame_id: frame.frame_id,
          capture_ts: frame.capture_ts,
          recv_ts: frame.recv_ts,
          inference_ts: frame.inference_ts,
          detections: detections
        });
      }
      
    } catch (error) {
      console.error(`❌ WASM processing error:`, error);
      frame.inference_ts = Date.now();
      frame.detections = [];
    }
  }

  async processFrameServer(frame) {
    try {
      const response = await fetch('http://localhost:3002/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: frame.imageData,
          frame_id: frame.frame_id,
          capture_ts: frame.capture_ts
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Update frame with server results
      frame.recv_ts = result.recv_ts || Date.now();
      frame.inference_ts = result.inference_ts || Date.now();
      frame.detections = result.detections || [];
      
      console.log(`🎯 Server processed ${frame.frame_id}: ${frame.detections.length} objects`);
      
      // Send results
      if (this.onDetection) {
        this.onDetection({
          frame_id: result.frame_id,
          capture_ts: result.capture_ts,
          recv_ts: result.recv_ts,
          inference_ts: result.inference_ts,
          detections: result.detections
        });
      }
      
    } catch (error) {
      console.error(`❌ Server processing error:`, error);
      frame.inference_ts = Date.now();
      frame.detections = [];
    }
  }

  formatCocoSsdDetections(predictions) {
    return predictions
      .filter(pred => pred.score > 0.5)
      .map(pred => {
        const [x, y, width, height] = pred.bbox;
        return {
          label: pred.class,
          score: pred.score,
          xmin: x / (pred.bbox.imageWidth || 640),
          ymin: y / (pred.bbox.imageHeight || 480), 
          xmax: (x + width) / (pred.bbox.imageWidth || 640),
          ymax: (y + height) / (pred.bbox.imageHeight || 480)
        };
      });
  }

  formatMobileNetDetections(predictions) {
    // Convert classification to pseudo-detection for demo
    return predictions
      .filter(pred => pred.probability > 0.3)
      .slice(0, 3) // Top 3 predictions
      .map((pred, index) => ({
        label: pred.className,
        score: pred.probability,
        xmin: 0.1 + index * 0.25,
        ymin: 0.1,
        xmax: 0.3 + index * 0.25,
        ymax: 0.4
      }));
  }

  base64ToImage(base64Data) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      
      // Handle data URL or raw base64
      if (base64Data.startsWith('data:')) {
        img.src = base64Data;
      } else {
        img.src = `data:image/jpeg;base64,${base64Data}`;
      }
    });
  }

  // Utility methods for integration
  setOnDetection(callback) {
    this.onDetection = callback;
  }

  setOnMetrics(callback) {
    this.onMetrics = callback;
  }

  getStats() {
    return {
      processed: this.processedFrames,
      dropped: this.droppedFrames,
      queueSize: this.frameQueue.length,
      mode: this.mode,
      modelLoaded: !!this.model
    };
  }

  clearQueue() {
    this.frameQueue = [];
  }
}

export default InferenceManager;