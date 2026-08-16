#!/usr/bin/env bash
# ============================================================
# StellarForge — LSP WebSocket fix deploy script (2026-08-16)
# ============================================================
# This script deploys the fix for:
#   WebSocket connection to 'wss://stellarforge.app/lsp?workspace=...'
#   failed: Error during WebSocket handshake: Unexpected response code: 301
#
# The fix has 3 parts, ALL already committed and pushed to main:
#   1. mini-services/lsp-server/index.ts — accepts WS upgrades on both
#      /lsp and /lsp/ (noServer mode + manual upgrade handler).
#   2. src/lib/lsp/lsp-client.ts — client now connects to /lsp/ (trailing
#      slash) to bypass the nginx 301 redirect entirely.
#   3. deploy/nginx.conf — §CRITICAL comment + uses `location /lsp`
#      (no trailing slash) so nginx doesn't auto-redirect.
#
# This script does the actual server-side restart steps:
#   1. git pull
#   2. Rebuild the Next.js frontend (so the new lsp-client.ts is bundled)
#   3. Restart the Next.js production server (bun --bun next start)
#   4. Restart the LSP server (so the new isLspUpgradePath handler runs)
#   5. Update nginx config + reload (so /lsp is a prefix match, not /lsp/)
#
# Usage:
#   bash scripts/deploy-lsp-fix.sh
#
# Run on the PRODUCTION server as the user that owns the repo.
# ============================================================
set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────
REPO_DIR="${REPO_DIR:-/home/z/my-project/analysis/soroban.build}"
# Or wherever your production checkout lives — override with REPO_DIR=...

echo "============================================================"
echo "  StellarForge — LSP WebSocket fix deploy"
echo "============================================================"
echo "Repo: $REPO_DIR"
echo ""

cd "$REPO_DIR"

# ─── Step 0: pre-flight checks ────────────────────────────────────
echo "[1/6] Pre-flight checks..."
test -f package.json || { echo "  ✗ package.json not found in $REPO_DIR — wrong dir?"; exit 1; }
test -d .git || { echo "  ✗ not a git repo"; exit 1; }
command -v bun >/dev/null || { echo "  ✗ bun not installed"; exit 1; }
command -v nginx >/dev/null || { echo "  ⚠ nginx not installed (skipping nginx reload)"
  SKIP_NGINX=1; }
echo "  ✓ all checks passed"
echo ""

# ─── Step 1: pull latest ──────────────────────────────────────────
echo "[2/6] Pulling latest from main..."
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "  ✓ already up to date ($LOCAL)"
else
  git pull --ff-only origin main
  echo "  ✓ pulled $(git rev-parse --short HEAD)"
fi
echo ""

# ─── Step 2: verify the fix is in the pulled code ─────────────────
echo "[3/6] Verifying fix is in source..."
if grep -q "isLspUpgradePath" mini-services/lsp-server/index.ts; then
  echo "  ✓ LSP server has isLspUpgradePath handler"
else
  echo "  ✗ LSP server fix not found — pull failed?"; exit 1
fi
if grep -q '/lsp/' src/lib/lsp/lsp-client.ts; then
  echo "  ✓ LSP client uses /lsp/ (trailing slash)"
else
  echo "  ✗ LSP client fix not found"; exit 1
fi
echo ""

# ─── Step 3: rebuild Next.js frontend ─────────────────────────────
echo "[4/6] Rebuilding Next.js frontend (this takes 1-2 min)..."
# Install deps if needed
if [ ! -d node_modules/next ]; then
  bun install
fi
# Generate Prisma client (needed for /api/auth/session etc.)
bunx --bun prisma generate
# Build
bun --bun next build
echo "  ✓ build complete"
echo ""

# ─── Step 4: restart Next.js production server ────────────────────
echo "[5/6] Restarting Next.js production server..."
# Kill any existing next start
pkill -f "next start" 2>/dev/null || true
sleep 2
# Load env
if [ -f .env ]; then
  set -a; . .env; set +a
fi
# Start in background
setsid env NODE_ENV=production HOME=/home/z \
  bun --bun next start -p 3700 \
  > /tmp/nextjs-prod.log 2>&1 < /dev/null &
