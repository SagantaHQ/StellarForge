// PM2 ecosystem config (converted from bm2.config.json)
// bm2 is not installed in this sandbox; pm2 uses the same settings.
module.exports = {
  apps: [
    {
      name: 'soroban-build-dev',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 3000 --webpack',
      cwd: '/home/z/my-project',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        // Increased from 1536 to 2560 MB — the dev server was OOM-crashing
        // at 1.4GB heap, causing pm2 auto-restarts → full page reloads.
        // The sandbox has 4GB RAM; 2.5GB for Node + 1.5GB for OS/stellar/cargo.
        NODE_OPTIONS: '--max-old-space-size=2560',
        HOME: '/home/z',
        PATH: '/home/z/.local/bin:/home/z/.cargo/bin:/home/z/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        // NON-NEGOTIABLE: always PostgreSQL (Neon). Never SQLite.
        DATABASE_URL: 'postgresql://neondb_owner:npg_7AZB1JGmEbsD@ep-fragrant-water-ayoazbf2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
        DIRECT_DATABASE_URL: 'postgresql://neondb_owner:npg_7AZB1JGmEbsD@ep-fragrant-water-ayoazbf2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
        // GitHub token for server-side API calls (commits, PRs, etc.)
      },
      autorestart: true,
      maxRestarts: 100,
      minUptime: 5000,
      restartDelay: 5000,
      // Increased from 2G to 3G — match the new heap limit so pm2 doesn't
      // restart the process before Node's own GC can reclaim memory.
      maxMemoryRestart: '3G',
      killTimeout: 10000,
      watch: false,
      out_file: '/home/z/my-project/.zscripts/bm2-out.log',
      error_file: '/home/z/my-project/.zscripts/bm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
