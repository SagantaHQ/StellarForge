"use client";

import { create } from "zustand";
import { flattenFiles } from "@/lib/soroban/sample-project";

/**
 * §3 — Deploy state.
 *
 * Calls POST /api/deploy with the WASM file + source account secret +
 * network. The deploy API runs `stellar contract deploy` server-side and
 * streams progress.
 *
 * SECURITY: source account secrets are stored only in browser localStorage
 * (never sent to our server except as part of the deploy call). In production,
 * prefer signing via the browser wallet (stellar-appkit) rather than passing
 * secrets to the server.
 */

export type DeployStatus = "idle" | "deploying" | "success" | "failed";

export interface DeployLine {
  type: "stdout" | "stderr";
  text: string;
  ts: number;
}

interface DeployState {
  status: DeployStatus;
  lines: DeployLine[];
  contractId?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;

  deploy: (opts: {
    network: string;
    sourceAccountSecret: string;
    wasmPath?: string;
  }) => Promise<void>;
  reset: () => void;
}

export const useDeployStore = create<DeployState>((set, get) => ({
  status: "idle",
  lines: [],

  deploy: async (opts) => {
    if (get().status === "deploying") return;

    set({
      status: "deploying",
      lines: [],
      error: undefined,
      contractId: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
    });

    // Sync files to server first (so the WASM is available)
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const tree = useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({ path: f.path, content: f.content }));

    // Build first to ensure the WASM exists — use stellar contract build
    // (not cargo build) because we need the .wasm file for deployment
    try {
      const buildRes = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "local-project",
          files,
          command: "stellar",
        }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.json().catch(() => ({ error: buildRes.statusText }));
        set({
          status: "failed",
          error: `Build failed before deploy: ${err.error ?? buildRes.status}`,
          finishedAt: Date.now(),
        });
        return;
      }
      const { buildId } = await buildRes.json();

      // Poll build to completion
      const buildSuccess = await waitForBuild(buildId);
      if (!buildSuccess) {
        set({
          status: "failed",
          error: "Build failed — fix build errors before deploying",
          finishedAt: Date.now(),
        });
        return;
      }
    } catch (err) {
      set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      return;
    }

    // Now deploy
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "local-project",
          network: opts.network,
          sourceAccountSecret: opts.sourceAccountSecret,
          wasmPath: opts.wasmPath,
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

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        set({ status: "failed", error: "No response body", finishedAt: Date.now() });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventStr of events) {
          const lines = eventStr.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            if (event === "stdout" || event === "stderr") {
              set((s) => ({
                lines: [...s.lines, { type: event, text: parsed.line, ts: Date.now() }],
              }));
            } else if (event === "contractId") {
              set({ contractId: parsed.id });
            } else if (event === "error") {
              set({ status: "failed", error: parsed.message, finishedAt: Date.now() });
            } else if (event === "exit") {
              set({
                status: parsed.code === 0 ? "success" : "failed",
                error: parsed.code !== 0 ? `Deploy failed (exit ${parsed.code})` : undefined,
                finishedAt: Date.now(),
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  },

  reset: () =>
    set({
      status: "idle",
      lines: [],
      contractId: undefined,
      error: undefined,
      startedAt: undefined,
      finishedAt: undefined,
    }),
}));

async function waitForBuild(buildId: string, maxWaitMs = 180000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`/api/build/status?id=${buildId}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (data.status === "success") return true;
      if (data.status === "failed") return false;
    } catch {
      return false;
    }
  }
  return false;
}
