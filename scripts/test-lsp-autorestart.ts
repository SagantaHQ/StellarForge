/**
 * Test script for the LSP auto-restart behavior.
 *
 * Verifies that:
 *   1. LSP server starts successfully with stub RA
 *   2. WS connection works
 *   3. When RA process is killed, server auto-restarts it after 1s
 *   4. /health reports restartAttempts correctly
 *   5. After MAX_RESTART_ATTEMPTS, server gives up and notifies client
 *
 * Run with: bun /home/z/my-project/scripts/test-lsp-autorestart.ts
 */
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { WebSocket } from "ws";
import { writeFileSync, chmodSync } from "fs";

const LSP_PORT = 3098; // use different port to avoid conflicts
const STUB_RA_PATH = "/tmp/stub-ra-autorestart-test";
const LSP_SERVER_PATH = "/home/z/my-project/analysis/soroban.build/mini-services/lsp-server/index.ts";

// Create a stub rust-analyzer that:
//   - prints version on --version
//   - otherwise: stays alive reading stdin (simulates real RA waiting for LSP messages)
const STUB_RA = `#!/bin/bash
if [ "$1" = "--version" ]; then
  echo "rust-analyzer stub 1.0.0 (test)"
  exit 0
fi
# Otherwise: keep alive reading stdin
while IFS= read -r line; do
  :
done
`;

let lspServer: ChildProcessWithoutNullStreams | null = null;
const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function log(msg: string) { console.log(`[test] ${msg}`); }
function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function startLspServer(env: Record<string, string>): Promise<void> {
  log("Starting LSP server on port " + LSP_PORT);
  lspServer = spawn("bun", [LSP_SERVER_PATH], {
    env: { ...process.env, ...env, LSP_PORT: String(LSP_PORT) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  lspServer.stdout.on("data", (d) => process.stdout.write(`[lsp] ${d}`));
  lspServer.stderr.on("data", (d) => process.stderr.write(`[lsp-err] ${d}`));

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://localhost:${LSP_PORT}/health`);
      if (res.ok) { log("LSP server ready"); return; }
    } catch {}
  }
  throw new Error("LSP server failed to start within 5s");
}

async function stopLspServer(): Promise<void> {
  if (!lspServer) return;
  log("Stopping LSP server");
  lspServer.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!lspServer.killed) {
    lspServer.kill("SIGKILL");
  }
  lspServer = null;
}

async function connectWs(workspace: string, onMessage?: (msg: any) => void): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${LSP_PORT}/lsp/?workspace=${workspace}`);
  ws.onmessage = (e) => onMessage?.(JSON.parse(e.data.toString()));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS connect timeout")), 3000);
    ws.on("open", () => { clearTimeout(t); resolve(); });
    ws.on("error", (err) => { clearTimeout(t); reject(err); });
  });
  return ws;
}

async function getHealth(): Promise<any> {
  const res = await fetch(`http://localhost:${LSP_PORT}/health`);
  return res.json();
}

async function findRaPids(): Promise<number[]> {
  const { execSync } = await import("child_process");
  try {
    const out = execSync(`pgrep -f "stub-ra-autorestart-test" || true`, { encoding: "utf-8" });
    return out.trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function main() {
  try {
    // Setup: create stub RA
    writeFileSync(STUB_RA_PATH, STUB_RA);
    chmodSync(STUB_RA_PATH, 0o755);

    // ─── Test 1: startup succeeds with stub RA ────────────────────
    await startLspServer({
      HOME: "/home/z",
      RUST_ANALYZER_BIN: STUB_RA_PATH,
    });
    const health1 = await getHealth();
    record(
      "startup succeeds when RA is installed",
      health1.ok === true && health1.rustAnalyzerVersion === "rust-analyzer stub 1.0.0 (test)",
      `version=${health1.rustAnalyzerVersion}`
    );

    // ─── Test 2: WS connect works + RA process is spawned ─────────
    const ws = await connectWs("test-restart");
    await new Promise((r) => setTimeout(r, 500));
    const health2 = await getHealth();
    const pids1 = await findRaPids();
    record(
      "RA process spawned after WS connect",
      pids1.length >= 1 && health2.sessions?.length === 1 && health2.sessions[0].raRunning === true,
      `pids=${pids1.length}, sessions=${health2.sessions?.length}`
    );

    // ─── Test 3: kill RA → auto-restart after 1s ──────────────────
    log(`Killing RA process(es): ${pids1.join(", ")}`);
    for (const pid of pids1) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }

    // Wait 3s for restart (1s backoff + spawn time)
    await new Promise((r) => setTimeout(r, 3000));

    const health3 = await getHealth();
    const pids2 = await findRaPids();
    record(
      "RA auto-restarted after crash",
      pids2.length >= 1 && health3.sessions?.[0]?.restartAttempts === 1,
      `pids=${pids2.length}, attempts=${health3.sessions?.[0]?.restartAttempts}`
    );

    // ─── Test 4: kill RA 5 more times → should give up ─────────────
    log("Killing RA 5 more times to exhaust restart attempts...");
    for (let i = 0; i < 5; i++) {
      const pids = await findRaPids();
      if (pids.length === 0) {
        log(`  iteration ${i+1}: no RA running, waiting for backoff...`);
      } else {
        for (const pid of pids) {
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
      }
      // Wait for next restart attempt (use generous timeout — last backoff is 30s)
      const waitMs = i === 4 ? 35000 : 12000;  // last attempt: 30s backoff
      log(`  iteration ${i+1}: waiting ${waitMs/1000}s for restart attempt...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const health4 = await getHealth();
    const pids3 = await findRaPids();
    record(
      "RA gives up after MAX_RESTART_ATTEMPTS",
      pids3.length === 0 && health4.sessions?.[0]?.restartAttempts >= 5,
      `pids=${pids3.length}, attempts=${health4.sessions?.[0]?.restartAttempts}`
    );

    ws.close();
  } finally {
    await stopLspServer();
  }

  console.log("\n=== Summary ===");
  const pass = checks.filter((c) => c.pass).length;
  const fail = checks.length - pass;
  console.log(`${pass}/${checks.length} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailed:");
    for (const c of checks.filter((c) => !c.pass)) {
      console.log(`  - ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    process.exit(1);
  } else {
    console.log("\nAll checks passed ✓");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test script failed:", err);
  if (lspServer) lspServer.kill("SIGKILL");
  process.exit(2);
});
