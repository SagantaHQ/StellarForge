#!/usr/bin/env bash
# Lightweight watchdog for the Soroban.Build dev server.
#
# This is NOT pm2 — it's a simple bash loop that:
#   1. Checks if the dev server process (from .zscripts/dev.pid) is alive
#   2. If dead, restarts it via scripts/start-dev.sh --bg
#   3. Sleeps 30s, repeats
#
# Unlike pm2, this does NOT auto-restart on file changes or interfere
# with Next.js HMR. It only restarts when the process is actually dead
# (e.g. OOM-killed by the OS).
#
# Usage:
#   bash scripts/watchdog.sh          # run in foreground
#   nohup bash scripts/watchdog.sh > /dev/null 2>&1 &  # run in background
#
# The watchdog itself runs as a separate nohup process. To stop it:
#   kill $(cat .zscripts/watchdog.pid)

PID_FILE="/home/z/my-project/.zscripts/dev.pid"
WATCHDOG_PID_FILE="/home/z/my-project/.zscripts/watchdog.pid"
START_SCRIPT="/home/z/my-project/scripts/start-dev.sh"

# Write our own PID so we can be stopped
echo $$ > "$WATCHDOG_PID_FILE"

echo "[watchdog] started (PID $$) — checking dev server every 30s"

while true; do
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "[watchdog] $(date '+%H:%M:%S') dev server (PID $PID) is dead — restarting..."
      bash "$START_SCRIPT" --bg > /dev/null 2>&1
      sleep 5  # give it time to start
      NEW_PID=$(cat "$PID_FILE" 2>/dev/null || echo "?")
      echo "[watchdog] $(date '+%H:%M:%S') dev server restarted (PID $NEW_PID)"
    fi
  else
    echo "[watchdog] $(date '+%H:%M:%S') no PID file — starting dev server..."
    bash "$START_SCRIPT" --bg > /dev/null 2>&1
    sleep 5
  fi
  sleep 30
done
