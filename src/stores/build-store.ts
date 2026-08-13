"use client";

import { create } from "zustand";
import { flattenFiles, type TreeNode } from "@/lib/soroban/sample-project";

/**
 * §3 / §7 — Build state.
 *
 * Starts a `soroban contract build` (or `cargo build`) via POST /api/build,
 * then polls GET /api/build/status?id=<buildId> every 500ms for output lines.
 *
 * The build runs server-side against the workspace files (synced from the
 * in-browser file system store). Production hardening (§15.4):
 *   - Per-session isolated container (gVisor/Firecracker)
 *   - Non-root user
 *   - Resource limits: CPU, RAM, disk quota, command timeout
 *   - Egress allowlist: crates.io, static.crates.io, rpc.stellar.org,
 *     horizon.stellar.org, github.com
 */

export type BuildStatus = "idle" | "building" | "success" | "failed";

export interface BuildLine {
  type: "stdout" | "stderr";
  text: string;
  ts: number;
}

interface BuildState {
  status: BuildStatus;
  lines: BuildLine[];
  wasmInfo?: { path: string; sizeBytes: number };
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Whether the current build is silent (auto-build, no UI loading spinner) */
  silent?: boolean;
  /** Internal: build ID from the server + polling timer */
  _buildId?: string;
  _pollTimer?: ReturnType<typeof setTimeout>;

  startBuild: (opts?: { tree?: TreeNode[]; command?: "stellar" | "cargo"; silent?: boolean; projectName?: string }) => Promise<void>;
  reset: () => void;
  clearOutput: () => void;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  status: "idle",
  lines: [],
  silent: false,

  startBuild: async (opts = {}) => {
    if (get().status === "building") return;

    set({
      status: "building",
      lines: [],
      error: undefined,
      wasmInfo: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
      silent: opts.silent ?? false,
    });

    // Build the files list from the in-browser file system store
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const tree = opts.tree ?? useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({ path: f.path, content: f.content }));

    // Guard: don't build if there are no files loaded yet.
    // This happens when a project is opened on a new device — the files
    // are being fetched from the server, and the build would fail with
    // "Missing projectId or files" error.
    if (files.length === 0) {
      set({
        status: "failed",
        error: "No files loaded. Wait for the project to finish loading before building.",
        finishedAt: Date.now(),
      });
      return;
    }

    // Get the real project ID from the projects store (not hardcoded)
    const { useProjectsStore } = await import("@/stores/projects-store");
    const activeProject = useProjectsStore.getState().getActiveProject();
    const projectId = activeProject?.serverProjectId ?? activeProject?.id ?? "local-project";

    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: opts.projectName ?? activeProject?.name,
          files,
          command: opts.command ?? "stellar",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        set({
          status: "failed",
          error: err.error ?? `HTTP ${res.status}`,
          finishedAt: Date.now(),
          // Surface CLI-not-installed detail if provided
          lines: err.detail
            ? [{ type: "stderr" as const, text: err.detail, ts: Date.now() }]
            : [],
        });
        return;
      }

      const { buildId } = await res.json();
      set({ _buildId: buildId });

      // Start polling for status
      pollStatus(buildId, set, get);
    } catch (err) {
      set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  },

  reset: () => {
    const { _pollTimer } = get();
    if (_pollTimer) clearTimeout(_pollTimer);
    set({
      status: "idle",
      lines: [],
      wasmInfo: undefined,
      error: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      _buildId: undefined,
      _pollTimer: undefined,
    });
  },

  clearOutput: () => set({ lines: [] }),
}));

