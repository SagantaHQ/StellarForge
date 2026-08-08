#!/bin/bash
# scripts/start-dev.sh
#
# Starts all services needed for local development:
#   1. LSP gateway server (mini-services/lsp-server, port 3099)
#      — spawns rust-analyzer, bridges WebSocket ↔ stdio
#   2. Next.js dev server (port 3000)
#      — proxies /lsp + /workspace/* to the LSP gateway
#
# Prerequisites: run scripts/install-server-tools.sh first
#
# Usage: bash scripts/start-dev.sh

set -euo pipefail

export HOME="${HOME:-/home/z}"
source "$HOME/.cargo/env" 2>/dev/null || true
source "$HOME/.bashrc" 2>/dev/null || true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()    { echo -e "${BLUE}▶ $1${NC}"; }
ok()     { echo -e "${GREEN}  ✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠ $1${NC}"; }

LSP_PORT="${LSP_PORT:-3099}"
DEV_PORT="${DEV_PORT:-3000}"
PROJECT_DIR="/home/z/my-project"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Soroban.Build — Dev Server Starter                              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Verify prerequisites ────────────────────────────────────
log "Checking prerequisites..."

if ! command -v stellar &>/dev/null; then
  echo "  ✗ stellar-cli not found. Run: bash scripts/install-server-tools.sh"
  exit 1
fi
ok "stellar-cli: $(stellar --version 2>&1 | head -1)"

if ! command -v rust-analyzer &>/dev/null; then
  echo "  ✗ rust-analyzer not found. Run: bash scripts/install-server-tools.sh"
  exit 1
fi
ok "rust-analyzer: $(rust-analyzer --version 2>&1 | head -1)"

if ! command -v bun &>/dev/null; then
  echo "  ✗ bun not found. Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
ok "bun: $(bun --version)"
echo ""

# ── Step 2: Install LSP server dependencies ─────────────────────────
log "Installing LSP server dependencies..."
cd "$PROJECT_DIR/mini-services/lsp-server"
bun install --silent 2>/dev/null || true
ok "LSP server deps installed"
echo ""

# ── Step 3: Start LSP gateway server ────────────────────────────────
log "Starting LSP gateway server (port $LSP_PORT)..."

# Check if already running
if ss -tlnp 2>/dev/null | grep -q ":${LSP_PORT} "; then
  ok "LSP server already running on port $LSP_PORT"
else
  # Start in background, fully detached via setsid
  export LSP_PORT
  setsid bun index.ts > /tmp/lsp-server.log 2>&1 < /dev/null &
  disown

  # Wait for it to be ready
  for i in $(seq 1 10); do
    sleep 1
    if curl -sS --max-time 1 "http://localhost:${LSP_PORT}/health" > /dev/null 2>&1; then
      ok "LSP server ready on port $LSP_PORT"
      curl -sS "http://localhost:${LSP_PORT}/health" 2>&1
      echo ""
      break
    fi
    if [ "$i" -eq 10 ]; then
      echo "  ✗ LSP server failed to start — check /tmp/lsp-server.log"
      tail -10 /tmp/lsp-server.log 2>/dev/null
      exit 1
    fi
  done
fi
echo ""

# ── Step 4: Start Next.js dev server ────────────────────────────────
log "Starting Next.js dev server (port $DEV_PORT)..."

cd "$PROJECT_DIR"

# Check if already running
if ss -tlnp 2>/dev/null | grep -q ":${DEV_PORT} "; then
  ok "Next.js dev server already running on port $DEV_PORT"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  ✓ All services running!                                         ║"
  echo "║                                                                  ║"
  echo "║  • LSP gateway:  http://localhost:${LSP_PORT}                         ║"
  echo "║  • Next.js dev:  http://localhost:${DEV_PORT}                         ║"
  echo "║  • LSP health:   http://localhost:${LSP_PORT}/health                 ║"
  echo "║  • LSP WebSocket: ws://localhost:${DEV_PORT}/lsp?workspace=<id>        ║"
  echo "║                                                                  ║"
  echo "║  Logs:                                                           ║"
  echo "║    • LSP:   /tmp/lsp-server.log                                  ║"
  echo "║    • Next:  bm2 logs (or .zscripts/bm2-out.log)                  ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  exit 0
fi

# Start Next.js dev server in background
setsid npx next dev -p "$DEV_PORT" > /tmp/next-dev.log 2>&1 < /dev/null &
disown

# Wait for it to be ready (Next.js takes a while to compile on first run)
log "Waiting for Next.js to compile (this may take 30-60s on first run)..."
for i in $(seq 1 60); do
  sleep 2
  if curl -sS --max-time 2 "http://localhost:${DEV_PORT}/" > /dev/null 2>&1; then
    ok "Next.js dev server ready on port $DEV_PORT"
    break
  fi
  echo -n "."
  if [ "$i" -eq 60 ]; then
    echo ""
    warn "Next.js still compiling after 120s — check /tmp/next-dev.log"
    tail -5 /tmp/next-dev.log 2>/dev/null
  fi
done
echo ""

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ✓ All services running!                                         ║"
echo "║                                                                  ║"
echo "║  • LSP gateway:  http://localhost:${LSP_PORT}                         ║"
echo "║  • Next.js dev:  http://localhost:${DEV_PORT}                         ║"
echo "║  • LSP health:   http://localhost:${LSP_PORT}/health                 ║"
echo "║  • LSP WebSocket: ws://localhost:${DEV_PORT}/lsp?workspace=<id>        ║"
echo "║                                                                  ║"
echo "║  Logs:                                                           ║"
echo "║    • LSP:   /tmp/lsp-server.log                                  ║"
echo "║    • Next:  /tmp/next-dev.log                                    ║"
echo "║                                                                  ║"
echo "║  To stop:                                                        ║"
echo "║    pkill -f 'bun index.ts'     (LSP gateway)                     ║"
echo "║    pkill -f 'next dev'         (Next.js)                         ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
