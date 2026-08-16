"use client";

import { create } from "zustand";
import { flattenFiles, type TreeNode } from "@/lib/soroban/sample-project";

/**
 * Test state — runs `cargo test` via POST /api/build (with command: "test"),
 * then polls GET /api/build/status?id=<testId> for output lines.
 *
 * Previously tried to use /api/build/test which doesn't exist — that's
 * why the Test button did nothing (404 → res.ok was false → silent failure).
 * Now we reuse the existing /api/build endpoint with command: "test".
 */

export type TestStatus = "idle" | "running" | "success" | "failed";

export interface TestLine {
  type: "stdout" | "stderr";
  text: string;
  ts: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

interface TestState {
  status: TestStatus;
  lines: TestLine[];
  testResults: TestResult[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  _testId?: string;
  _pollTimer?: ReturnType<typeof setTimeout>;

  runTests: (opts?: { tree?: TreeNode[] }) => Promise<void>;
  reset: () => void;
}

export const useTestStore = create<TestState>((set, get) => ({
  status: "idle",
  lines: [],
  testResults: [],

  runTests: async (opts = {}) => {
    if (get().status === "running") return;

    set({
      status: "running",
      lines: [],
      testResults: [],
      error: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
    });

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
          command: "test",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        set(() => ({
          status: "failed" as const,
          error: err.error ?? `HTTP ${res.status}`,
          finishedAt: Date.now(),
        }));
        return;
      }

      const { buildId } = await res.json();
      set(() => ({ _testId: buildId }));

      // Start polling
      pollTestStatus(buildId, set, get);
    } catch (err) {
      set(() => ({
        status: "failed" as const,
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      }));
    }
  },

  reset: () => {
    const { _pollTimer } = get();
    if (_pollTimer) clearTimeout(_pollTimer);
    set(() => ({
      status: "idle" as const,
      lines: [],
      testResults: [],
      error: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      _testId: undefined,
      _pollTimer: undefined,
    }));
  },
}));

async function pollTestStatus(
  testId: string,
  set: (fn: (s: TestState) => Partial<TestState>) => void,
  get: () => TestState
) {
  const MAX_RETRIES = 5;
  let retryCount = 0;

  async function doPoll() {
    try {
      const state = get();
      const since = state.lines.length > 0 ? state.lines[state.lines.length - 1].ts : 0;
      const res = await fetch(`/api/build/status?id=${testId}&since=${since}`);

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          set(() => ({
            status: "failed" as const,
            error: `Server unreachable after ${MAX_RETRIES} retries`,
            finishedAt: Date.now(),
            _testId: undefined,
            _pollTimer: undefined,
          }));
          return;
        }
        const timer = setTimeout(() => doPoll(), 2000);
        set(() => ({ _pollTimer: timer }));
        return;
      }

      retryCount = 0;

      if (!res.ok) {
        set(() => ({
          status: "failed" as const,
          error: `Test poll failed: ${res.status}`,
          finishedAt: Date.now(),
        }));
        return;
      }

      const data = await res.json() as {
        status: "building" | "success" | "failed";
        lines: TestLine[];
        error?: string;
        testResults?: TestResult[];
        finishedAt?: number;
      };

      if (data.lines.length > 0) {
        set((s) => ({ lines: [...s.lines, ...data.lines] }));
      }

      if (data.testResults && data.testResults.length > 0) {
        set(() => ({ testResults: data.testResults! }));
      }

      if (data.status === "success" || data.status === "failed") {
        set(() => ({
          status: data.status === "building" ? "running" : (data.status as TestStatus),
          error: data.error,
          finishedAt: data.finishedAt ?? Date.now(),
          _testId: undefined,
          _pollTimer: undefined,
        }));
        return;
      }

      const timer = setTimeout(() => doPoll(), 1000);
      set(() => ({ _pollTimer: timer }));
    } catch (err) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        set(() => ({
          status: "failed" as const,
          error: err instanceof Error ? err.message : String(err),
          finishedAt: Date.now(),
          _testId: undefined,
          _pollTimer: undefined,
        }));
        return;
      }
      const timer = setTimeout(() => doPoll(), 2000);
      set(() => ({ _pollTimer: timer }));
    }
  }

  const initialTimer = setTimeout(() => doPoll(), 1000);
  set(() => ({ _pollTimer: initialTimer }));
}
