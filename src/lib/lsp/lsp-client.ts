"use client";

import {
  MonacoLanguageClient,
  type MonacoLanguageClientOptions,
} from "monaco-languageclient";
import {
  WebSocketMessageReader,
  WebSocketMessageWriter,
  type IWebSocket,
} from "vscode-ws-jsonrpc";
import type * as Monaco from "monaco-editor";

/**
 * CloseAction / ErrorAction enums — defined inline to avoid importing from
 * 'vscode-languageclient/browser' which Turbopack can't resolve via the
 * package's subpath exports (the 'browser' condition isn't recognized
 * during SSR). These values must match vscode-languageclient's enums.
 *   CloseAction.DoNotRestart = 1, CloseAction.Restart = 2
 *   ErrorAction.Continue = 1, ErrorAction.Shutdown = 2
 */
const CloseAction = { DoNotRestart: 1, Restart: 2 } as const;
const ErrorAction = { Continue: 1, Shutdown: 2 } as const;

/**
 * LSP client for StellarForge — connects Monaco to the rust-analyzer
 * LSP gateway via WebSocket.
 *
 * Architecture:
 *   Monaco ──> MonacoLanguageClient ──> WebSocket ──> LSP gateway ──> rust-analyzer
 *
 * The gateway (mini-services/lsp-server/) spawns one rust-analyzer process
 * per workspace and bridges WebSocket ↔ stdio. Files are synced to the
 * server filesystem so cargo can resolve dependencies.
 *
 * Usage:
 *   const lsp = useLspClient({ workspaceId, monaco });
 *   await lsp.start();
 *   // ... Monaco now has full Rust IntelliSense
 *   await lsp.stop();
 */

