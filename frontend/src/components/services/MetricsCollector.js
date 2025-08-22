// frontend/src/services/MetricsCollector.js
class MetricsCollector {
  constructor() {
    this.frameMetrics = [];
    this.startTime = performance.now();
    this.frameCount = 0;
    this.processedCount = 0;
    
    // Circular buffer for recent metrics (keeps memory usage bounded)
    this.maxMetricsHistory = 1000;
    
    // Bandwidth tracking
    this.bandwidthSamples = [];
    this.lastBandwidthSample = 0;
    
    // Real-time metrics
    this.currentMetrics = {
      fps: 0,
      processedFps: 0,
      latencyMs: {
        median: 0,
        p95: 0,
        current: 0
      },
      bandwidth: {
        upload: 0,
        download: 0
      },
      processing: {
        queueSize: 0,
        dropRate: 0
      }
    };
    
    // Callbacks
    this.onMetricsUpdate = null;
    
    // Start periodic metrics calculation
    this.metricsInterval = setInterval(() => {
      this.calculateMetrics();
    }, 1000); // Update every second
  }

  recordFrame(captureTimestamp, displayTimestamp = null) {
    const now = performance.now();
    const frameMetric = {
      frameId: this.frameCount++,
      captureTs: captureTimestamp,
      displayTs: displayTimestamp || now,
      endToEndLatency: (displayTimestamp || now) - captureTimestamp,
      timestamp: now
    };

    // Add to circular buffer
    this.frameMetrics.push(frameMetric);
    if (this.frameMetrics.length > this.maxMetricsHistory) {
      this.frameMetrics.shift();
    }

    // Update processed count if we have a detection result
    if (displayTimestamp) {
      this.processedCount++;
    }

    return frameMetric;
  }

  recordDetection(detectionResult) {
    const { frame_id, capture_ts, recv_ts, inference_ts } = detectionResult;
    
    // Find the corresponding frame metric
    const frameMetric = this.frameMetrics.find(f => f.frameId.toString() === frame_id.toString());
    
    if (frameMetric) {
      frameMetric.recvTs = recv_ts;
      frameMetric.inferenceTs = inference_ts;
      frameMetric.networkLatency = recv_ts - capture_ts;
      frameMetric.inferenceLatency = inference_ts - recv_ts;
      frameMetric.hasDetection = true;
    }

    this.processedCount++;
  }

  recordBandwidth(uploadBytes = 0, downloadBytes = 0) {
    const now = performance.now();
    const timeDelta = now - this.lastBandwidthSample;
    
    if (timeDelta > 0) {
      const uploadKbps = (uploadBytes * 8) / (timeDelta / 1000) / 1000;
      const downloadKbps = (downloadBytes * 8) / (timeDelta / 1000) / 1000;
      
      this.bandwidthSamples.push({
        timestamp: now,
        upload: uploadKbps,
        download: downloadKbps
      });

      // Keep only recent samples (last 10 seconds)
      const cutoff = now - 10000;
      this.bandwidthSamples = this.bandwidthSamples.filter(s => s.timestamp > cutoff);
    }
    
    this.lastBandwidthSample = now;
  }

