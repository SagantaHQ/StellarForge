#!/usr/bin/env bash
#
# StellarForge — Setup Script (§7)
#
# Installs the latest versions of:
#   1. Rust (via rustup, stable toolchain, plus wasm32v1-none target)
#   2. Stellar CLI (via cargo install --locked stellar-cli)
#   3. Supporting tooling: wasm-opt/binaryen, jq, build essentials, Node LTS, pnpm/bun
#
# This script is idempotent — safe to re-run. Used in:
#   - Local development setup
#   - Docker image build (Dockerfile RUN step)
#   - CI pipeline (GitHub Actions)
#
set -euo pipefail

echo "============================================================"
echo "  StellarForge — Toolchain Setup"
echo "============================================================"
echo ""

# ------------------------------------------------------------
# 0. Detect platform
# ------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
echo "OS: $OS ($ARCH)"

if [ "$OS" != "Linux" ] && [ "$OS" != "Darwin" ]; then
  echo "⚠️  Unsupported OS: $OS. This script supports Linux and macOS."
  exit 1
fi

# ------------------------------------------------------------
# 1. Rust (stable + wasm32v1-none target)
# ------------------------------------------------------------
echo ""
echo "📦 Installing Rust (stable + wasm32v1-none target)..."

if command -v rustc &>/dev/null; then
  echo "   ✓ Rust already installed: $(rustc --version)"
else
  echo "   Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
  source "${HOME}/.cargo/env"
  echo "   ✓ Rust installed: $(rustc --version)"
fi

# Add wasm32v1-none target (required for Soroban smart contracts)
echo "   Adding wasm32v1-none target..."
rustup target add wasm32v1-none
echo "   ✓ wasm32v1-none target installed"

# ------------------------------------------------------------
# 2. Stellar CLI (latest)
# ------------------------------------------------------------
echo ""
echo "📦 Installing Stellar CLI (latest)..."

if command -v stellar &>/dev/null; then
  echo "   ✓ Stellar CLI already installed: $(stellar --version 2>&1 | head -1)"
else
  echo "   Installing via cargo (this takes ~5-10 minutes for the full build)..."
  cargo install --locked stellar-cli
  echo "   ✓ Stellar CLI installed: $(stellar --version 2>&1 | head -1)"
fi

# ------------------------------------------------------------
# 3. Supporting tooling
# ------------------------------------------------------------
echo ""
echo "📦 Installing supporting tooling..."

# wasm-opt / binaryen (WASM optimizer — reduces contract size)
if ! command -v wasm-opt &>/dev/null; then
  echo "   Installing binaryen (wasm-opt)..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq binaryen
  elif command -v brew &>/dev/null; then
    brew install binaryen
  fi
  echo "   ✓ wasm-opt installed"
else
  echo "   ✓ wasm-opt already installed"
fi

# jq (JSON processor — used by scripts)
if ! command -v jq &>/dev/null; then
  echo "   Installing jq..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y -qq jq
  elif command -v brew &>/dev/null; then
    brew install jq
  fi
  echo "   ✓ jq installed"
else
  echo "   ✓ jq already installed"
fi

# build-essential (gcc, make — needed by some Rust crates)
if command -v apt-get &>/dev/null; then
  if ! dpkg -s build-essential &>/dev/null; then
    echo "   Installing build-essential..."
    sudo apt-get install -y -qq build-essential
    echo "   ✓ build-essential installed"
  else
    echo "   ✓ build-essential already installed"
  fi
fi

# ------------------------------------------------------------
# 4. Node.js + pnpm/bun
# ------------------------------------------------------------
echo ""
echo "📦 Checking Node.js..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  echo "   ✓ Node.js installed: $NODE_VERSION"
else
  echo "   ⚠️  Node.js not found. Install Node.js LTS from https://nodejs.org/"
  echo "      Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts"
fi

# bun (faster than npm/pnpm for Next.js dev)
if ! command -v bun &>/dev/null; then
  echo "   Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  echo "   ✓ bun installed: $(bun --version)"
else
  echo "   ✓ bun already installed: $(bun --version)"
fi

# ------------------------------------------------------------
# 5. Verify
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Toolchain Verification"
echo "============================================================"

echo ""
printf "  %-20s %s\n" "rustc:" "$(rustc --version 2>/dev/null || echo 'NOT FOUND')"
printf "  %-20s %s\n" "cargo:" "$(cargo --version 2>/dev/null || echo 'NOT FOUND')"
printf "  %-20s %s\n" "stellar:" "$(stellar --version 2>/dev/null | head -1 || echo 'NOT FOUND')"
printf "  %-20s %s\n" "wasm-opt:" "$(wasm-opt --version 2>/dev/null || echo 'NOT FOUND')"
printf "  %-20s %s\n" "node:" "$(node --version 2>/dev/null || echo 'NOT FOUND')"
printf "  %-20s %s\n" "bun:" "$(bun --version 2>/dev/null || echo 'NOT FOUND')"
printf "  %-20s %s\n" "jq:" "$(jq --version 2>/dev/null || echo 'NOT FOUND')"

echo ""
echo "  wasm32v1-none target:"
rustup target list --installed 2>/dev/null | grep wasm32v1-none && echo "    ✓ Installed" || echo "    ✗ NOT FOUND"

echo ""
echo "============================================================"
echo "  ✓ Setup complete!"
echo "============================================================"
echo ""
echo "  Next steps:"
echo "    1. Copy .env.example to .env and fill in values"
echo "    2. Run: bun run db:push  (set up database)"
echo "    3. Run: bun run dev      (start dev server)"
echo ""
