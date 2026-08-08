#!/bin/bash
# scripts/install-server-tools.sh
#
# Comprehensive installer for all server-side tools needed by Soroban.Build.
#
# Installs:
#   1. Rust toolchain (latest stable) via rustup
#   2. wasm32v1-none target (required for Soroban contract compilation)
#   3. rust-analyzer (LSP server for IDE autocomplete)
#   4. stellar-cli (via cargo install — the canonical Rust way)
#   5. Shell autocompletion for bash, zsh, fish (via 'stellar completion')
#   6. ~/.bashrc configuration (PATH, completion sourcing, aliases)
#
# Prerequisites: curl, bash
# Tested on: Ubuntu/Debian Linux (x86_64)
#
# Usage:
#   bash scripts/install-server-tools.sh
#
# After running, restart your shell or run: source ~/.bashrc
#
# NON-NEGOTIABLE: This script is idempotent — safe to re-run.

set -euo pipefail

export HOME="${HOME:-/home/z}"
STELLAR_VERSION="27.1.0"
RUST_TOOLCHAIN="stable"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()    { echo -e "${BLUE}▶ $1${NC}"; }
ok()     { echo -e "${GREEN}  ✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail()   { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Soroban.Build — Server Tools Installer                          ║"
echo "║                                                                  ║"
echo "║  • Rust toolchain (latest stable)                                ║"
echo "║  • wasm32v1-none target (Soroban contracts)                      ║"
echo "║  • rust-analyzer (LSP for IDE autocomplete)                      ║"
echo "║  • stellar-cli v${STELLAR_VERSION} (via cargo install)                       ║"
echo "║  • Shell autocompletion (bash + zsh + fish)                      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 1: Rust toolchain (rustup + rustc + cargo)
# ────────────────────────────────────────────────────────────────────
log "Step 1/6: Rust toolchain (latest stable)"

# Check if rustup is already installed
if [ -f "$HOME/.cargo/bin/rustup" ]; then
  source "$HOME/.cargo/env" 2>/dev/null || true
  ok "rustup already installed: $(rustup --version 2>&1 | head -1)"
else
  echo "  → Installing rustup + $RUST_TOOLCHAIN toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain "$RUST_TOOLCHAIN" --profile minimal
  ok "rustup installed"
fi

# Source cargo env so rustc/cargo are on PATH for the rest of the script
source "$HOME/.cargo/env" 2>/dev/null || true

# Verify
RUSTC_VER=$(rustc --version 2>&1) || fail "rustc not found after install"
CARGO_VER=$(cargo --version 2>&1) || fail "cargo not found after install"
ok "$RUSTC_VER"
ok "$CARGO_VER"
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 2: wasm32v1-none target
# ────────────────────────────────────────────────────────────────────
log "Step 2/6: wasm32v1-none target (Soroban contract compilation)"

if rustup target list --installed 2>/dev/null | grep -q "wasm32v1-none"; then
  ok "wasm32v1-none target already installed"
else
  echo "  → Adding wasm32v1-none target..."
  rustup target add wasm32v1-none
  ok "wasm32v1-none target installed"
fi
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 3: rust-analyzer (LSP server for IDE autocomplete)
# ────────────────────────────────────────────────────────────────────
log "Step 3/6: rust-analyzer (LSP server for IDE autocomplete)"

if rustup component list --installed 2>/dev/null | grep -q "rust-analyzer"; then
  RA_VER=$(rust-analyzer --version 2>&1 | head -1)
  ok "rust-analyzer already installed: $RA_VER"
else
  echo "  → Installing rust-analyzer component..."
  rustup component add rust-analyzer
  ok "rust-analyzer installed: $(rust-analyzer --version 2>&1 | head -1)"
fi
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 4: stellar-cli (via cargo install)
# ────────────────────────────────────────────────────────────────────
log "Step 4/6: stellar-cli v${STELLAR_VERSION} (via cargo install)"

# Check if stellar is already installed at the right version
if command -v stellar &>/dev/null && stellar --version 2>&1 | grep -q "$STELLAR_VERSION"; then
  ok "stellar-cli $STELLAR_VERSION already installed: $(stellar --version 2>&1 | head -1)"
else
  echo "  → Installing stellar-cli v$STELLAR_VERSION via cargo..."
  echo "    (this compiles from source — may take 5-15 minutes)"
  echo ""

  # Try cargo install first (the canonical way)
  if cargo install --locked stellar-cli 2>&1; then
    ok "stellar-cli installed via cargo: $(stellar --version 2>&1 | head -1)"
  else
    warn "cargo install failed (likely OOM) — falling back to pre-built binary"
    echo "  → Downloading pre-built binary from GitHub releases..."

    PLATFORM="x86_64-unknown-linux-gnu"
    URL="https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_VERSION}/stellar-cli-${STELLAR_VERSION}-${PLATFORM}.tar.gz"

    curl -fsSL -o /tmp/stellar-cli.tar.gz "$URL" || fail "Failed to download stellar-cli"
    tar -xzf /tmp/stellar-cli.tar.gz -C /tmp/ || fail "Failed to extract stellar-cli"
    mkdir -p "$HOME/.cargo/bin"
    cp /tmp/stellar "$HOME/.cargo/bin/stellar"
    chmod +x "$HOME/.cargo/bin/stellar"
    rm -f /tmp/stellar-cli.tar.gz /tmp/stellar

    ok "stellar-cli installed (pre-built binary): $(stellar --version 2>&1 | head -1)"
  fi
fi
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 5: Shell autocompletion (bash + zsh + fish)
# ────────────────────────────────────────────────────────────────────
log "Step 5/6: Shell autocompletion (bash + zsh + fish)"

echo "  → Generating completion scripts via 'stellar completion --shell <shell>'..."

# Bash
mkdir -p "$HOME/.bash_completion.d"
stellar completion --shell bash > "$HOME/.bash_completion.d/stellar" 2>/dev/null
ok "bash completion: $(wc -l < "$HOME/.bash_completion.d/stellar") lines → ~/.bash_completion.d/stellar"

# Zsh
mkdir -p "$HOME/.zsh/completion"
stellar completion --shell zsh > "$HOME/.zsh/completion/_stellar" 2>/dev/null
ok "zsh completion: $(wc -l < "$HOME/.zsh/completion/_stellar") lines → ~/.zsh/completion/_stellar"

# Fish
mkdir -p "$HOME/.config/fish/completions"
stellar completion --shell fish > "$HOME/.config/fish/completions/stellar.fish" 2>/dev/null
ok "fish completion: $(wc -l < "$HOME/.config/fish/completions/stellar.fish") lines → ~/.config/fish/completions/stellar.fish"
echo ""

# ────────────────────────────────────────────────────────────────────
# Step 6: Configure ~/.bashrc
# ────────────────────────────────────────────────────────────────────
log "Step 6/6: Configure ~/.bashrc (PATH + completion + aliases)"

BASHRC_MARKER="# ── Stellar CLI ──"

if [ -f "$HOME/.bashrc" ] && grep -q "$BASHRC_MARKER" "$HOME/.bashrc"; then
  ok "~/.bashrc already configured for stellar completion"
else
  cat >> "$HOME/.bashrc" << 'BASHRC_CONFIG'

# ── Stellar CLI ──
# Shell autocompletion (generated by: stellar completion --shell bash)
if [ -f "$HOME/.bash_completion.d/stellar" ]; then
    source "$HOME/.bash_completion.d/stellar"
fi

# Cargo / Rust bin (stellar-cli + rust-analyzer are installed here)
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"

# Local bin
export PATH="$HOME/.local/bin:$PATH"

# Aliases for common stellar commands
alias sc="stellar contract"
alias sb="stellar contract build"
alias sd="stellar contract deploy"
alias si="stellar contract inspect"
alias sf="stellar contract fetch"
# ── End Stellar CLI ──
BASHRC_CONFIG
  ok "Added stellar completion + PATH + aliases to ~/.bashrc"
fi
echo ""

# ────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ✓ All server tools installed!                                   ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║                                                                  ║"
echo -e "║  ${GREEN}Installed:${NC}                                                        ║"
echo -e "║    • rustc $(rustc --version 2>&1 | sed 's/rustc //')${NC}                          ║"
echo -e "║    • cargo $(cargo --version 2>&1 | sed 's/cargo //')${NC}                          ║"
echo -e "║    • rust-analyzer $(rust-analyzer --version 2>&1 | head -1 | sed 's/rust-analyzer //')${NC}          ║"
echo -e "║    • stellar-cli $(stellar --version 2>&1 | head -1 | sed 's/stellar //')${NC}                  ║"
echo "║    • wasm32v1-none target                                        ║"
echo "║    • Shell completion: bash + zsh + fish                         ║"
echo "║                                                                  ║"
echo "║  Next steps:                                                     ║"
echo "║    1. Activate in current shell: source ~/.bashrc                ║"
echo "║    2. Test completion: stellar <TAB>                             ║"
echo "║    3. Start dev servers: bash scripts/start-dev.sh               ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