  calculateMetrics() {
    const now = performance.now();
    const timeElapsed = (now - this.startTime) / 1000; // seconds

    // Calculate FPS
    const recentFrames = this.frameMetrics.filter(f => (now - f.timestamp) < 1000);
    this.currentMetrics.fps = recentFrames.length;
    
    // Calculate processed FPS
    const recentProcessed = this.frameMetrics.filter(f => f.hasDetection && (now - f.timestamp) < 1000);
    this.currentMetrics.processedFps = recentProcessed.length;

    // Calculate latency metrics
    const latencies = this.frameMetrics
      .filter(f => f.endToEndLatency > 0)
      .map(f => f.endToEndLatency)
      .sort((a, b) => a - b);

    if (latencies.length > 0) {
      this.currentMetrics.latencyMs.median = this.calculatePercentile(latencies, 50);
      this.currentMetrics.latencyMs.p95 = this.calculatePercentile(latencies, 95);
      this.currentMetrics.latencyMs.current = latencies[latencies.length - 1];
    }

    // Calculate bandwidth
    if (this.bandwidthSamples.length > 0) {
      const recentBandwidth = this.bandwidthSamples.slice(-5); // Last 5 samples
      this.currentMetrics.bandwidth.upload = this.average(recentBandwidth.map(s => s.upload));
      this.currentMetrics.bandwidth.download = this.average(recentBandwidth.map(s => s.download));
    }

    // Calculate drop rate
    const totalFrames = this.frameCount;
    const processedFrames = this.processedCount;
    this.currentMetrics.processing.dropRate = totalFrames > 0 ? 
      ((totalFrames - processedFrames) / totalFrames) * 100 : 0;

    // Trigger callback
    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({ ...this.currentMetrics });
    }
  }

  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    return sortedArray[lower] * (upper - index) + sortedArray[upper] * (index - lower);
  }

  average(numbers) {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  // Generate benchmark report for 30-second test
  generateBenchmarkReport(duration = 30) {
    const endTime = performance.now();
    const startTime = endTime - (duration * 1000);
    
    // Filter metrics to benchmark period
    const benchmarkFrames = this.frameMetrics.filter(f => 
      f.timestamp >= startTime && f.timestamp <= endTime
    );

    const latencies = benchmarkFrames
      .filter(f => f.endToEndLatency > 0)
      .map(f => f.endToEndLatency);

    const processedFrames = benchmarkFrames.filter(f => f.hasDetection);
    const networkLatencies = benchmarkFrames
      .filter(f => f.networkLatency > 0)
      .map(f => f.networkLatency);
    const inferenceLatencies = benchmarkFrames
      .filter(f => f.inferenceLatency > 0)
      .map(f => f.inferenceLatency);

    const report = {
      test_duration_seconds: duration,
      total_frames: benchmarkFrames.length,
      processed_frames: processedFrames.length,
      fps: {
        average: benchmarkFrames.length / duration,
        processed: processedFrames.length / duration
      },
      latency_ms: {
        end_to_end: {
          median: this.calculatePercentile(latencies.sort((a, b) => a - b), 50),
          p95: this.calculatePercentile(latencies.sort((a, b) => a - b), 95),
          mean: this.average(latencies),
          min: Math.min(...latencies) || 0,
          max: Math.max(...latencies) || 0
        },
        network: {
          median: this.calculatePercentile(networkLatencies.sort((a, b) => a - b), 50),
          mean: this.average(networkLatencies)
        },
        inference: {
          median: this.calculatePercentile(inferenceLatencies.sort((a, b) => a - b), 50),
          mean: this.average(inferenceLatencies)
        }
      },
      bandwidth_kbps: {
        upload: this.currentMetrics.bandwidth.upload,
        download: this.currentMetrics.bandwidth.download
      },
      processing: {
        drop_rate_percent: this.currentMetrics.processing.dropRate,
        queue_size: this.currentMetrics.processing.queueSize
      },
      timestamp: new Date().toISOString()
    };

    return report;
  }

  // Export metrics for benchmarking script
  exportMetrics(filename = 'metrics.json') {
    const report = this.generateBenchmarkReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return report;
  }

  // Get current performance summary
  getCurrentSummary() {
    return {
      ...this.currentMetrics,
      uptime: (performance.now() - this.startTime) / 1000,
      totalFrames: this.frameCount,
      processedFrames: this.processedCount
    };
  }

  // Reset all metrics
  reset() {
    this.frameMetrics = [];
    this.bandwidthSamples = [];
    this.frameCount = 0;
    this.processedCount = 0;
    this.startTime = performance.now();
  }

  // Stop metrics collection
  stop() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }
}

export default MetricsCollector;