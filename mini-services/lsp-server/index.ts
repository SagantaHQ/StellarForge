/**
 * Soroban.Build — LSP WebSocket Gateway
 *
 * Bridges Monaco (in the browser) ↔ rust-analyzer (server-side stdio).
 *
 * Architecture:
 *   Browser ──WebSocket──> this gateway ──stdio──> rust-analyzer
 *
 * Per workspace (project ID), the gateway:
 *   1. Writes the project files to /tmp/soroban-builds/<projectId>/
 *   2. Spawns `rust-analyzer` with that dir as the workspace root
 *   3. Forwards LSP messages between the WebSocket and rust-analyzer's stdio
 *   4. Idles out after 10 minutes of no WebSocket connections
 *
 * The gateway also exposes two REST endpoints:
 *   POST /workspace/:id/sync   — write/overwrite project files (body: { files: [{path, content}] })
 *   GET  /health               — returns { ok, rustAnalyzerVersion, activeSessions }
 *
 * Security:
 *   - Workspace paths are sanitized (no path traversal)
 *   - Each workspace is isolated under /tmp/soroban-builds/<projectId>
 *   - rust-analyzer runs with CARGO_HOME + RUSTUP_HOME pointing to the shared
 *     cargo cache so deps are downloaded once and reused across workspaces
 */

import { WebSocketServer, WebSocket } from "ws";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

// ── Config ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.LSP_PORT || "3001", 10);
const HOME = process.env.HOME || "/home/z";
const BUILDS_DIR = "/tmp/soroban-builds";
const CARGO_HOME = `${HOME}/.cargo`;
const RUSTUP_HOME = `${HOME}/.rustup`;
const RUST_ANALYZER_BIN = `${CARGO_HOME}/bin/rust-analyzer`;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ── Types ─────────────────────────────────────────────────────────────
interface LspSession {
  workspaceId: string;
  workspaceDir: string;
  process: ChildProcessWithoutNullStreams | null;
  wsClients: Set<WebSocket>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  initialized: boolean;
  pendingMessages: string[]; // messages received before RA was ready
}

// ── Session manager ───────────────────────────────────────────────────
const sessions = new Map<string, LspSession>();

