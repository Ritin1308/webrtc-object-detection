# server/inference_server.py - High-performance inference server
import os
import time
import base64
import json
import logging
from io import BytesIO
from typing import List, Dict, Any

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

class ObjectDetectionServer:
    def __init__(self, model_path: str = None, confidence_threshold: float = 0.5):
        self.confidence_threshold = confidence_threshold
        self.model_path = model_path or self.get_default_model_path()
        self.session = None
        self.input_shape = (640, 640)  # Default YOLO input size
        self.class_names = self.get_coco_class_names()
        
        # Performance tracking
        self.inference_count = 0
        self.total_inference_time = 0.0
        
        self.initialize_model()
    
    def get_default_model_path(self) -> str:
        """Get default model path, download if necessary"""
        model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
        os.makedirs(model_dir, exist_ok=True)
        
        # Use YOLOv5s ONNX model as default
        model_path = os.path.join(model_dir, 'yolov5s.onnx')
        
        if not os.path.exists(model_path):
            logger.warning(f"Model not found at {model_path}")
            logger.info("Please download a model or use the fallback detection")
            # For demo purposes, we'll use a simple fallback
            return None
        
        return model_path
    
    def initialize_model(self):
        """Initialize the ONNX Runtime session"""
        try:
            if self.model_path and os.path.exists(self.model_path):
                # Configure ONNX Runtime for CPU (modify for GPU if available)
                providers = ['CPUExecutionProvider']
                
                # Check if CUDA is available
                if ort.get_device() == 'GPU':
                    providers.insert(0, 'CUDAExecutionProvider')
                
                self.session = ort.InferenceSession(self.model_path, providers=providers)
                
                # Get model input details
                input_details = self.session.get_inputs()[0]
                self.input_name = input_details.name
                input_shape = input_details.shape
                
                if len(input_shape) == 4:  # [batch, channels, height, width]
                    self.input_shape = (input_shape[2], input_shape[3])
                
                logger.info(f"Model loaded successfully: {self.model_path}")
                logger.info(f"Input shape: {self.input_shape}")
                logger.info(f"Providers: {self.session.get_providers()}")
            else:
                logger.warning("No model available, using fallback detection")
                self.session = None
                
        except Exception as e:
            logger.error(f"Failed to initialize model: {e}")
            self.session = None
    
    def get_coco_class_names(self) -> List[str]:
        """Get COCO dataset class names"""
        return [
            'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
            'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
            'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
            'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
            'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
            'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
            'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
            'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
            'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
            'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
            'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
            'toothbrush'
        ]
    
    def preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """Preprocess image for model input"""
        # Resize image while maintaining aspect ratio
        h, w = image.shape[:2]
        target_h, target_w = self.input_shape
        
        # Calculate scaling and padding
        scale = min(target_w / w, target_h / h)
        new_w, new_h = int(w * scale), int(h * scale)
        
        # Resize image
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        
        # Create padded image
        padded = np.full((target_h, target_w, 3), 114, dtype=np.uint8)  # Gray padding
        
        # Calculate padding offsets
        pad_x = (target_w - new_w) // 2
        pad_y = (target_h - new_h) // 2
        
        # Place resized image in center
        padded[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
        
        # Convert to model input format
        # ONNX models typically expect [batch, channels, height, width]
        input_tensor = padded.transpose(2, 0, 1).astype(np.float32)  # HWC -> CHW
        input_tensor = input_tensor / 255.0  # Normalize to [0, 1]
        input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
        
        return input_tensor, scale, (pad_x, pad_y)
    
    def postprocess_detections(self, outputs, original_shape, scale, padding):
        """Post-process model outputs to get detections"""
        detections = []
        
        try:
            # YOLO output format: [batch, num_detections, 85] where 85 = 4 bbox + 1 conf + 80 classes
            predictions = outputs[0][0]  # Remove batch dimension
            
            # Filter by confidence
            confidences = predictions[:, 4]  # Object confidence
            valid_indices = confidences > self.confidence_threshold
            
            if not np.any(valid_indices):
                return detections
            
            valid_predictions = predictions[valid_indices]
            
            # Extract bounding boxes and class predictions
            boxes = valid_predictions[:, :4]  # [x_center, y_center, width, height]
            confidences = valid_predictions[:, 4]
            class_scores = valid_predictions[:, 5:]
            
            # Get class predictions
            class_ids = np.argmax(class_scores, axis=1)
            class_confidences = np.max(class_scores, axis=1)
            
            # Final confidence = object confidence * class confidence
            final_confidences = confidences * class_confidences
            
            # Convert from center format to corner format
            pad_x, pad_y = padding
            orig_h, orig_w = original_shape
            
            for i, (box, conf, class_id) in enumerate(zip(boxes, final_confidences, class_ids)):
                if conf > self.confidence_threshold:
                    x_center, y_center, width, height = box
                    
                    # Convert to pixel coordinates (accounting for preprocessing)
                    x_center = (x_center - pad_x) / scale
                    y_center = (y_center - pad_y) / scale
                    width = width / scale
                    height = height / scale
                    
                    # Convert to corner format and normalize
                    x1 = max(0, (x_center - width / 2) / orig_w)
                    y1 = max(0, (y_center - height / 2) / orig_h)
                    x2 = min(1, (x_center + width / 2) / orig_w)
                    y2 = min(1, (y_center + height / 2) / orig_h)
                    
                    # Get class name
                    class_name = self.class_names[class_id] if class_id < len(self.class_names) else f"class_{class_id}"
                    
                    detections.append({
                        'label': class_name,
                        'score': float(conf),
                        'xmin': float(x1),
                        'ymin': float(y1),
                        'xmax': float(x2),
                        'ymax': float(y2)
                    })
            
        except Exception as e:
            logger.error(f"Error in postprocessing: {e}")
        
        return detections
    
    def fallback_detection(self, image: np.ndarray) -> List[Dict]:
        """Simple fallback detection for when no model is available"""
        # Simple color-based "detection" as demonstration
        detections = []
        
        # Convert to HSV for color detection
        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
        
        # Define color ranges (example: detect red objects)
        lower_red1 = np.array([0, 50, 50])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([170, 50, 50])
        upper_red2 = np.array([180, 255, 255])
        
        # Create masks
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        mask = cv2.bitwise_or(mask1, mask2)
        
        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        h, w = image.shape[:2]
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 500:  # Minimum area threshold
                x, y, cw, ch = cv2.boundingRect(contour)
                
                detections.append({
                    'label': 'red_object',
                    'score': 0.8,  # Dummy confidence
                    'xmin': x / w,
                    'ymin': y / h,
                    'xmax': (x + cw) / w,
                    'ymax': (y + ch) / h
                })
        
        return detections
    
    def detect(self, image: np.ndarray) -> List[Dict]:
        """Run object detection on image"""
        start_time = time.time()
        
        try:
            if self.session is not None:
                # Use ONNX model
                input_tensor, scale, padding = self.preprocess_image(image)
                
                # Run inference
                outputs = self.session.run(None, {self.input_name: input_tensor})
                
                # Post-process results
                detections = self.postprocess_detections(outputs, image.shape[:2], scale, padding)
            else:
                # Use fallback detection
                detections = self.fallback_detection(image)
            
            # Update performance metrics
            inference_time = time.time() - start_time
            self.inference_count += 1
            self.total_inference_time += inference_time
            
            logger.info(f"Inference completed in {inference_time:.3f}s, found {len(detections)} objects")
            
            return detections
            
        except Exception as e:
            logger.error(f"Detection error: {e}")
            return []
    
    def get_stats(self) -> Dict[str, Any]:
        """Get performance statistics"""
        avg_inference_time = (self.total_inference_time / self.inference_count 
                             if self.inference_count > 0 else 0)
        
        return {
            'inference_count': self.inference_count,
            'average_inference_time_ms': avg_inference_time * 1000,
            'model_loaded': self.session is not None,
            'model_path': self.model_path,
            'input_shape': self.input_shape,
            'confidence_threshold': self.confidence_threshold
        }

# Initialize global detection server
detector = ObjectDetectionServer()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'model_loaded': detector.session is not None
    })