async function pollStatus(
  buildId: string,
  set: (fn: (s: BuildState) => Partial<BuildState>) => void,
  get: () => BuildState
) {
  // Retry counter for transient errors (502, 503, network failures).
  // The build process is CPU/memory-intensive and can make the server
  // temporarily unresponsive — a 502 from the proxy during a build is
  // normal and should be retried, not treated as a build failure.
  const MAX_RETRIES = 5;
  let retryCount = 0;

  async function doPoll() {
    try {
      const state = get();
      const since = state.lines.length > 0 ? state.lines[state.lines.length - 1].ts : 0;
      const res = await fetch(`/api/build/status?id=${buildId}&since=${since}`);

      // Transient errors: 502 (bad gateway), 503 (service unavailable),
      // 504 (gateway timeout) — these happen when the server is busy
      // running the build and the proxy can't reach it. Retry instead
      // of failing.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          set(() => ({
            status: "failed" as const,
            error: `Server unreachable after ${MAX_RETRIES} retries (last: ${res.status}). The build may still be running — check back in a moment.`,
            finishedAt: Date.now(),
            _buildId: undefined,
            _pollTimer: undefined,
          }));
          return;
        }
        // Wait 2s before retrying (longer than normal poll interval)
        const timer = setTimeout(() => doPoll(), 2000);
        set(() => ({ _pollTimer: timer }));
        return;
      }

      // Reset retry counter on successful response
      retryCount = 0;

      if (!res.ok) {
        // 404 = build job not found (server restarted, job expired, or
        // the build hasn't started yet). Retry a few times before giving up.
        if (res.status === 404) {
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            set(() => ({
              status: "failed" as const,
              error: "Build job not found. The server may have restarted. Try building again.",
              finishedAt: Date.now(),
              _buildId: undefined,
              _pollTimer: undefined,
            }));
            return;
          }
          const timer = setTimeout(() => doPoll(), 2000);
          set(() => ({ _pollTimer: timer }));
          return;
        }
        // 500 = actual server error
        set(() => ({
          status: "failed" as const,
          error: `Status poll failed: ${res.status}`,
          finishedAt: Date.now(),
        }));
        return;
      }

      const data = await res.json() as {
        status: "building" | "success" | "failed";
        lines: BuildLine[];
        wasmInfo?: { path: string; sizeBytes: number };
        error?: string;
        finishedAt?: number;
      };

      // Append new lines
      if (data.lines.length > 0) {
        set((s) => ({ lines: [...s.lines, ...data.lines] }));
      }

      // Update wasm info if present
      if (data.wasmInfo) {
        set(() => ({ wasmInfo: data.wasmInfo }));
      }

      // Check if done
      if (data.status === "success" || data.status === "failed") {
        set(() => ({
          status: data.status,
          error: data.error,
          finishedAt: data.finishedAt ?? Date.now(),
          _buildId: undefined,
          _pollTimer: undefined,
        }));

        // On successful build, trigger dep index generation for autocomplete.
        // This generates rustdoc symbol indexes for all Cargo.toml deps,
        // cached per package@version. Runs in the background — doesn't block.
        if (data.status === "success") {
          triggerDepIndexBuild().catch(() => {});
        }
        return;
      }

      // Schedule next poll (1s interval — balances responsiveness with
      // not hammering the server while it's compiling)
      const timer = setTimeout(() => doPoll(), 1000);
      set(() => ({ _pollTimer: timer }));
    } catch (err) {
      // Network error (fetch failed) — retry if we haven't exhausted retries
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        set(() => ({
          status: "failed" as const,
          error: err instanceof Error ? err.message : String(err),
          finishedAt: Date.now(),
          _buildId: undefined,
          _pollTimer: undefined,
        }));
        return;
      }
      // Retry after 2s
      const timer = setTimeout(() => doPoll(), 2000);
      set(() => ({ _pollTimer: timer }));
    }
  }

  // Initial delay before first poll — short so the first "Build started"
  // line appears quickly. The server pushes initial log lines immediately.
  const initialTimer = setTimeout(() => doPoll(), 250);
  set(() => ({ _pollTimer: initialTimer }));
}

/**
 * Trigger rustdoc symbol index generation for all Cargo.toml dependencies.
 * Called after a successful build. Runs in the background — doesn't block.
 * Indexes are cached per package@version, so this only generates new ones
 * for deps that haven't been indexed before.
 */
async function triggerDepIndexBuild(): Promise<void> {
  try {
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const { flattenFiles } = await import("@/lib/soroban/sample-project");

    const tree = useFileSystemStore.getState().tree;
    const files = flattenFiles(tree);
    const cargoFile = files.find((f) => f.path === "Cargo.toml" || f.path.endsWith("/Cargo.toml"));

    if (!cargoFile) return;

    const res = await fetch("/api/autocomplete/build-deps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cargoToml: cargoFile.content }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(
        `[autocomplete] dep indexes: ${data.indexes?.length ?? 0} crates, ` +
        `${data.indexes?.reduce((acc: number, i: { total_count: number }) => acc + (i.total_count || 0), 0) ?? 0} total symbols`
      );
    }
  } catch (err) {
    console.warn("[autocomplete] failed to build dep indexes:", err);
  }
}
