"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type * as Monaco from "monaco-editor";
import {
  createLspClient,
  pathToLspUri,
  type LspClient,
  type LspStatus,
} from "./lsp-client";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProjectsStore } from "@/stores/projects-store";
import { flattenFiles } from "@/lib/soroban/sample-project";

/**
 * React hook that manages the LSP client lifecycle.
 *
 * - Starts the LSP client when a project is active
 * - Syncs project files to the server when they change (debounced)
 * - Stops the client when the project changes or unmounts
 * - Exposes the current LSP status for UI display
 *
 * The hook should be called once at the IDE shell level so there's a single
 * LSP client for the whole app.
 */
export function useLspManager(monaco: typeof Monaco | null) {
  const [status, setStatus] = useState<LspStatus>("disconnected");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const clientRef = useRef<LspClient | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedFilesRef = useRef<string>("");

  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const tree = useFileSystemStore((s) => s.tree);

  // Use the active project ID as the workspace ID, or fall back to "default"
  const effectiveWorkspaceId = activeProjectId || "default";

  // Start / restart the LSP client when the workspace changes
  useEffect(() => {
    if (!monaco) return;
    const m = monaco; // narrow to non-null for closures
    let cancelled = false;

    async function startClient() {
      // Stop any existing client
      if (clientRef.current) {
        await clientRef.current.stop();
        clientRef.current = null;
      }

      if (cancelled) return;

      const client = createLspClient({
        workspaceId: effectiveWorkspaceId,
        monaco: m,
        onStatusChange: (s) => setStatus(s),
      });

      clientRef.current = client;
      setWorkspaceId(effectiveWorkspaceId);

      try {
        // Sync the current files to the server before starting
        const files = flattenFiles(tree).map((f) => ({
          path: f.path,
          content: f.content,
        }));
        await client.syncFiles(files);
        lastSyncedFilesRef.current = JSON.stringify(
          files.map((f) => ({ path: f.path, content: f.content }))
        );

        await client.start();
        console.log(`[lsp] client started for workspace: ${effectiveWorkspaceId}`);
      } catch (err) {
        console.error("[lsp] failed to start client:", err);
        if (!cancelled) setStatus("error");
      }
    }

    startClient();

    return () => {
      cancelled = true;
      if (clientRef.current) {
        clientRef.current.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId, monaco]);

  // Sync files to the server when the file tree changes (debounced)
  const syncFiles = useCallback(() => {
    if (!clientRef.current) return;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

    syncTimerRef.current = setTimeout(async () => {
      if (!clientRef.current) return;
      try {
        const files = flattenFiles(tree).map((f) => ({
          path: f.path,
          content: f.content,
        }));
        const serialized = JSON.stringify(
          files.map((f) => ({ path: f.path, content: f.content }))
        );
        // Only sync if the files actually changed
        if (serialized !== lastSyncedFilesRef.current) {
          await clientRef.current.syncFiles(files);
          lastSyncedFilesRef.current = serialized;
          console.log(`[lsp] synced ${files.length} files to server`);
        }
      } catch (err) {
        console.warn("[lsp] file sync failed:", err);
      }
    }, 1000); // 1s debounce
  }, [tree]);

  // Watch the file tree for changes
  useEffect(() => {
    if (!clientRef.current) return;
    syncFiles();
  }, [tree, syncFiles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (clientRef.current) {
        clientRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return {
    status,
    workspaceId,
    syncFiles,
    /** Get the file URI for a Monaco model path. */
    getFileUri: (filePath: string) =>
      pathToLspUri(effectiveWorkspaceId, filePath),
  };
}
