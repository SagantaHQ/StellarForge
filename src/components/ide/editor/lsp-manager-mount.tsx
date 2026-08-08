"use client";

import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import { useLspManager } from "@/lib/lsp/use-lsp-manager";

/**
 * Mounts the LSP manager inside the IDE shell.
 *
 * This component:
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

  const { status, workspaceId } = useLspManager(monaco);

  // Expose status on window for the status bar
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __lspStatus?: string; __lspWorkspace?: string }).__lspStatus = status;
      (window as unknown as { __lspWorkspace?: string }).__lspWorkspace = workspaceId ?? undefined;
    }
  }, [status, workspaceId]);

  return null;
}
