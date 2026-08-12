#!/usr/bin/env bash
# Auto-start the Soroban dev server via pm2 when a new shell opens.
# This survives sandbox resets because every new shell sources ~/.bashrc,
# which sources this script.
#
# Idempotent: if pm2 + soroban-build-dev are already running, does nothing.

# 1. Make sure pm2 is on PATH (it's installed in ~/.npm-global/bin)
export PATH="/home/z/.npm-global/bin:/home/z/.local/bin:$PATH"

# 2. If pm2 binary is missing, reinstall it (sandbox resets wipe global npm packages)
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[auto-start] pm2 missing — reinstalling..."
  npm install -g pm2 >/dev/null 2>&1
fi

# 3. If pm2 STILL missing, give up silently (no internet, etc.)
if ! command -v pm2 >/dev/null 2>&1; then
  return 0 2>/dev/null || exit 0
fi

# 4. If pm2 daemon isn't running, start it (this also revives saved processes)
if ! pm2 jlist >/dev/null 2>&1; then
  pm2 resurrect >/dev/null 2>&1
fi

# 5. Check if soroban-build-dev is running. If not, start it.
PM2_LIST="$(pm2 jlist 2>/dev/null || echo '[]')"
if ! echo "$PM2_LIST" | grep -q '"soroban-build-dev"' 2>/dev/null; then
  echo "[auto-start] starting soroban-build-dev..."
  pm2 start /home/z/my-project/ecosystem.config.cjs >/dev/null 2>&1
fi

# 6. Save the process list so `pm2 resurrect` can restore it after future resets
pm2 save >/dev/null 2>&1
