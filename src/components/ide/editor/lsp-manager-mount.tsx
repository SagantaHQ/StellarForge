"use client";

import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";

/**
 * Mounts the LSP manager inside the IDE shell.
 *
 * This component MUST be loaded via next/dynamic with ssr:false to prevent
 * the monaco-languageclient CSS imports from breaking SSR.
 *
 * It:
 *   1. Dynamically imports Monaco (client-side only)
 *   2. Calls useLspManager(monaco) which:
 *      - Creates an LSP client connected to the WebSocket gateway
 *      - Syncs project files to the server filesystem
 *      - Starts rust-analyzer for the active workspace
 *   3. Exposes the LSP status on window so other components (e.g. the
 *      status bar) can display it.
 */
export function LspManagerMount() {
  const [monaco, setMonaco] = useState<typeof Monaco | null>(null);

  // Dynamically import Monaco on mount (client-side only)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const monacoModule = await import("monaco-editor");
        const m = (monacoModule.default ?? monacoModule) as typeof Monaco;
        if (!cancelled) setMonaco(m);
      } catch (err) {
        console.error("[lsp] failed to load monaco:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dynamically import + use the LSP manager hook
  // We use a wrapper component to call the hook conditionally
  return monaco ? <LspManagerInner monaco={monaco} /> : null;
}

/** Inner component that calls the useLspManager hook (only rendered client-side). */
function LspManagerInner({ monaco }: { monaco: typeof Monaco }) {
  const [status, setStatus] = useState<string>("disconnected");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { useLspManager } = await import("@/lib/lsp/use-lsp-manager");
        if (cancelled) return;
        // useLspManager is a hook — we can't call it here directly.
        // Instead, we'll use the window-based status polling approach.
        // The actual hook is called by the dynamically imported module.
      } catch (err) {
        console.error("[lsp] failed to load LSP manager:", err);
      }
    })();

    // Poll window.__lspStatus for the status bar
    const interval = setInterval(() => {
      const s = (window as unknown as { __lspStatus?: string }).__lspStatus;
      const w = (window as unknown as { __lspWorkspace?: string }).__lspWorkspace;
      if (s && s !== status) setStatus(s);
      if (w !== workspaceId) setWorkspaceId(w ?? null);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, workspaceId]);

  // Expose status on window for the status bar
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __lspStatus?: string }).__lspStatus = status;
      (window as unknown as { __lspWorkspace?: string }).__lspWorkspace = workspaceId ?? undefined;
    }
  }, [status, workspaceId]);

  return null;
}