@app.route('/detect', methods=['POST'])
def detect_objects():
    """Main detection endpoint"""
    try:
        data = request.get_json()
        
        if 'image' not in data:
            return jsonify({'error': 'No image provided'}), 400
        
        # Decode base64 image
        image_data = data['image']
        if image_data.startswith('data:image'):
            # Remove data URL prefix
            image_data = image_data.split(',')[1]
        
        # Decode and convert to numpy array
        image_bytes = base64.b64decode(image_data)
        image = Image.open(BytesIO(image_bytes))
        image_np = np.array(image.convert('RGB'))
        
        # Run detection
        detections = detector.detect(image_np)
        
        # Prepare response
        response = {
            'frame_id': data.get('frame_id', str(time.time())),
            'capture_ts': data.get('capture_ts', time.time() * 1000),
            'recv_ts': time.time() * 1000,
            'inference_ts': time.time() * 1000,
            'detections': detections,
            'detection_count': len(detections)
        }
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Detection endpoint error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get server statistics"""
    return jsonify(detector.get_stats())

@app.route('/config', methods=['GET', 'POST'])
def handle_config():
    """Get or update server configuration"""
    if request.method == 'GET':
        return jsonify({
            'confidence_threshold': detector.confidence_threshold,
            'input_shape': detector.input_shape,
            'model_path': detector.model_path
        })
    else:
        data = request.get_json()
        if 'confidence_threshold' in data:
            detector.confidence_threshold = float(data['confidence_threshold'])
        
        return jsonify({'message': 'Configuration updated'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3002))
    debug = os.environ.get('DEBUG', 'false').lower() == 'true'
    
    logger.info(f"Starting inference server on port {port}")
    logger.info(f"Model loaded: {detector.session is not None}")
    
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)