/** Browser WebSocket adapted to the IWebSocket interface expected by vscode-ws-jsonrpc. */
class BrowserWebSocketAdapter implements IWebSocket {
  private ws: WebSocket;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
  }

  send(content: string): void {
    this.ws.send(content);
  }

  onMessage(cb: (data: unknown) => void): void {
    const handler = (event: MessageEvent) => cb(event.data);
    this.ws.addEventListener("message", handler);
    this.disposables.push({ dispose: () => this.ws.removeEventListener("message", handler) });
  }

  onError(cb: (reason: unknown) => void): void {
    const handler = (event: Event) => cb(event);
    this.ws.addEventListener("error", handler);
    this.disposables.push({ dispose: () => this.ws.removeEventListener("error", handler) });
  }

  onClose(cb: (code: number, reason: string) => void): void {
    const handler = (event: CloseEvent) => cb(event.code, event.reason);
    this.ws.addEventListener("close", handler);
    this.disposables.push({ dispose: () => this.ws.removeEventListener("close", handler) });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

/** Get the LSP gateway WebSocket URL for a workspace. */
function getLspWebSocketUrl(workspaceId: string): string {
  // In both dev and production, we use the same host as the page
  // (Next.js rewrites /lsp → the LSP gateway server).
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Use window.location.host (includes port) so it works with Next.js rewrites
  return `${protocol}//${window.location.host}/lsp?workspace=${encodeURIComponent(workspaceId)}`;
}

/** Options for the LSP client. */
export interface LspClientOptions {
  workspaceId: string;
  monaco: typeof Monaco;
  /** Called when the LSP client status changes. */
  onStatusChange?: (status: LspStatus) => void;
}

export type LspStatus =
  | "disconnected"
  | "connecting"
  | "initializing"
  | "ready"
  | "error"
  | "reconnecting";

export interface LspClient {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Sync project files to the server filesystem (so cargo can resolve deps). */
  syncFiles: (files: { path: string; content: string }[]) => Promise<void>;
  /** Notify the LSP server that a file was opened in Monaco. */
  notifyFileOpened: (uri: string, languageId: string, content: string) => void;
  /** Notify the LSP server that a file's content changed. */
  notifyFileChanged: (uri: string, content: string, version: number) => void;
  /** Notify the LSP server that a file was closed. */
  notifyFileClosed: (uri: string) => void;
  status: LspStatus;
  client: MonacoLanguageClient | null;
}

/**
 * Create an LSP client that connects Monaco to rust-analyzer via WebSocket.
 *
 * The client manages:
 *   - WebSocket connection to the LSP gateway
 *   - MonacoLanguageClient lifecycle (initialize, start, stop)
 *   - File sync (POST /workspace/:id/sync)
 *   - Document synchronization (didOpen/didChange/didClose)
 *
 * The actual completion, hover, diagnostics, go-to-def, etc. are all handled
 * automatically by MonacoLanguageClient — it registers Monaco language providers
 * that forward requests to rust-analyzer via LSP.
 */
export function createLspClient(opts: LspClientOptions): LspClient {
  const { workspaceId, monaco, onStatusChange } = opts;
  let client: MonacoLanguageClient | null = null;
  let webSocket: BrowserWebSocketAdapter | null = null;
  let status: LspStatus = "disconnected";

  function setStatus(s: LspStatus) {
    status = s;
    onStatusChange?.(s);
  }

  async function syncFiles(files: { path: string; content: string }[]): Promise<void> {
    try {
      await fetch(`${window.location.origin}/workspace/${encodeURIComponent(workspaceId)}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
    } catch {
      // LSP server not running — silently ignore. File sync is only
      // needed for rust-analyzer features (autocomplete, go-to-def).
      // The app works without LSP — it just uses the simpler autocomplete.
    }
  }

  async function start(): Promise<void> {
    if (client) return; // already started

    setStatus("connecting");

    const url = getLspWebSocketUrl(workspaceId);

    webSocket = new BrowserWebSocketAdapter(url);

    // Wait for the WebSocket to open — fail gracefully if the LSP
    // server isn't running. The app works without LSP (falls back to
    // the simpler autocomplete provider).
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
      }, 10_000);

      const onOpen = () => {
        clearTimeout(timeout);
        resolve();
      };
      const onError = (err: unknown) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket connection failed: ${String(err)}`));
      };

      // Attach one-time listeners
      const ws = (webSocket as unknown as { ws: WebSocket }).ws as WebSocket;
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    }).catch((err) => {
      // LSP server not available — log once and set status to error.
      // Don't spam the console — the user may not have the LSP server
      // running, and that's fine (the app works without it).
      console.warn("[lsp] server not available — LSP features disabled. Start it with: bm2 start bm2.config.ts");
      setStatus("error");
      throw err;
    });

    setStatus("initializing");

    // Create the LSP message reader/writer over the WebSocket
    const reader = new WebSocketMessageReader(webSocket);
    const writer = new WebSocketMessageWriter(webSocket);

    // Create the MonacoLanguageClient
    const clientOptions: MonacoLanguageClientOptions["clientOptions"] = {
      // documentSelector must match the language id used on Monaco models.
      // We use "rust" (not "soroban") so rust-analyzer matches the documents.
      documentSelector: [
        { scheme: "file", language: "rust" },
      ],
      // Don't restart automatically — we handle reconnection at a higher level
      connectionOptions: {
        maxRestartCount: 0,
      },
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => {
          setStatus("disconnected");
          return { action: CloseAction.DoNotRestart };
        },
      },
      // Initialize rust-analyzer with the workspace root
      initializationOptions: {
        // Tell rust-analyzer about the workspace
        workspaceRoot: `/tmp/stellarforge-builds/${workspaceId}`,
        // Enable cargo check on save for diagnostics
        checkOnSave: {
          command: "clippy",
        },
        // Use the shared cargo cache
        cargo: {
          target: "wasm32v1-none",
          features: "all",
        },
      },
    };

    const languageClientOptions: MonacoLanguageClientOptions = {
      name: "rust-analyzer",
      clientOptions,
      messageTransports: {
        reader,
        writer,
      },
    };

    client = new MonacoLanguageClient(languageClientOptions);

    // Listen for diagnostics from rust-analyzer
    client.onNotification("textDocument/publishDiagnostics", (params: unknown) => {
      // MonacoLanguageClient automatically converts these to Monaco markers
      // via the DiagnosticCollection. We just log for debugging.
      const p = params as { uri: string; diagnostics: Array<{ message: string; severity: number }> };
      if (p.diagnostics.length > 0) {
        console.log(`[lsp] ${p.diagnostics.length} diagnostics for ${p.uri}`);
      }
    });

    try {
      await client.start();
      setStatus("ready");
      console.log("[lsp] client started — rust-analyzer ready");
    } catch (err) {
      console.error("[lsp] failed to start client:", err);
      setStatus("error");
      throw err;
    }
  }

  async function stop(): Promise<void> {
    if (client) {
      try {
        await client.stop();
      } catch (err) {
        console.warn("[lsp] error stopping client:", err);
      }
      client = null;
    }
    if (webSocket) {
      webSocket.dispose();
      webSocket = null;
    }
    setStatus("disconnected");
  }

  function notifyFileOpened(uri: string, languageId: string, content: string): void {
    if (!client) return;
    // The MonacoLanguageClient handles didOpen automatically when a model
    // is created with a matching URI + language. This is a no-op for the
    // most part, but exposed for manual control if needed.
  }

  function notifyFileChanged(uri: string, content: string, version: number): void {
    if (!client) return;
    // Same as notifyFileOpened — handled automatically by the language client.
  }

  function notifyFileClosed(uri: string): void {
    if (!client) return;
    // Handled automatically.
  }

  return {
    start,
    stop,
    syncFiles,
    notifyFileOpened,
    notifyFileChanged,
    notifyFileClosed,
    get status() { return status; },
    get client() { return client; },
  };
}

/**
 * Convert a Monaco file path to an LSP file URI.
 * e.g. "src/lib.rs" → "file:///tmp/stellarforge-builds/<workspaceId>/src/lib.rs"
 */
export function pathToLspUri(workspaceId: string, filePath: string): string {
  // Remove leading slash if present
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return `file:///tmp/stellarforge-builds/${workspaceId}/${cleanPath}`;
}

/**
 * Convert an LSP file URI back to a Monaco file path.
 * e.g. "file:///tmp/stellarforge-builds/<id>/src/lib.rs" → "src/lib.rs"
 */
export function lspUriToPath(workspaceId: string, uri: string): string {
  const prefix = `file:///tmp/stellarforge-builds/${workspaceId}/`;
  if (uri.startsWith(prefix)) {
    return uri.slice(prefix.length);
  }
  return uri;
}
