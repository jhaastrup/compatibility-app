#!/bin/bash
# Double-click this file in Finder to run the app on your Mac.
# Then open http://localhost:8000 in your browser. Close this window (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
PORT=8000
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
echo ""
echo "  Compatible is running at:  http://localhost:$PORT"
echo "  (Close this window or press Ctrl+C to stop.)"
echo ""
( sleep 1; open "http://localhost:$PORT" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
