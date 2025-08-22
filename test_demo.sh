#!/bin/bash
# test_demo.sh - Quick demo test

echo "🎯 WebRTC Object Detection - Demo Test"
echo "======================================"

# Check if services are running
echo "📡 Checking services..."

if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    echo "✅ Frontend: Running"
else
    echo "❌ Frontend: Not running"
    exit 1
fi

if curl -f http://localhost:8080/health >/dev/null 2>&1; then
    echo "✅ Signaling Server: Running" 
else
    echo "❌ Signaling Server: Not running"
    exit 1
fi

if curl -f http://localhost:3002/health >/dev/null 2>&1; then
    echo "✅ Inference Server: Running"
else
    echo "⚠️  Inference Server: Not running (WASM mode)"
fi

echo ""
echo "🔗 Connection URLs:"
echo "   Desktop: http://localhost:3000"
echo "   Phone:   http://192.168.0.118:3000?mode=phone"
echo ""

# Show current stats
echo "📊 Current Stats:"
curl -s http://localhost:8080/stats | python3 -m json.tool 2>/dev/null || echo "Stats not available"

echo ""
echo "🚀 Demo is ready!"
echo "   1. Open http://localhost:3000 on desktop"
echo "   2. Scan QR code with phone camera"
echo "   3. Allow camera permissions"
echo "   4. Start detection"
echo ""
echo "📹 To record Loom video:"
echo "   1. Start screen recording"
echo "   2. Show phone connecting and live detection"
echo "   3. Run: ./bench/run_bench.sh --duration 30"
echo "   4. Show metrics.json results"
echo "   5. State one improvement (e.g., 'Add model quantization for better mobile performance')"