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
  /** Internal: build ID from the server + polling timer */
  _buildId?: string;
  _pollTimer?: ReturnType<typeof setTimeout>;

  startBuild: (opts?: { tree?: TreeNode[] }) => Promise<void>;
  reset: () => void;
  clearOutput: () => void;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  status: "idle",
  lines: [],

  startBuild: async (opts = {}) => {
    if (get().status === "building") return;

    set({
      status: "building",
      lines: [],
      error: undefined,
      wasmInfo: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
    });

    // Build the files list from the in-browser file system store
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const tree = opts.tree ?? useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({ path: f.path, content: f.content }));

    try {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "local-project",
          files,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        set({
          status: "failed",
          error: err.error ?? `HTTP ${res.status}`,
          finishedAt: Date.now(),
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
  try {
    const state = get();
    const since = state.lines.length > 0 ? state.lines[state.lines.length - 1].ts : 0;
    const res = await fetch(`/api/build/status?id=${buildId}&since=${since}`);
    if (!res.ok) {
      set({ status: "failed", error: `Status poll failed: ${res.status}`, finishedAt: Date.now() });
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
      set({ wasmInfo: data.wasmInfo });
    }

    // Check if done
    if (data.status === "success" || data.status === "failed") {
      set({
        status: data.status,
        error: data.error,
        finishedAt: data.finishedAt ?? Date.now(),
        _buildId: undefined,
        _pollTimer: undefined,
      });
      return;
    }

    // Schedule next poll
    const timer = setTimeout(() => pollStatus(buildId, set, get), 500);
    set({ _pollTimer: timer });
  } catch (err) {
    set({
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
      _pollTimer: undefined,
    });
  }
}
