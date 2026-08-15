
const NEXT_PUBLIC_APP_URL = "https://stellarforge.app";
const DB_URL = ""

const bm2Config = {
  apps: [
    {
      name: "stellarforge",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "-p 3700",
      interpreter: "bun",
      interpreter_args: "--bun",
      env: {
        DATABASE_URL: DB_URL,
        DIRECT_DATABASE_URL: DB_URL,
        NEXT_PUBLIC_APP_URL,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
    },
    {
      name: "stellarforge-collab",
      script: "mini-services/collab-server/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL
      },
      max_memory_restart: "1G",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      time: true,
    },

    // ─── LSP Server (port 3099) ─────────────────────────────
    // WebSocket server wrapping rust-analyzer for Monaco editor.
    // Provides go-to-definition, hover, autocomplete, diagnostics.
    {
      name: "stellarforge-lsp",
      script: "mini-services/lsp-server/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL
      },
      max_memory_restart: "1G",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      merge_logs: true,
      time: true,
    },
  ]
}


export default bm2Config;
