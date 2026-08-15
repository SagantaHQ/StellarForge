# StellarForge

> Agentic, browser-based IDE for Soroban smart contract development.
> Build, test, deploy, and collaborate on Stellar smart contracts — without leaving your browser.

StellarForge is a full-featured web IDE for developing Soroban smart contracts on the Stellar network. It combines a Monaco-based code editor with Rust/Soroban syntax highlighting, real `stellar contract build` compilation, wallet-based contract deployment, an AI agent for code fixes, and live collaboration — all in the browser.

---

## Features

### IDE Core
- **Monaco Editor** with custom Rust/Soroban language tokenizer, keywords, snippets (`#[contract]`, `#[contractimpl]`, `env.storage()` patterns), and hover docs
- **File Explorer** with tree view, context menu (new file/folder, rename, delete), and git-status badges
- **Build Output Panel** with streaming `stellar contract build` output, "Fix with AI" button on errors
- **Command Palette** (⌘K) for all actions: theme switches, file ops, view toggles, deploy
- **Settings Dialog** with 6 sections: Appearance, Editor, AI Provider, Keybindings, Notifications, Sync
- **10 built-in themes** (Midnight, Daybreak, Slate, Frost, Parchment, Ember, Forest, Harbor, Mono, Contrast) — drives CSS vars + Monaco themes + xterm themes in sync
- **PWA-installable** with service worker + standalone display mode
- **Mobile responsive** — bottom tab nav (Files / Editor / Terminal / Agent) on mobile

### Build & Deploy
- **Real compilation** — `stellar contract build` runs server-side in a pseudo-TTY for streaming output
- **Auto-build on deploy** — if the project isn't built, it builds automatically before deploying
- **Two-phase deploy** via stellar-appkit wallet signing:
  1. Phase A: `uploadContractWasm` → wallet signs → WASM installed on-chain
  2. Phase B: `createCustomContract` (new) or `updateContractWasm` (upgrade) → wallet signs → contract live
- **Upgrade confirmation modal** — warns before redeploying an already-deployed contract
- **Remix-style contract interaction** — after deploy, shows all public functions with:
  - Auto-generated forms based on the contract spec (parsed from Rust source)
  - `read` badge for view functions, `write` badge for state-modifying functions
  - **Query** button (read-only simulation, free, no transaction)
  - **Transact** button (write, requires wallet signing)
