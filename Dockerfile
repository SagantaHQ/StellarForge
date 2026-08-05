# ============================================================
# Soroban.Build — Multi-stage Dockerfile (§7)
#
# Stages:
#   1. base — common base with Node + system deps
#   2. toolchain — Rust + Stellar CLI (cached layer)
#   3. deps — install Node dependencies
#   4. build — build the Next.js app
#   5. runtime — slim production image
# ============================================================

# --- Stage 1: base ---
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    jq \
    binaryen \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- Stage 2: toolchain (Rust + Stellar CLI) ---
# This layer is expensive (~10 min) but cached — only rebuilt when
# Rust toolchain changes.
FROM base AS toolchain

# Install Rust + wasm32v1-none target
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    --default-toolchain stable \
    --profile minimal \
    --target wasm32v1-none

ENV PATH="/root/.cargo/bin:${PATH}"
ENV CARGO_HOME="/root/.cargo"
ENV RUSTUP_HOME="/root/.rustup"

# Install Stellar CLI (latest)
RUN cargo install --locked stellar-cli

# Verify
RUN rustc --version && cargo --version && stellar --version

# --- Stage 3: deps ---
FROM base AS deps

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install dependencies
RUN npm install --frozen-lockfile || npm install

# --- Stage 4: build ---
FROM deps AS build

COPY . .

# Set build-time env
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build Next.js
RUN npm run build

# --- Stage 5: runtime (slim) ---
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    jq \
    binaryen \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Rust toolchain from toolchain stage (needed for compile/deploy)
COPY --from=toolchain /root/.cargo /root/.cargo
COPY --from=toolchain /root/.rustup /root/.rustup
ENV PATH="/root/.cargo/bin:${PATH}"
ENV CARGO_HOME="/root/.cargo"
ENV RUSTUP_HOME="/root/.rustup"

# Copy built Next.js app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules

# Copy setup script + knowledge directory
COPY scripts ./scripts
COPY knowledge ./knowledge

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
