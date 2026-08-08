#!/bin/bash
# Start the LSP gateway server (rust-analyzer WebSocket bridge)
# Usage: bash scripts/start-lsp-server.sh

export HOME=/home/z
export LSP_PORT=${LSP_PORT:-3099}

cd /home/z/my-project/mini-services/lsp-server

# Check if already running
if ss -tlnp 2>/dev/null | grep -q ":${LSP_PORT} "; then
  echo "LSP server already running on port ${LSP_PORT}"
  exit 0
fi

# Start in background, fully detached
setsid bun index.ts > /tmp/lsp-server.log 2>&1 < /dev/null &
disown

echo "Started LSP server on port ${LSP_PORT} (log: /tmp/lsp-server.log)"

# Wait for it to be ready
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sS --max-time 1 http://localhost:${LSP_PORT}/health > /dev/null 2>&1; then
    echo "LSP server is ready"
    curl -sS http://localhost:${LSP_PORT}/health
    echo ""
    exit 0
  fi
done

echo "LSP server failed to start — check /tmp/lsp-server.log"
exit 1
