/**
 * StellarForge — PM2 Ecosystem Config for Side Services
 *
 * Runs the collab server + LSP server alongside the Next.js app.
 *
 * Usage:
 *   pm2 start ecosystem.services.cjs
 *   pm2 status                    # check all services
 *   pm2 logs stellarforge-collab  # collab server logs
 *   pm2 logs stellarforge-lsp     # LSP server logs
 *   pm2 stop all                  # stop both
 *   pm2 delete all                # remove both from PM2
 *
 * The Next.js app itself should be run separately via:
 *   bun run start   (port 3700)
 *   or via the main bm2.config.json in dev mode
 */

module.exports = {
  apps: [
    // ─── Collab Server (port 3002) ──────────────────────────
    // WebSocket server for cross-device live collaboration.
    // Uses Yjs CRDT sync protocol via y-protocols.
    {
      name: "stellarforge-collab",
      script: "mini-services/collab-server/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "256M",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      out_file: "./logs/collab.out.log",
      error_file: "./logs/collab.err.log",
      merge_logs: true,
      time: true,
    },

    // ─── LSP Server (port 3099) ─────────────────────────────
    // WebSocket server wrapping rust-analyzer for Monaco editor.
    // Provides go-to-definition, hover, autocomplete, diagnostics.
    {
      name: "stellarforge-lsp",
      script: "mini-services/lsp-server/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1G",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      out_file: "./logs/lsp.out.log",
      error_file: "./logs/lsp.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
