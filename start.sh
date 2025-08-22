#!/bin/bash
# start.sh - One-command startup script

set -e

# Default configuration
MODE=${MODE:-"wasm"}
USE_NGROK=${USE_NGROK:-"false"}
NGROK_TOKEN=${NGROK_TOKEN:-""}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker Desktop."
        exit 1
    fi
    
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed. Please install Docker Compose."
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Function to setup models directory
setup_models() {
    print_status "Setting up models directory..."
    
    mkdir -p models
    
    # Download a lightweight model if none exists
    if [ ! -f "models/mobilenet_ssd/model.json" ]; then
        print_status "No model found. Creating placeholder for WASM mode..."
        mkdir -p models/mobilenet_ssd
        
        # Create a placeholder model info file
        cat > models/mobilenet_ssd/info.txt << EOF
Placeholder for TensorFlow.js MobileNet SSD model.

To use a real model:
1. Download a TensorFlow.js model (model.json + .bin files)
2. Place them in this directory
3. Update the model URL in InferenceManager.js

For now, the app will use MobileNet classification as fallback.
EOF
    fi
    
    print_success "Models directory ready"
}

# Function to start services based on mode
start_services() {
    print_status "Starting services in $MODE mode..."
    
    if [ "$MODE" = "server" ]; then
        print_status "Starting all services including inference server..."
        docker-compose --profile server-mode up --build -d
    else
        print_status "Starting WASM mode (frontend + signaling only)..."
        docker-compose up --build -d frontend signaling-server
    fi
    
    # Wait for services to be ready
    print_status "Waiting for services to start..."
    sleep 10
    
    # Health check
    local frontend_ready=false
    local signaling_ready=false
    local inference_ready=true  # Default true for WASM mode
    
    # Check frontend
    if curl -f http://localhost:3000 >/dev/null 2>&1; then
        frontend_ready=true
        print_success "Frontend service is ready"
    else
        print_warning "Frontend service not responding"
    fi
    
    # Check signaling server
    if curl -f http://localhost:3001/health >/dev/null 2>&1; then
        signaling_ready=true
        print_success "Signaling server is ready"
    else
        print_warning "Signaling server not responding"
    fi
    
    # Check inference server (only in server mode)
    if [ "$MODE" = "server" ]; then
        if curl -f http://localhost:3002/health >/dev/null 2>&1; then
            inference_ready=true
            print_success "Inference server is ready"
        else
            print_warning "Inference server not responding"
            inference_ready=false
        fi
    fi
    
    if [ "$frontend_ready" = true ] && [ "$signaling_ready" = true ] && [ "$inference_ready" = true ]; then
        print_success "All services are running!"
    else
        print_warning "Some services may not be fully ready. Check logs with: docker-compose logs"
    fi
}

# Function to setup ngrok tunnel
setup_ngrok() {
    if [ "$USE_NGROK" = "true" ]; then
        print_status "Setting up ngrok tunnel..."
        
        if ! command_exists ngrok; then
            print_error "ngrok is not installed. Please install ngrok or run without --ngrok flag."
            exit 1
        fi
        
        if [ -z "$NGROK_TOKEN" ]; then
            print_warning "NGROK_TOKEN not set. You may need to authenticate ngrok."
        else
            ngrok config add-authtoken "$NGROK_TOKEN"
        fi
        
        # Start ngrok in background
        print_status "Starting ngrok tunnel for port 3000..."
        nohup ngrok http 3000 > ngrok.log 2>&1 &
        sleep 5
        
        # Get the public URL
        local public_url=$(curl -s localhost:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok\.io')
        
        if [ -n "$public_url" ]; then
            print_success "Ngrok tunnel ready!"
            print_success "Public URL: $public_url"
            print_status "Share this URL with your phone to connect remotely"
        else
            print_warning "Could not retrieve ngrok URL. Check ngrok.log for details"
        fi
    fi
}

# Function to display connection info
show_connection_info() {
    echo ""
    echo "=================================================="
    echo "🚀 WebRTC Object Detection Demo is Ready!"
    echo "=================================================="
    echo ""
    echo "📱 PHONE INSTRUCTIONS:"
    echo "  1. Open a web browser on your phone"
    echo "  2. Connect to the same Wi-Fi network as this computer"
    echo "  3. Visit: http://$(hostname -I | awk '{print $1}'):3000?mode=phone"
    echo "     OR scan the QR code shown in the browser"
    echo ""
    echo "💻 DESKTOP VIEWER:"
    echo "  Open: http://localhost:3000"
    echo ""
    if [ "$USE_NGROK" = "true" ]; then
        echo "🌐 REMOTE ACCESS (via ngrok):"
        echo "  Check the public URL above for remote access"
        echo ""
    fi
    echo "📊 MONITORING:"
    echo "  - Signaling Server Stats: http://localhost:3001/stats"
    if [ "$MODE" = "server" ]; then
        echo "  - Inference Server Stats: http://localhost:3002/stats"
    fi
    echo ""
    echo "🛑 TO STOP:"
    echo "  docker-compose down"
    echo ""
    echo "Mode: $MODE"
    echo "Logs: docker-compose logs -f"
    echo "=================================================="
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --mode MODE      Set inference mode (wasm|server) [default: wasm]"
    echo "  --ngrok          Enable ngrok tunnel for remote access"
    echo "  --help           Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  MODE             Inference mode (wasm|server)"
    echo "  USE_NGROK        Enable ngrok (true|false)"
    echo "  NGROK_TOKEN      Ngrok authentication token"
    echo ""
    echo "Examples:"
    echo "  $0                           # Start in WASM mode"
    echo "  $0 --mode server            # Start in server mode"
    echo "  $0 --ngrok                  # Start with ngrok tunnel"
    echo "  MODE=server $0 --ngrok      # Server mode with ngrok"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --ngrok)
            USE_NGROK="true"
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate mode
if [ "$MODE" != "wasm" ] && [ "$MODE" != "server" ]; then
    print_error "Invalid mode: $MODE. Must be 'wasm' or 'server'"
    exit 1
fi

# Main execution
main() {
    print_status "Starting WebRTC Object Detection Demo"
    print_status "Mode: $MODE"
    
    check_prerequisites
    setup_models
    start_services
    setup_ngrok
    show_connection_info
    
    # Keep the script running and show logs
    if [ "$1" != "--no-logs" ]; then
        print_status "Showing live logs (Ctrl+C to stop logs, services will keep running):"
        docker-compose logs -f
    fi
}

# Trap Ctrl+C to show cleanup message
trap cleanup INT

cleanup() {
    echo ""
    print_status "Logs stopped. Services are still running."
    print_status "To stop all services: docker-compose down"
    exit 0
}

# Run main function
main "$@"