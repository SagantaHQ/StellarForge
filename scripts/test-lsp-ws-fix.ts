/**
 * Test script for the LSP WebSocket fix.
 * Verifies WS upgrades on both /lsp and /lsp/ + error notifications.
 */
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { WebSocket } from "ws";

const LSP_PORT = 3099;
const LSP_SERVER_PATH = "/home/z/my-project/analysis/soroban.build/mini-services/lsp-server/index.ts";

let lspServer: ChildProcessWithoutNullStreams | null = null;
const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function log(msg: string) { console.log(`[test] ${msg}`); }
function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function startLspServer() {
  log("Starting LSP server on port " + LSP_PORT);
  lspServer = spawn("bun", [LSP_SERVER_PATH], {
    env: { ...process.env, LSP_PORT: String(LSP_PORT), HOME: "/tmp/fake-home", RUST_ANALYZER_BIN: "/bin/true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  lspServer.stdout.on("data", (d) => process.stdout.write(`[lsp] ${d}`));
  lspServer.stderr.on("data", (d) => process.stderr.write(`[lsp-err] ${d}`));
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://localhost:${LSP_PORT}/health`);
      if (res.ok) { log("LSP server ready"); return; }
    } catch {}
  }
  throw new Error("LSP server failed to start within 4s");
}

async function testHealthCheck() {
  try {
    const res = await fetch(`http://localhost:${LSP_PORT}/health`);
    const data = await res.json();
    record("health check returns 200", res.ok && data.ok === true);
  } catch (err) { record("health check returns 200", false, String(err)); }
}

async function testWsUpgrade(path: string, label: string) {
  return new Promise<void>((resolve) => {
    const url = `ws://localhost:${LSP_PORT}${path}?workspace=test-workspace`;
    const ws = new WebSocket(url);
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; record(label, false, "timeout"); try { ws.close(); } catch {} resolve(); }
    }, 3000);
    ws.on("open", () => {
      if (settled) return; settled = true; clearTimeout(timeout);
      record(label, true, "connected"); ws.close(); resolve();
    });
    ws.on("error", (err) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      record(label, false, `error: ${(err as Error).message}`); resolve();
    });
    ws.on("close", (code, reason) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      record(label, true, `closed: code=${code} reason=${reason}`); resolve();
    });
  });
}

async function testWsMissingWorkspace() {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${LSP_PORT}/lsp/`);
    let settled = false; let openedFirst = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; record("missing workspace param rejected with 4001", false, "timeout"); try { ws.close(); } catch {} resolve(); }
    }, 3000);
    ws.on("open", () => { openedFirst = true; });
    ws.on("close", (code) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      record("missing workspace param rejected with 4001", openedFirst && code === 4001, `openedFirst=${openedFirst} code=${code}`);
      resolve();
    });
    ws.on("error", () => { if (settled) return; });
  });
}

async function testHttp404Not301() {
  try {
    const res = await fetch(`http://localhost:${LSP_PORT}/unknown-path`, { redirect: "manual" });
    record("unknown path returns 404 (not 301)", res.status === 404, `status=${res.status}`);
  } catch (err) { record("unknown path returns 404 (not 301)", false, String(err)); }
}

async function main() {
  try {
    await startLspServer();
    await testHealthCheck();
    await testWsUpgrade("/lsp", "WS upgrade on /lsp succeeds");
    await testWsUpgrade("/lsp/", "WS upgrade on /lsp/ succeeds");
    await testWsMissingWorkspace();
    await testHttp404Not301();
  } finally {
    if (lspServer) { log("Stopping LSP server"); lspServer.kill("SIGTERM"); setTimeout(() => { if (lspServer) lspServer.kill("SIGKILL"); }, 1000); }
  }
  console.log("\n=== Summary ===");
  const pass = checks.filter((c) => c.pass).length;
  const fail = checks.length - pass;
  console.log(`${pass}/${checks.length} passed, ${fail} failed`);
  if (fail > 0) { console.log("\nFailed:"); for (const c of checks.filter((c) => !c.pass)) console.log(`  - ${c.name}${c.detail ? ` — ${c.detail}` : ""}`); process.exit(1); }
  else { console.log("\nAll checks passed ✓"); process.exit(0); }
}

main().catch((err) => { console.error("Test failed:", err); if (lspServer) lspServer.kill("SIGKILL"); process.exit(2); });
