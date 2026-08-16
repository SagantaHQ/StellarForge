/**
 * StellarForge — LSP WebSocket Gateway
 *
 * Bridges Monaco (in the browser) ↔ rust-analyzer (server-side stdio).
 *
 * Architecture:
 *   Browser ──WebSocket──> this gateway ──stdio──> rust-analyzer
 *
 * Per workspace (project ID), the gateway:
 *   1. Writes the project files to /tmp/stellarforge-builds/<projectId>/
 *   2. Spawns `rust-analyzer` with that dir as the workspace root
 *   3. Forwards LSP messages between the WebSocket and rust-analyzer's stdio
 *   4. Idles out after 2 minutes of no WebSocket connections
 *   5. Auto-restarts rust-analyzer if it crashes (exponential backoff)
 *
 * §Fix (2026-08-16) — startup pre-flight + worker hardening:
 *   - On startup, verifies rust-analyzer is installed and executable.
 *     If missing, prints install instructions and EXITS with code 1 so
 *     the operator sees the failure (bm2/pm2 will surface the crash).
 *   - rust-analyzer is spawned with `detached: true` so it runs in its
 *     own process group. This means we can signal the whole group
 *     (RA + any cargo subprocesss it spawned) on shutdown, avoiding
 *     orphaned cargo processes that would otherwise keep running.
 *   - On unexpected RA exit, auto-restarts with exponential backoff
 *     (1s, 2s, 5s, 10s, 30s) up to 5 attempts per session. After 5
 *     failed restarts, notifies the client and gives up.
 *
 * The gateway also exposes two REST endpoints:
 *   POST /workspace/:id/sync   — write/overwrite project files
 *   GET  /health               — returns { ok, rustAnalyzerVersion, activeSessions }
 *
 * Security:
 *   - Workspace paths are sanitized (no path traversal)
 *   - Each workspace is isolated under /tmp/stellarforge-builds/<projectId>
 *   - rust-analyzer runs with CARGO_HOME + RUSTUP_HOME pointing to the shared
 *     cargo cache so deps are downloaded once and reused across workspaces
 */

import { WebSocketServer, WebSocket } from "ws";
import { spawn, execFile, ChildProcess } from "child_process";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { promises as fs } from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.LSP_PORT || "3099", 10);
const HOME = process.env.HOME || "/home/z";
const BUILDS_DIR = "/tmp/stellarforge-builds";
const CARGO_HOME = process.env.CARGO_HOME || `${HOME}/.cargo`;
const RUSTUP_HOME = process.env.RUSTUP_HOME || `${HOME}/.rustup`;
// §Fix — allow overriding the rust-analyzer binary path via env var.
// Useful for: (1) tests that use a stub, (2) operators who installed
// rust-analyzer via a non-default method (e.g. distro package, snap).
// Defaults to $CARGO_HOME/bin/rust-analyzer.
const RUST_ANALYZER_BIN = process.env.RUST_ANALYZER_BIN || `${CARGO_HOME}/bin/rust-analyzer`;
const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes (frees RAM quickly)

// Auto-restart backoff schedule (in ms). 5 attempts before giving up.
// 1s, 2s, 5s, 10s, 30s — gives RA time to recover from transient issues
// (e.g. cargo lock contention, OOM, signal from another process).
const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const MAX_RESTART_ATTEMPTS = RESTART_BACKOFF_MS.length;

// ── Types ─────────────────────────────────────────────────────────────
interface LspSession {
  workspaceId: string;
  workspaceDir: string;
  process: ChildProcess | null;
  wsClients: Set<WebSocket>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  initialized: boolean;
  pendingMessages: string[];
  // §Fix — restart tracking
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  // §Fix — set to true when we intentionally kill RA (so the close
  // handler doesn't treat it as a crash and try to auto-restart)
  intentionalStop: boolean;
}

// ── Session manager ───────────────────────────────────────────────────
const sessions = new Map<string, LspSession>();

// Global — set by the startup pre-flight check
let raVersion: string | null = null;