/** Sanitize the workspace ID to prevent path traversal. */
function sanitizeWorkspaceId(id: string): string {
  // Only allow alphanumeric + dash + underscore
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

/** Write project files to the workspace dir. */
async function syncWorkspaceFiles(
  workspaceId: string,
  files: { path: string; content: string }[]
): Promise<void> {
  const dir = await ensureWorkspaceDir(workspaceId);
  for (const file of files) {
    // Sanitize the file path — no absolute paths, no ..
    const cleanPath = path.normalize(file.path).replace(/^(\.\.[/\\])+/, "");
    const fullPath = path.join(dir, cleanPath);
    // Ensure the resolved path is still inside the workspace dir
    if (!fullPath.startsWith(dir)) {
      console.warn(`[lsp] rejecting path traversal: ${file.path}`);
      continue;
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, "utf-8");
  }
}

/** Start a rust-analyzer process for the workspace. */
function startRustAnalyzer(session: LspSession): void {
  if (session.process) return;

  const env = {
    ...process.env,
    CARGO_HOME,
    RUSTUP_HOME,
    PATH: `${CARGO_HOME}/bin:${process.env.PATH ?? ""}`,
    // Tell rust-analyzer to skip loading the default config file
    RA_LOG: process.env.RA_LOG || "info",
  };

  console.log(`[lsp] starting rust-analyzer for ${session.workspaceId} (cwd: ${session.workspaceDir})`);

  const child = spawn(RUST_ANALYZER_BIN, [], {
    cwd: session.workspaceDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  session.process = child;

  // Buffer for incomplete LSP messages (Content-Length framing)
  let stdoutBuffer = "";
  let stderrBuffer = "";

  // Parse LSP messages from rust-analyzer's stdout and forward to WS clients
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    // LSP messages are framed with "Content-Length: N\r\n\r\n" + N bytes
    while (true) {
      const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = stdoutBuffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const contentLength = parseInt(match[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (stdoutBuffer.length < messageEnd) break; // incomplete
      const message = stdoutBuffer.slice(messageStart, messageEnd);
      stdoutBuffer = stdoutBuffer.slice(messageEnd);
      // Forward to all connected WS clients
      for (const ws of session.wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  });

  // Log stderr (rust-analyzer diagnostics)
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
    console.error(`[lsp] rust-analyzer error for ${session.workspaceId}:`, err);
    session.process = null;
  });

  child.on("close", (code) => {
    console.log(`[lsp] rust-analyzer exited for ${session.workspaceId} (code: ${code})`);
    session.process = null;
    session.initialized = false;
  });

  // Send any pending messages that were queued before RA was ready
  if (session.pendingMessages.length > 0) {
    setTimeout(() => {
      for (const msg of session.pendingMessages) {
        writeLspMessage(child.stdin, msg);
      }
      session.pendingMessages = [];
    }, 100);
  }
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
    // Cancel idle timer — a client is connecting
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
    if (session.process) {
      session.process.kill("SIGTERM");
      setTimeout(() => {
        if (session.process) {
          session.process.kill("SIGKILL");
        }
      }, 2000);
    }
    sessions.delete(session.workspaceId);
    // Don't delete the workspace dir — keep it for faster reconnects
  }, IDLE_TIMEOUT_MS);
}

// ── HTTP server (REST endpoints) ──────────────────────────────────────
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/health") {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      let version = "unknown";
      try {
        const { stdout } = await execFileAsync(RUST_ANALYZER_BIN, ["--version"], { timeout: 5000 });
        version = stdout.trim();
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        rustAnalyzerVersion: version,
        activeSessions: sessions.size,
        sessions: Array.from(sessions.keys()),
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // Sync workspace files: POST /workspace/:id/sync
  const syncMatch = url.pathname.match(/^\/workspace\/([^/]+)\/sync$/);
  if (syncMatch && req.method === "POST") {
    try {
      const workspaceId = sanitizeWorkspaceId(syncMatch[1]);
      const body = await readJsonBody(req);
      const files = body.files as { path: string; content: string }[];
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
const wss = new WebSocketServer({ server: httpServer, path: "/lsp" });

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
  } catch (err) {
    ws.close(4002, "Invalid workspace ID");
    return;
  }

  const session = await getOrCreateSession(workspaceId);
  session.wsClients.add(ws);
  console.log(`[lsp] WS client connected to ${workspaceId} (${session.wsClients.size} total)`);

  ws.on("message", (data: Buffer) => {
    const message = data.toString();
    if (!session.process || session.process.killed) {
      // RA not ready — queue the message
      session.pendingMessages.push(message);
      // Try restarting RA
      if (!session.process) startRustAnalyzer(session);
      return;
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
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// ── Start ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[lsp] LSP gateway listening on http://localhost:${PORT}`);
  console.log(`[lsp] WebSocket endpoint: ws://localhost:${PORT}/lsp?workspace=<id>`);
  console.log(`[lsp] Health check: http://localhost:${PORT}/health`);
  console.log(`[lsp] rust-analyzer: ${RUST_ANALYZER_BIN}`);
  console.log(`[lsp] CARGO_HOME: ${CARGO_HOME}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[lsp] SIGTERM — shutting down");
  for (const [, session] of sessions) {
    if (session.process) session.process.kill("SIGTERM");
    if (session.idleTimer) clearTimeout(session.idleTimer);
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[lsp] SIGINT — shutting down");
  for (const [, session] of sessions) {
    if (session.process) session.process.kill("SIGTERM");
    if (session.idleTimer) clearTimeout(session.idleTimer);
  }
  process.exit(0);
});
