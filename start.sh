#!/bin/bash

# Call Dashboard Startup Script
cd "$(dirname "$0")"

# Set password (change this!)
export DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-demo123}"
export DATA_FILE="$(pwd)/../data sample.txt"

echo "🚀 Starting Call Dashboard..."
echo "   Password: $DASHBOARD_PASSWORD"
echo "   Data: $DATA_FILE"
echo ""

# Start backend
echo "Starting backend on port 3457..."
cd backend
node server.js &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
sleep 2

# Start frontend
echo "Starting frontend on port 3456..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Dashboard running!"
echo "   → Open http://localhost:3456"
echo "   → Password: $DASHBOARD_PASSWORD"
echo ""
echo "Press Ctrl+C to stop"

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

# Wait for processes
wait
