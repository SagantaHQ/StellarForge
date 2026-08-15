#!/usr/bin/env bash
# Start the StellarForge dev server manually (no pm2, no auto-restart).
#
# Next.js dev server has its own HMR (Hot Module Replacement) — we don't
# need pm2's auto-restart on top of that. pm2's auto-restart + Next.js HMR
# were fighting each other, causing reload loops.
#
# Usage:
#   bash scripts/start-dev.sh          # start in foreground
#   bash scripts/start-dev.sh --bg     # start in background (nohup)
#
# To stop: kill the process listed in .zscripts/dev.pid
# To see logs: tail -f .zscripts/bm2-out.log

set -e

cd /home/z/my-project

# Load env
export NODE_ENV=development
# Lowered from 2560 to 1536 MB — the dev server was still OOM-killing at
# 3.5GB anonymous RSS because --max-old-space-size only limits V8's JS heap,
# not Node's total memory (buffers, native allocations, string storage).
# 1.5GB forces V8 to GC more aggressively, keeping total RSS lower.
export NODE_OPTIONS="--max-old-space-size=1536"
export HOME=/home/z
export PATH="/home/z/.local/bin:/home/z/.cargo/bin:/home/z/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# NON-NEGOTIABLE: always PostgreSQL (Neon). Never SQLite.
export DATABASE_URL="postgresql://neondb_owner:npg_7AZB1JGmEbsD@ep-fragrant-water-ayoazbf2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
export DIRECT_DATABASE_URL="postgresql://neondb_owner:npg_7AZB1JGmEbsD@ep-fragrant-water-ayoazbf2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# GitHub token (if .env has it, load it)
if [ -f .env ]; then
  # Source .env lines that look like KEY=value
  set -a
  . .env
  set +a
fi

mkdir -p .zscripts

# Kill any existing dev server
if [ -f .zscripts/dev.pid ]; then
  OLD_PID=$(cat .zscripts/dev.pid)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing dev server (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f .zscripts/dev.pid
fi

if [ "$1" = "--bg" ]; then
  echo "Starting dev server in background..."
  nohup node node_modules/next/dist/bin/next dev -p 3000 --webpack \
    > .zscripts/bm2-out.log 2> .zscripts/bm2-error.log &
  echo $! > .zscripts/dev.pid
  echo "✓ Dev server started (PID $(cat .zscripts/dev.pid))"
  echo "  Logs: tail -f .zscripts/bm2-out.log"
  echo "  Stop: kill \$(cat .zscripts/dev.pid)"
else
  echo "Starting dev server in foreground..."
  echo "Press Ctrl+C to stop"
  exec node node_modules/next/dist/bin/next dev -p 3000 --webpack
fi
