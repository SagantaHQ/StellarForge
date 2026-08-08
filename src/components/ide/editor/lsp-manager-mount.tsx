"use client";

import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import { useLspManager } from "@/lib/lsp/use-lsp-manager";

/**
 * Mounts the LSP manager inside the IDE shell.
 *
 * This component MUST be loaded via next/dynamic with ssr:false (done in
 * ide-shell.tsx) to prevent the monaco-languageclient CSS imports from
 * breaking SSR.
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

  // Once Monaco is loaded, render the inner component that calls useLspManager.
  // We need a child component so the hook is always called unconditionally
  // (React hooks rules — can't call them after an early return).
  if (!monaco) return null;

  return <LspManagerActive monaco={monaco} />;
}

/**
 * Active LSP manager — calls useLspManager(monaco) unconditionally.
 * This must be a separate component so the hook is always called in the
 * same order on every render (React hooks rules).
 */
function LspManagerActive({ monaco }: { monaco: typeof Monaco }) {
  const { status, workspaceId } = useLspManager(monaco);

  // Expose status on window for the status bar
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __lspStatus?: string }).__lspStatus = status;
      (window as unknown as { __lspWorkspace?: string }).__lspWorkspace = workspaceId ?? undefined;
    }
  }, [status, workspaceId]);

  return null;
}
