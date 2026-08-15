# StellarForge

> Agentic, browser-based IDE for Soroban smart contract development.
> The Soroban equivalent of Remix IDE for Ethereum — but better: fully agentic, realtime collaborative, local-first, PWA-installable, and polished to a standard that exceeds VS Code's web experience.

This is the **M1 Foundation + M2 IDE shell** deliverable — a working vertical slice demonstrating the design system, theme engine, IDE layout, Monaco editor with Soroban syntax, file explorer, terminal, command palette, settings, mobile responsive layout, and PWA shell.

---

## Status — what's working now

### M1 — Foundation ✅
- **Design system** (§4): token-based, both dark & light, no gradients/neons. Custom scrollbars, focus rings, hairline borders, restrained accent.
- **Theme engine** (§4.1): 10 built-in themes (Midnight, Daybreak, Slate, Frost, Parchment, Ember, Forest, Harbor, Mono, Contrast). JSON theme definitions drive CSS variables + Monaco themes + xterm themes — all in sync. Theme switcher with visual theme cards.
- **PWA shell** (§8): `manifest.webmanifest`, service worker with app-shell caching, standalone display mode, theme-color.
- **Environment contract** (§15.3): typed config module with zod validation, fail-fast on missing vars. `.env.example` documents every variable.
- **Database schema** (§2): Prisma schema with User, Profile, Project, File, Comment, CollabSession, SharePermission, AuditLog — Postgres-compatible.

### M2 — IDE core ✅ (partial)
- **Monaco Editor** with custom Rust/Soroban language: tokenizer, keywords, snippets (`#[contract]`, `#[contractimpl]`, env.storage patterns), hover docs.
- **File Explorer**: tree view, file-type icons (Rust/TOML/TS/JSON/MD), context menu (new file/folder, rename, delete), git-status badges.
- **Terminal panel**: collapsible, multiple tabs, command history (↑/↓), simulated PTY responses for `cargo build/test`, `stellar contract build`, etc. "Fix with AI" button on errors.
- **Command Palette** (⌘K): all theme switches, file ops, view toggles.
- **Settings dialog**: theme picker with visual cards, font size, autosave, format-on-save, keybindings cheatsheet, BYOK AI providers, sync & offline config.
- **Mobile responsive** (§3.1): bottom tab nav (Files / Editor / Terminal / Agent), full-screen panels on mobile.
- **Sample Soroban contract** pre-loaded: a hello-world contract demonstrating the typical Soroban structure.

---

## Tech stack
- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Editor**: Monaco Editor via `@monaco-editor/react`
- **Styling**: Tailwind CSS 4 + custom design system (no off-the-shelf UI kit look)
- **State**: Zustand (client state) + TanStack Query (server state)
- **Database**: Prisma ORM + PostgreSQL (Neon)
- **Realtime**: WebSocket via socket.io (mini-service, to be wired)
- **PWA**: manifest + service worker

---

## Local development

```bash
# 1. Install deps
bun install

# 2. Copy env and fill in values
cp .env.example .env

# 3. Push database schema
bun run db:push

# 4. Start dev server
bun run dev
# → http://localhost:3000 lands directly in the IDE
```

---

## Project structure

```
src/
├── app/
│   ├── layout.tsx           # Root layout: fonts, theme init script, ThemeProvider
│   ├── page.tsx             # Mounts <IdeShell/> — homepage IS the IDE
│   └── globals.css          # Design tokens + 10 themes via [data-theme="..."]
├── components/
│   ├── ide/
│   │   ├── ide-shell.tsx        # Top-level layout: TopBar, panels, StatusBar
│   │   ├── theme-provider.tsx   # Applies tokens to CSS vars, syncs Monaco
│   │   ├── topbar/
│   │   │   ├── activity-bar.tsx # Left icon rail (Explorer/Search/Git/Deploy/Agent/Collab/Settings)
│   │   │   └── top-bar.tsx      # Logo + project + branch + collab avatars + network + share + deploy + wallet
│   │   ├── explorer/
│   │   │   └── file-explorer.tsx  # Tree view, context menu, git badges
│   │   ├── editor/
│   │   │   ├── monaco-editor.tsx  # Monaco wrapper, theme-aware
│   │   │   ├── editor-area.tsx    # Tab bar + editor
│   │   │   └── use-monaco.ts      # Soroban language registration
│   │   ├── terminal/
│   │   │   └── terminal-panel.tsx  # Multi-tab, command history, simulated PTY
│   │   └── panels/
│   │       ├── right-panel.tsx     # Agent / Compile / Test / Deploy / Git views
│   │       ├── status-bar.tsx      # Branch, sync, errors, toolchain, network, cursor
│   │       ├── command-palette.tsx # ⌘K palette with all actions + theme switches
│   │       └── settings-dialog.tsx # 6 sections: Appearance/Editor/AI/Keybindings/Notifications/Sync
│   └── ui/                  # shadcn/ui primitives (Button, Dialog, etc.)
├── lib/
│   ├── config.ts            # Typed env config with zod validation
│   ├── themes/
│   │   ├── types.ts         # ThemeDefinition + ThemeTokens
│   │   ├── registry.ts      # 10 built-in themes
│   │   ├── mappers.ts       # buildMonacoTheme() + buildXtermTheme()
│   │   └── builtins/        # One file per theme
│   └── soroban/
│       └── sample-project.ts  # Initial file tree + sample Soroban contract
├── stores/
│   ├── theme-store.ts         # Zustand + persist: themeId, fontSize, customThemes
│   ├── file-system-store.ts   # Tree, active file, CRUD ops
│   └── editor-tabs-store.ts   # Open tabs, dirty state, reorder
└── prisma/
    └── schema.prisma          # User, Profile, Project, File, Comment, etc.
```

---

## Roadmap — what's next

The full build prompt (§1–§15) defines 7 milestones. M1 + M2 are largely complete. Remaining work:

- **M3 — Remix parity**: real `soroban contract build`/`deploy` execution (requires Docker container with Rust toolchain — see `scripts/setup.sh`), spec-driven invoke UI generation, tx log.
- **M4 — Collab & comments**: Yjs + y-monaco CRDT editing, presence, line attribution, file-level comments with all §6 features (draggable panel, priorities, resolve/delete), §5.4 hardening rules.
- **M5 — AI agent**: knowledge prefetch, BYOK providers (12 listed in §9.2), proxy passthrough, diff approval flow, prompt caching, "Fix with AI" wiring.
- **M6 — Templates & identity**: stellar-appkit wallet connect, profile flow with unique username check, template gallery (soroban-examples + 5 OZ wizard templates) each with adapter-stellar React UI.
- **M7 — Polish**: local-first sync hardening (IndexedDB via Dexie), loading-state audit, a11y pass, Playwright E2E suite, performance budget.

---

## Git workflow (§1)

Per the build prompt: every meaningful change is committed and pushed to `https://github.com/SagantaHQ/soroban.build` as author `ra-sun-god`. **Note**: the GitHub token was redacted in the source brief — fill in `GIT_PUSH_TOKEN` in `.env` to enable push.

---

## References
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [Stellar docs](https://developers.stellar.org/docs/build)
- [Soroban examples](https://github.com/stellar/soroban-examples)
- [OpenZeppelin Stellar skills](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/skills/setup-stellar-contracts/SKILL.md)
- [OpenZeppelin adapter-stellar](https://github.com/OpenZeppelin/openzeppelin-adapters/tree/main/packages/adapter-stellar)
- [SagantaHQ stellar-appkit](https://github.com/SagantaHQ/stellar-appkit)
