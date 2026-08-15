const bm2Config = {
  apps: [
    {
      name: "stellarforge",
      script: "bun",
      args: "--bun next start -p 3700",
      "env": {
        "NODE_ENV": "production",
        "DATABASE_URL": "",
        "DIRECT_DATABASE_URL": ""
      }
    },
    {
      name: "stellarforge-collab",
      script: "mini-services/collab-server/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
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