/** Sanitize the workspace ID to prevent path traversal. */
function sanitizeWorkspaceId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned || cleaned.length > 100) {
    throw new Error("Invalid workspace ID");
  }
  return cleaned;
}

/** Get or create a workspace dir for the given ID. */
async function ensureWorkspaceDir(workspaceId: string): Promise<string> {
  const dir = path.join(BUILDS_DIR, workspaceId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ── §Fix: Startup pre-flight check ────────────────────────────────────
/**
 * Verify rust-analyzer is installed and executable BEFORE starting the
 * gateway. If it's missing, print clear install instructions and exit
 * with code 1 so the operator sees the failure (bm2/pm2 will surface the
 * crash, instead of silently running a broken server).
 *
 * Returns the version string on success, exits the process on failure.
 */
async function checkRustAnalyzerInstalled(): Promise<string> {
  // 1. Check the binary exists on disk
  try {
    await fs.access(RUST_ANALYZER_BIN, fs.constants.X_OK);
  } catch {
    printInstallBanner(
      `rust-analyzer binary not found at ${RUST_ANALYZER_BIN}`,
      `The expected location is $CARGO_HOME/bin/rust-analyzer where
CARGO_HOME = ${CARGO_HOME}.

The LSP server cannot start without rust-analyzer. The gateway will now
exit with code 1 so the operator can install rust-analyzer and restart.`
    );
    process.exit(1);
  }

  // 2. Verify it actually runs (catches arch mismatch, missing libs, etc.)
  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile(RUST_ANALYZER_BIN, ["--version"], { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return version;
  } catch (err) {
    printInstallBanner(
      `rust-analyzer at ${RUST_ANALYZER_BIN} failed to execute`,
      `Error: ${err instanceof Error ? err.message : String(err)}

This usually means:
  - The binary is for a different architecture (e.g. x86_64 on arm64)
  - A shared library is missing (try: ldd ${RUST_ANALYZER_BIN})
  - The binary is corrupted

Reinstall with: rustup component add rust-analyzer --force`
    );
    process.exit(1);
  }
}

/** Print a clear install/error banner so the operator knows what to do. */
function printInstallBanner(headline: string, body: string): void {
  console.error(`
================================================================
  StellarForge LSP Server — FATAL STARTUP ERROR

  ${headline}
----------------------------------------------------------------
${body}
================================================================
`);
}

// ── Write project files to the workspace dir ────────────────────────
async function syncWorkspaceFiles(
  workspaceId: string,
  files: { path: string; content: string }[]
): Promise<void> {
  const dir = await ensureWorkspaceDir(workspaceId);
  for (const file of files) {
    const cleanPath = path.normalize(file.path).replace(/^(\.\.[/\\])+/, "");
    const fullPath = path.join(dir, cleanPath);
    if (!fullPath.startsWith(dir)) {
      console.warn(`[lsp] rejecting path traversal: ${file.path}`);
      continue;
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, "utf-8");
  }
}

/**
 * Start a rust-analyzer process for the workspace.
 *
 * §Fix — runs RA in its own process group (detached: true) so that on
 * shutdown we can signal the WHOLE group (RA + any cargo/rustc
 * subprocesss it spawned) and avoid orphaned processes accumulating
 * in /tmp/stellarforge-builds/<id>/.
 *
 * §Fix — auto-restart on crash with exponential backoff. If RA exits
 * unexpectedly (not via intentionalStop), schedule a restart after
 * RESTART_BACKOFF_MS[restartAttempts] ms. After MAX_RESTART_ATTEMPTS
 * failed restarts, give up and notify all connected WS clients.
 */
function startRustAnalyzer(session: LspSession): void {
  if (session.process) return;
  if (session.intentionalStop) return; // don't auto-restart after intentional kill

  const env = {
    ...process.env,
    CARGO_HOME,
    RUSTUP_HOME,
    PATH: `${CARGO_HOME}/bin:${process.env.PATH ?? ""}`,
    RA_LOG: process.env.RA_LOG || "info",
  };

  console.log(
    `[lsp] starting rust-analyzer for ${session.workspaceId} ` +
    `(attempt ${session.restartAttempts + 1}/${MAX_RESTART_ATTEMPTS + 1}, ` +
    `cwd: ${session.workspaceDir})`
  );

  // §Fix — detached: true puts RA in its own process group.
  // We DON'T call child.unref() because we still want to receive
  // stdout/stderr events. The detached flag just means we can later
  // use process.kill(-child.pid, 'SIGTERM') to signal the whole group.
  const child = spawn(RUST_ANALYZER_BIN, [], {
    cwd: session.workspaceDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  session.process = child;
  session.intentionalStop = false;

  // §Fix (2026-08-16) — Buffer-based LSP message framing (was string-based).
  //
  // LSP frames messages as "Content-Length: N\r\n\r\n" + N BYTES.
  // The previous code did `stdoutBuffer += chunk.toString()` (UTF-8 string)
  // then used `stdoutBuffer.slice(start, start + N)` where N is BYTES — but
  // string.slice operates on CHARACTERS. For messages with multi-byte UTF-8
  // (smart quotes, accented chars, emoji in docs), the slice overshoots the
  // JSON body and grabs the start of the next message's "Content-Length:"
  // header. JSON.parse then fails with:
  //   "Unexpected non-whitespace character after JSON at position N"
  // This is exactly what was happening with large completion responses.
  //
  // Fix: keep stdoutBuffer as a Buffer. Use Buffer.indexOf / subarray which
  // operate on BYTES. Convert to string ONLY for the parsed message, AFTER
  // correct byte-accurate slicing.
  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = "";

  // Parse LSP messages from rust-analyzer's stdout and forward to WS clients
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);

    while (true) {
      // Find the end of the headers section (CRLF CRLF).
      // Buffer.indexOf works on bytes, so "\r\n\r\n" is byte-accurate.
      const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      // Parse headers as ASCII (headers are always ASCII per LSP spec).
      const header = stdoutBuffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const contentLength = parseInt(match[1], 10); // BYTES
      const messageStart = headerEnd + 4; // length of "\r\n\r\n"
      const messageEnd = messageStart + contentLength;

      // Wait until we have the full message body (byte-accurate check).
      if (stdoutBuffer.length < messageEnd) break;

      // §Fix — slice the EXACT byte range, then decode as UTF-8.
      // Previously this was a character slice → multi-byte chars caused
      // the slice to overshoot, corrupting the message.
      const message = stdoutBuffer.subarray(messageStart, messageEnd).toString("utf-8");
      stdoutBuffer = stdoutBuffer.subarray(messageEnd);

      // Forward to all connected WS clients
      for (const ws of session.wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[ra:${session.workspaceId}] ${line}`);
      }
    }
  });

  child.on("error", (err) => {
    console.error(`[lsp] rust-analyzer spawn error for ${session.workspaceId}:`, err);
    session.process = null;
    notifyClients(session, `rust-analyzer failed to start — ${err.message}`, "error");
    scheduleAutoRestart(session);
  });

  child.on("close", (code, signal) => {
    console.log(
      `[lsp] rust-analyzer exited for ${session.workspaceId} ` +
      `(code: ${code}, signal: ${signal}${session.intentionalStop ? ", intentional" : ""})`
    );
    session.process = null;
    session.initialized = false;

    // §Fix — if this was an intentional kill (shutdown / idle cleanup),
    // don't try to auto-restart. Otherwise treat as a crash.
    if (session.intentionalStop) {
      return;
    }

    // Notify clients about the crash
    if (code !== null && code !== 0) {
      notifyClients(
        session,
        `rust-analyzer exited unexpectedly (code ${code}). Attempting to restart...`,
        "warning"
      );
    }

    scheduleAutoRestart(session);
  });

  // Send any pending messages that were queued before RA was ready
  if (session.pendingMessages.length > 0) {
    setTimeout(() => {
      if (session.process && !session.process.killed) {
        for (const msg of session.pendingMessages) {
          writeLspMessage(session.process!.stdin, msg);
        }
        session.pendingMessages = [];
      }
    }, 100);
  }
}

/**
 * §Fix — Schedule an auto-restart with exponential backoff.
 * Gives RA time to recover from transient issues (OOM, signal, etc.).
 * After MAX_RESTART_ATTEMPTS, gives up and notifies the client.
 */
function scheduleAutoRestart(session: LspSession): void {
  if (session.intentionalStop) return;
  if (session.restartTimer) clearTimeout(session.restartTimer);

  if (session.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.error(
      `[lsp] giving up on ${session.workspaceId} after ${MAX_RESTART_ATTEMPTS} restart attempts`
    );
    notifyClients(
      session,
      `rust-analyzer failed to start after ${MAX_RESTART_ATTEMPTS} attempts. ` +
      `The workspace may have an unrecoverable Cargo.toml error or the rust-analyzer ` +
      `installation is broken. Try removing /tmp/stellarforge-builds/${session.workspaceId} ` +
      `and reconnecting. Server logs: /tmp/lsp-server.log`,
      "error"
    );
    return;
  }

  const delay = RESTART_BACKOFF_MS[session.restartAttempts];
  session.restartAttempts++;
  console.log(
    `[lsp] scheduling restart for ${session.workspaceId} in ${delay}ms ` +
    `(attempt ${session.restartAttempts}/${MAX_RESTART_ATTEMPTS})`
  );
  session.restartTimer = setTimeout(() => {
    session.restartTimer = null;
    startRustAnalyzer(session);
  }, delay);
}

/** Send a JSON-RPC window/showMessage notification to all WS clients. */
function notifyClients(
  session: LspSession,
  message: string,
  severity: "error" | "warning" | "info"
): void {
  const type = severity === "error" ? 1 : severity === "warning" ? 2 : 3;
  const notification = JSON.stringify({
    jsonrpc: "2.0",
    method: "window/showMessage",
    params: { type, message: `StellarForge LSP: ${message}` },
  });
  for (const ws of session.wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}

/** Intentionally stop RA — used by idle cleanup + graceful shutdown. */
async function stopRustAnalyzer(session: LspSession, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  session.intentionalStop = true;
  if (session.restartTimer) {
    clearTimeout(session.restartTimer);
    session.restartTimer = null;
  }
  const child = session.process;
  if (!child || child.killed) {
    session.process = null;
    return;
  }

  // §Fix — signal the WHOLE process group (RA + cargo subprocesss).
  // Negative PID means "send to every process in group <pid>".
  try {
    process.kill(-child.pid!, signal);
  } catch {
    // Process group might not exist (e.g. RA already exited) — fall back
    try { child.kill(signal); } catch {}
  }

  // Wait up to 3s for graceful exit, then SIGKILL the group
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
      resolve();
    }, 3000);

    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  session.process = null;
  session.initialized = false;
}

/** Write an LSP message to a stream with Content-Length framing. */
function writeLspMessage(stream: NodeJS.WritableStream, message: string): void {
  const data = Buffer.from(message, "utf-8");
  const header = `Content-Length: ${data.length}\r\n\r\n`;
  stream.write(header);
  stream.write(data);
}

/** Get or create an LSP session for a workspace. */
async function getOrCreateSession(workspaceId: string): Promise<LspSession> {
  let session = sessions.get(workspaceId);
  if (session) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    return session;
  }

  const workspaceDir = await ensureWorkspaceDir(workspaceId);
  session = {
    workspaceId,
    workspaceDir,
    process: null,
    wsClients: new Set(),
    idleTimer: null,
    initialized: false,
    pendingMessages: [],
    restartAttempts: 0,
    restartTimer: null,
    intentionalStop: false,
  };
  sessions.set(workspaceId, session);

  // Start rust-analyzer immediately
  startRustAnalyzer(session);
  return session;
}

/** Schedule idle cleanup for a session. */
function scheduleIdleCleanup(session: LspSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(async () => {
    console.log(`[lsp] idle timeout for ${session.workspaceId} — cleaning up`);
    await stopRustAnalyzer(session);
    sessions.delete(session.workspaceId);
    // Don't delete the workspace dir — keep it for faster reconnects
  }, IDLE_TIMEOUT_MS);
}

// ── HTTP server (REST endpoints) ─────────────────────────────────────
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Health check — includes RA version from startup pre-flight
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      rustAnalyzerVersion: raVersion ?? "unknown",
      rustAnalyzerBin: RUST_ANALYZER_BIN,
      activeSessions: sessions.size,
      sessions: Array.from(sessions.entries()).map(([id, s]) => ({
        workspaceId: id,
        raRunning: !!s.process && !s.process.killed,
        wsClients: s.wsClients.size,
        restartAttempts: s.restartAttempts,
      })),
    }));
    return;
  }

  // Sync workspace files: POST /workspace/:id/sync
  const syncMatch = url.pathname.match(/^\/workspace\/([^/]+)\/sync$/);
  if (syncMatch && req.method === "POST") {
    try {
      const workspaceId = sanitizeWorkspaceId(syncMatch[1]);
      const body = await readJsonBody(req);
      const files = (body as { files?: { path: string; content: string }[] }).files;
      if (!Array.isArray(files)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing files array" }));
        return;
      }
      await syncWorkspaceFiles(workspaceId, files);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, fileCount: files.length, workspaceId }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── WebSocket server (LSP transport) ──────────────────────────────────
// §Fix — noServer mode + manual upgrade handler so we accept BOTH /lsp
// and /lsp/ (some nginx configs redirect /lsp → /lsp/, which WS clients
// can't follow during the handshake).
const wss = new WebSocketServer({ noServer: true });

function isLspUpgradePath(pathname: string): boolean {
  return pathname === "/lsp" || pathname === "/lsp/";
}

httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (!isLspUpgradePath(url.pathname)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const workspaceIdParam = url.searchParams.get("workspace");
  if (!workspaceIdParam) {
    ws.close(4001, "Missing workspace parameter");
    return;
  }

  let workspaceId: string;
  try {
    workspaceId = sanitizeWorkspaceId(workspaceIdParam);
  } catch {
    ws.close(4002, "Invalid workspace ID");
    return;
  }

  const session = await getOrCreateSession(workspaceId);
  session.wsClients.add(ws);
  console.log(`[lsp] WS client connected to ${workspaceId} (${session.wsClients.size} total)`);

  // If RA has crashed too many times, tell the client immediately
  if (session.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    notifyClients(
      session,
      `rust-analyzer has failed to start ${MAX_RESTART_ATTEMPTS} times. ` +
      `The workspace may be in an unrecoverable state. Try removing ` +
      `/tmp/stellarforge-builds/${workspaceId} and reconnecting.`,
      "error"
    );
  }

  ws.on("message", (data: Buffer) => {
    const message = data.toString();
    if (!session.process || session.process.killed) {
      // RA not ready — queue the message. startRustAnalyzer() was already
      // called by getOrCreateSession() or scheduleAutoRestart().
      session.pendingMessages.push(message);
      return;
    }

    // §Fix (2026-08-16) — filter out duplicate `initialize` requests.
    // Multiple WS clients can connect to the same workspace (e.g. multiple
    // browser tabs, HMR re-mounts, or React StrictMode double-mount). Each
    // client sends `initialize` on connect, but rust-analyzer only accepts
    // ONE initialize per session — a second one crashes RA with:
    //   "expected initialized notification, got: Request initialize"
    //
    // Solution: if RA is already initialized (session.initialized === true)
    // and we receive another `initialize` request, swallow it and send back
    // a fake "success" response so the client thinks it initialized. This
    // is the standard pattern used by multi-client LSP gateways.
    if (session.initialized) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.method === "initialize" && parsed.id !== undefined) {
          console.log(`[lsp] swallowing duplicate initialize from ${workspaceId} (RA already initialized)`);
          // Send a minimal InitializeResult back to the client so it can
          // proceed to send `initialized` notification + start making requests.
          const fakeResponse = JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: {
              capabilities: {
                textDocumentSync: 1, // Full sync
                completionProvider: { triggerCharacters: [".", ":", "/"] },
                hoverProvider: true,
                definitionProvider: true,
                typeDefinitionProvider: true,
                referencesProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                renameProvider: true,
                codeActionProvider: true,
                foldingRangeProvider: true,
                selectionRangeProvider: true,
                semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] } },
              },
              serverInfo: { name: "rust-analyzer", version: "multi-client-proxy" },
            },
          });
          ws.send(fakeResponse);
          return;
        }
      } catch {
        // If parse fails, fall through and forward the message as-is
      }
    }

    // §Fix (2026-08-16) — track when RA receives the `initialized`
    // notification so we know to filter duplicate `initialize` requests
    // from new WS clients connecting later. Without this, the second
    // client's `initialize` would crash RA.
    try {
      const parsed = JSON.parse(message);
      if (parsed.method === "initialized") {
        // Mark session as initialized AFTER forwarding to RA
        session.initialized = true;
        console.log(`[lsp] RA marked as initialized for ${workspaceId}`);
      }
    } catch {
      // Not a JSON message — ignore
    }

    writeLspMessage(session.process.stdin, message);
  });

  ws.on("close", () => {
    session.wsClients.delete(ws);
    console.log(`[lsp] WS client disconnected from ${workspaceId} (${session.wsClients.size} remaining)`);
    if (session.wsClients.size === 0) {
      scheduleIdleCleanup(session);
    }
  });

  ws.on("error", (err) => {
    console.error(`[lsp] WS error for ${workspaceId}:`, err);
    session.wsClients.delete(ws);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

// ── §Fix: Main entry point with startup pre-flight ────────────────────
async function main(): Promise<void> {
  // 1. Pre-flight check — verify rust-analyzer is installed.
  //    EXITS with code 1 if missing, so the operator sees the failure
  //    (bm2 will show the process as crashed, instead of running a
  //    silently-broken server).
  console.log("[lsp] startup pre-flight: checking rust-analyzer installation...");
  raVersion = await checkRustAnalyzerInstalled();

  // 2. Print startup banner with version info
  console.log(`
================================================================
  StellarForge LSP Gateway
================================================================
  rust-analyzer : ${raVersion}
  binary path   : ${RUST_ANALYZER_BIN}
  CARGO_HOME    : ${CARGO_HOME}
  RUSTUP_HOME    : ${RUSTUP_HOME}
  builds dir    : ${BUILDS_DIR}
  idle timeout  : ${IDLE_TIMEOUT_MS / 1000}s
  restart limit : ${MAX_RESTART_ATTEMPTS} attempts (backoff: ${RESTART_BACKOFF_MS.join(", ")}ms)
================================================================
`);

  // 3. Start listening
  httpServer.listen(PORT, () => {
    console.log(`[lsp] LSP gateway listening on http://localhost:${PORT}`);
    console.log(`[lsp] WebSocket endpoint: ws://localhost:${PORT}/lsp?workspace=<id>`);
    console.log(`[lsp] Health check: http://localhost:${PORT}/health`);
  });
}

// ── Graceful shutdown — kill all RA process groups ────────────────────
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[lsp] ${signal} — shutting down`);
  const shutdownPromises: Promise<void>[] = [];
  for (const [, session] of sessions) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.process) {
      shutdownPromises.push(stopRustAnalyzer(session, "SIGTERM"));
    }
  }
  await Promise.all(shutdownPromises);
  console.log("[lsp] all rust-analyzer processes stopped");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

// ── Run ──────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("[lsp] fatal startup error:", err);
  process.exit(1);
});