disown
sleep 5
# Verify it's up
if curl -sS --max-time 5 http://localhost:3700/ -o /dev/null; then
  echo "  ✓ Next.js production server is up on port 3700"
else
  echo "  ✗ Next.js production server failed to start — check /tmp/nextjs-prod.log"
  tail -20 /tmp/nextjs-prod.log
  exit 1
fi
echo ""

# ─── Step 5: restart LSP server ───────────────────────────────────
echo "[6/6] Restarting LSP server..."
pkill -f "lsp-server/index.ts" 2>/dev/null || true
sleep 2
cd mini-services/lsp-server
# Install deps if needed
[ -d node_modules/ws ] || bun install
setsid env LSP_PORT=3099 HOME=/home/z \
  RUST_ANALYZER_BIN=/home/z/.cargo/bin/rust-analyzer \
  bun index.ts > /tmp/lsp-server.log 2>&1 < /dev/null &
disown
cd "$REPO_DIR"
sleep 2
# Verify
if curl -sS --max-time 2 http://localhost:3099/health | grep -q '"ok":true'; then
  echo "  ✓ LSP server is up on port 3099"
else
  echo "  ✗ LSP server failed to start — check /tmp/lsp-server.log"
  tail -20 /tmp/lsp-server.log
  exit 1
fi
echo ""

# ─── Step 6 (optional): update + reload nginx ─────────────────────
if [ -z "${SKIP_NGINX:-}" ]; then
  echo "[bonus] Updating nginx config..."
  # Backup current config
  NGINX_CONF=/etc/nginx/sites-available/stellarforge.app
  if [ -f "$NGINX_CONF" ]; then
    cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%Y%m%d_%H%M%S)"
    echo "  ✓ backed up old config to $NGINX_CONF.bak.*"
  fi
  # Copy new config
  if cp deploy/nginx.conf "$NGINX_CONF" 2>/dev/null || \
     sudo cp deploy/nginx.conf "$NGINX_CONF" 2>/dev/null; then
    echo "  ✓ copied new nginx config"
  else
    echo "  ⚠ couldn't copy nginx config (need sudo?) — skipping nginx reload"
    SKIP_NGINX=1
  fi
  # Test + reload
  if [ -z "${SKIP_NGINX:-}" ]; then
    if nginx -t 2>&1 | grep -q "successful"; then
      sudo systemctl reload nginx 2>/dev/null || systemctl reload nginx 2>/dev/null || \
        nginx -s reload 2>/dev/null
      echo "  ✓ nginx config valid + reloaded"
    else
      echo "  ✗ nginx config test FAILED — rolling back"
      cp "$NGINX_CONF.bak."* "$NGINX_CONF" 2>/dev/null
      nginx -t
      exit 1
    fi
  fi
fi
echo ""

# ─── Final: probe to verify fix ────────────────────────────────────
echo "============================================================"
echo "  Verifying fix end-to-end..."
echo "============================================================"

echo ""
echo "[probe 1] HTTP HEAD /lsp (no slash) — should NOT 301 if nginx updated:"
curl -sS -I --max-time 5 "https://localhost/lsp?workspace=test" 2>&1 | head -3 || \
curl -sS -I --max-time 5 "http://localhost:3700/lsp?workspace=test" 2>&1 | head -3

echo ""
echo "[probe 2] WS upgrade on /lsp/ (with slash) — should succeed:"
# Use the test script
if [ -f /home/z/my-project/scripts/test-lsp-ws-fix.ts ]; then
  bun /home/z/my-project/scripts/test-lsp-ws-fix.ts 2>&1 | tail -10
else
  echo "  (test script not present — skipping)"
fi

echo ""
echo "============================================================"
echo "  ✓ Deploy complete"
echo "============================================================"
echo ""
echo "If you still see 301 errors in the browser:"
echo "  1. Hard-refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)"
echo "  2. Open DevTools → Application → Service Workers → Unregister"
echo "  3. Reload the page"
echo ""
echo "The new SW (soroban-build-v2-2026-08-16) will auto-activate on next load"
echo "and purge all cached chunks from the old build."