- **Explorer links** — [stellarchain.io](https://stellarchain.io) integration (testnet/mainnet/futurenet)
- **Contract ID extraction** — walks the SDK's `GetTransactionResponse` to extract the contract ID from `returnValue`, `resultMetaXdr`, and `resultXdr`

### AI Agent
- **12 BYOK providers**: OpenAI, Anthropic (proxied), Gemini, DeepSeek, Kimi, OpenRouter, Bedrock (proxied), Cloudflare, Z-AI, Ollama, custom-OpenAI, and generic
- **Intelligent diff parser** — extracts GitHub-style unified diffs from LLM responses:
  - Tries `parsePatch()` on every fenced code block, fuzzy-delimiter section, and raw text
  - **`fixHunkLineCounts()`** — rewrites `@@` headers to match actual body line counts (LLMs are terrible at counting lines — this is the #1 fix for "Accept button not showing")
  - Merges multiple diff blocks for the same file into one approval card
  - Handles CRLF, missing closing fences, wrong fence language tags, and custom delimiters
- **Accept/Reject flow** — each proposed diff shows as a card with Accept (applies to file) or Reject
- **Attribution** — AI edits are logged in the audit trail as "{user} via AI agent ({provider}/{model})"
- **"Fix with AI"** button in the build output panel — sends the build error + file contents to the agent

### Collaboration
- **Live collaborative editing** via Yjs CRDT — changes sync in real-time across browsers
- **WebSocket collab server** (port 3002) using the standard y-websocket protocol:
  - `lib0/encoding` + `lib0/decoding` for proper message framing
  - Sync-step1 + sync-step2 on connection (late joiners get existing state)
  - Awareness broadcasting (cursor positions, user presence)
  - Room isolation, 60s grace period before destroying empty rooms
  - Auto-reconnect with 3s backoff
- **BroadcastChannel fallback** — same-browser multi-tab sync without network round-trip
- **Share dialog** — create public links or private invites (by username) with VIEWER or EDITOR roles
- **Comments** — file-level line comments with priority levels (urgent, high, normal, low, suggestion):
  - Draggable comment panel with anchored line previews
  - Resolve/unresolve workflow
  - Auto-re-anchoring when files are edited (±10 line fuzzy match)
  - Per-user attribution with avatar colors derived from wallet address

### LSP (Language Server Protocol)
- **rust-analyzer integration** via WebSocket LSP server (port 3099):
  - Go-to-definition
  - Hover documentation
  - Autocomplete with type inference
  - Diagnostics (errors + warnings inline in the editor)
- **Autocomplete** with 15s TTL cache, per-model request-id tracking (discards stale responses), and structural trigger characters only

### Identity & Auth
- **SIWS (Sign-In With Stellar)** — wallet-based authentication via stellar-appkit SDK
- **Auto-generated usernames** — new users get a unique username; can customize once
- **Profile system** — avatar upload, bio, preferred theme, accent color
- **GitHub OAuth** — connect GitHub account for repo import + commit features

### Templates
- **Real, compilable Soroban contract templates** — not stubs:
  - Hello World, Token, Counter, Custom Types, DAO, Governance, Escrow, Vault, etc.
- Each template ships with full `Cargo.toml`, `src/lib.rs`, `src/test.rs`, `README.md`, `.gitignore`
- Blank project option with minimal starter code
- Import from GitHub repo or ZIP file

### Project Management
- **Local-first** — files stored in IndexedDB, sync to Postgres when logged in
- **Project switcher** in the top bar with quick switch
- **WASM version history** — tracks every deployed version with hash, size, and upgrade count
- **Audit log** — all file changes, comments, deploys, and shares are logged

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Editor | Monaco Editor via `@monaco-editor/react` |
| Styling | Tailwind CSS 4 + custom design system |
| UI primitives | shadcn/ui + Radix UI |
| State | Zustand (client) + TanStack Query (server) |
| Database | Prisma ORM + PostgreSQL (Neon) |
| Realtime | Yjs CRDT + WebSocket (y-websocket protocol) |
| LSP | rust-analyzer via WebSocket (monaco-languageclient) |
| Wallet | `@saganta/stellar-appkit` (Freighter, xBull, Albedo, Ledger) |
| Stellar SDK | `@stellar/stellar-sdk` v16 |
| PWA | manifest + service worker + standalone mode |
| Process manager | BM2 (dev) / BM2 (production) |

---

## Installation

### Prerequisites

- **Node.js** 20+ or **Bun** 1.1+
- **PostgreSQL** (local or [Neon](https://neon.tech) cloud)
- **Rust toolchain** (for building Soroban contracts server-side):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add wasm32v1-none
  ```
- **Stellar CLI** (for contract compilation):
  ```bash
  cargo install --locked stellar-cli
  ```

### Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/SagantaHQ/StellarForge.git
   cd StellarForge
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in:
   - `DATABASE_URL` — PostgreSQL connection string
   - `DIRECT_DATABASE_URL` — direct connection (for Prisma migrations)
   - `SESSION_SECRET` — random 32+ char string
   - `NEXT_PUBLIC_APP_URL` — your app URL (e.g. `http://localhost:3000`)

4. **Push the database schema**
   ```bash
   bun run db:push
   ```

5. **Start the dev server**
   ```bash
   bun run dev
   ```
   → Open `http://localhost:3000`

### Production

1. **Build**
   ```bash
   bun run build
   ```

2. **Start the app** (port 3700)
   ```bash
   bun run start
   ```

3. **Start the side services** (collab + LSP)

   Copy the example BM2 config and fill in your env:
   ```bash
   cp bm2.config.example.ts bm2.config.ts
   # Edit bm2.config.ts — fill in DATABASE_URL, DIRECT_DATABASE_URL
   ```

   Start all services:
   ```bash
   bun run dev:bm2
   # or: bm2 start bm2.config.ts
   ```

   Or start services individually:
   ```bash
   # Collab server (port 3002)
   cd mini-services/collab-server && bun install && cd ../..
   bun mini-services/collab-server/index.ts

   # LSP server (port 3099)
   cd mini-services/lsp-server && bun install && cd ../..
   bun mini-services/lsp-server/index.ts
   ```

4. **Nginx reverse proxy**

   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/stellarforge.app
   sudo ln -s /etc/nginx/sites-available/stellarforge.app /etc/nginx/sites-enabled/
   sudo certbot --nginx -d stellarforge.app -d www.stellarforge.app
   sudo nginx -t && sudo systemctl reload nginx
   ```

   The nginx config handles:
   - HTTP → HTTPS (via certbot)
   - `/` → Next.js app (port 3700)
   - `/api/` → Next.js API routes (no caching, rate-limited)
   - `/collab/` → WebSocket collab server (port 3002, 24h timeout)
   - `/lsp` → WebSocket LSP server (port 3099, 24h timeout)
   - `/workspace/` → LSP workspace files (port 3099)
   - Gzip compression, security headers, rate limiting

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout: fonts, theme init, wallet provider
│   ├── page.tsx                # Mounts <IdeShell/> — homepage IS the IDE
│   ├── api/                    # API routes
│   │   ├── auth/               # SIWS session management
│   │   ├── build/              # stellar contract build (streaming)
│   │   ├── contracts/         # deploy-tx, create-tx, submit, invoke, list
│   │   ├── comments/           # CRUD for file-level comments
│   │   ├── share/              # create, access, list, revoke
│   │   ├── github/             # OAuth, repos, files, commit
│   │   ├── ai-proxy/           # Anthropic + Bedrock CORS passthrough
│   │   └── autocomplete/       # rustdoc index, build-deps
│   └── shared/[token]/page.tsx # Share link receiver
├── components/
│   └── ide/
│       ├── ide-shell.tsx       # Top-level layout (1079 lines — the brain)
│       ├── editor/             # Monaco editor, language registration, LSP
│       ├── explorer/           # File explorer with context menu
│       ├── terminal/           # Multi-tab terminal with simulated PTY
│       ├── panels/             # Agent, Build, Deploy, Inspect, Settings
│       ├── comments/           # Comments panel + inline input
│       ├── collab/             # Share dialog
│       └── topbar/             # Activity bar + top bar
├── lib/
│   ├── ai/
│   │   ├── ai-diff-parser.ts   # Intelligent diff extraction (parsePatch + fixHunkLineCounts)
│   │   ├── context-assembler.ts# System prompt + context assembly for AI
│   │   └── providers.ts        # 12 BYOK provider implementations
│   ├── soroban/                # Spec parser, sample project, security linter
│   ├── wallet/                 # stellar-appkit provider, SIWS bridge
│   ├── themes/                 # 10 theme definitions + mappers
│   └── config.ts               # Typed env config with zod validation
├── stores/                     # Zustand stores (persisted to IndexedDB)
└── prisma/
    └── schema.prisma           # User, Profile, Project, File, Comment, etc.

mini-services/
├── collab-server/              # WebSocket Yjs collab server (port 3002)
└── lsp-server/                 # WebSocket rust-analyzer LSP server (port 3099)

deploy/
└── nginx.conf                  # Nginx reverse proxy config
```

---

## Database Schema

The Prisma schema includes:

| Model | Purpose |
|---|---|
| `User` | Wallet-based identity + GitHub OAuth |
| `Profile` | Username, avatar, bio, theme preferences |
| `Project` | Smart contract projects (owned, shared) |
| `File` | File tree within a project |
| `Comment` | File-level line comments with priority + CRDT anchoring |
| `DeployedContract` | On-chain contract deployments (network, contract ID) |
| `WasmVersion` | Versioned WASM binaries (hash, size, upgrade tracking) |
| `CollabSession` | Active collaboration sessions |
| `SharePermission` | Public links + private invites |
| `AuditLog` | All file/comment/deploy/share actions |

---

## BM2 Configuration

The `bm2.config.example.ts` manages all three services:

| Service | Port | Purpose |
|---|---|---|
| `stellarforge` | 3700 | Next.js app (production) |
| `stellarforge-collab` | 3002 | WebSocket Yjs collaboration server |
| `stellarforge-lsp` | 3099 | WebSocket rust-analyzer LSP server |

```bash
# Start all
bm2 start bm2.config.ts

# Status
bm2 list

# Logs
bm2 logs stellarforge --lines 50
bm2 logs stellarforge-collab --lines 50
bm2 logs stellarforge-lsp --lines 50

# Restart
bm2 restart stellarforge

# Stop
bm2 delete stellarforge
```

---

## License

MIT

## Links

- [Stellar Docs](https://developers.stellar.org/docs/build)
- [Soroban Examples](https://github.com/stellar/soroban-examples)
- [SagantaHQ Stellar AppKit](https://github.com/SagantaHQ/stellar-appkit)
- [stellarchain.io Explorer](https://stellarchain.io)
