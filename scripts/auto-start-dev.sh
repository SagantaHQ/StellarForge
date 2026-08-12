#!/usr/bin/env bash
# Auto-start the Soroban dev server when a new shell opens.
# This survives sandbox resets because every new shell sources ~/.bashrc,
# which sources this script.
#
# IMPORTANT: We run the dev server DIRECTLY via nohup — NOT via pm2.
# pm2's auto-restart + Next.js HMR were fighting each other, causing
# reload loops. Next.js dev server has its own HMR (Hot Module
# Replacement) which is sufficient — we don't need an external process
# manager auto-restarting it.
#
# Idempotent: if the dev server is already running, does nothing.
# Also reinstalls stellar-cli + Rust if missing (sandbox resets wipe them).

# 1. Make sure tools are on PATH
export PATH="/home/z/.local/bin:/home/z/.npm-global/bin:/home/z/.cargo/bin:$PATH"

# 2. If stellar-cli is missing, reinstall it from GitHub releases (prebuilt binary)
if ! command -v stellar >/dev/null 2>&1; then
  echo "[auto-start] stellar-cli missing — reinstalling v27.1.0..."
  mkdir -p /home/z/.local/bin
  TMPDIR=$(mktemp -d)
  if curl -sSL -o "$TMPDIR/stellar.tar.gz" \
    "https://github.com/stellar/stellar-cli/releases/download/v27.1.0/stellar-cli-27.1.0-x86_64-unknown-linux-gnu.tar.gz" \
    >/dev/null 2>&1; then
    tar -xzf "$TMPDIR/stellar.tar.gz" -C "$TMPDIR" >/dev/null 2>&1
    if [ -f "$TMPDIR/stellar" ]; then
      cp "$TMPDIR/stellar" /home/z/.local/bin/stellar
      chmod +x /home/z/.local/bin/stellar
      echo "[auto-start] stellar-cli v27.1.0 installed"
    fi
  fi
  rm -rf "$TMPDIR"
fi

# 3. If Rust/cargo is missing, reinstall it (needed for stellar contract build)
if ! command -v cargo >/dev/null 2>&1; then
  echo "[auto-start] Rust missing — reinstalling..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal >/dev/null 2>&1
  . "$HOME/.cargo/env"
  rustup target add wasm32v1-none >/dev/null 2>&1
  echo "[auto-start] Rust + wasm32 target installed"
fi

# 4. Kill any pm2 daemon that might be running (we don't use pm2 anymore)
if command -v pm2 >/dev/null 2>&1; then
  pm2 kill >/dev/null 2>&1 || true
fi

# 5. Check if the dev server is already running (via PID file)
PID_FILE="/home/z/my-project/.zscripts/dev.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    # Dev server is already running — nothing to do
    return 0 2>/dev/null || exit 0
  fi
  rm -f "$PID_FILE"
fi

# 6. Start the dev server directly via nohup (no pm2, no auto-restart)
echo "[auto-start] starting dev server..."
bash /home/z/my-project/scripts/start-dev.sh --bg >/dev/null 2>&1
