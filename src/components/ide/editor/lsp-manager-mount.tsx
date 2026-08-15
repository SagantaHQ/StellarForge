"use client";

import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";

/**
 * LspManagerMount — connects Monaco to the rust-analyzer LSP server.
 *
 * CRITICAL: This component receives the Monaco instance from the EDITOR
 * (via onMount → monacoRef), NOT via a separate import("monaco-editor").
 *
 * Why: @monaco-editor/react loads Monaco from CDN (or node_modules),
 * which is a DIFFERENT instance from import("monaco-editor"). If the
 * LSP client uses the wrong instance, MonacoLanguageClient throws:
 *   "Default api is not ready yet, do not forget to import
 *    'vscode/localExtensionHost' and wait for services initialization"
 *
 * This happens because the two Monaco instances don't share the
 * editor API state — the LSP client's Monaco has no editor initialized.
 *
 * The parent (ide-shell.tsx) passes the monaco instance from the
 * editor's onMount callback via window.__monacoInstance.
 *
 * The LSP client is started ONLY when:
 *   1. The Monaco instance is available (editor mounted)
 *   2. A project is active (workspaceId is set)
 *   3. The LSP server is running (port 3099)
 *
 * If the LSP server is NOT running, the client fails gracefully —
 * the app works without LSP (uses the simpler autocomplete instead).
 */

export function LspManagerMount() {
  const [monaco, setMonaco] = useState<typeof Monaco | null>(null);

  // Poll for the Monaco instance from window.__monacoInstance (set by
  // the editor's onMount callback). We can't receive it as a prop because
  // ide-shell.tsx doesn't have direct access to the editor's monacoRef.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkInterval = setInterval(() => {
      const m = (window as unknown as { __monacoInstance?: typeof Monaco }).__monacoInstance;
      if (m) {
        clearInterval(checkInterval);
        setMonaco(m);
      }
    }, 500);

    // Give up after 30 seconds
    const timeout = setTimeout(() => clearInterval(checkInterval), 30000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!monaco) return;

    let cancelled = false;
    let cleanupFn: (() => void) | null = null;

    (async () => {
      try {
        const { createLspClient } = await import("@/lib/lsp/lsp-client");
        const { useFileSystemStore } = await import("@/stores/file-system-store");
        const { useProjectsStore } = await import("@/stores/projects-store");
        const sampleProject = await import("@/lib/soroban/sample-project");

        if (cancelled) return;

        const activeProjectId = useProjectsStore.getState().activeProjectId;
        const workspaceId = activeProjectId || "default";

        const tree = useFileSystemStore.getState().tree;
        const files = sampleProject.flattenFiles(tree).map((f) => ({
          path: f.path,
          content: f.content,
        }));

        const client = createLspClient({
          workspaceId,
          monaco,
          onStatusChange: (status) => {
            if (typeof window !== "undefined") {
              (window as unknown as { __lspStatus?: string }).__lspStatus = status;
            }
          },
        });

        await client.syncFiles(files);
        await client.start();
        console.log(`[lsp] client started for workspace: ${workspaceId}`);

        cleanupFn = () => {
          client.stop().catch(() => {});
        };
      } catch (err) {
        if (!cancelled) {
          console.warn(
            "[lsp] server not available — LSP features disabled. " +
            "Start it with: bun mini-services/lsp-server/index.ts"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
  }, [monaco]);

  return null;
}
