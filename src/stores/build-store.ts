"use client";

import { create } from "zustand";

/**
 * Build state — tracks whether a `soroban contract build` is in flight.
 *
 * In production this triggers a real compile via the sandboxed Docker terminal
 * (§7, §15.4). For now it simulates the build with a 1.2s delay and surfaces
 * the result in the Compile panel + terminal.
 */

export type BuildStatus = "idle" | "building" | "success" | "failed";

interface BuildState {
  status: BuildStatus;
  lastOutput?: string;
  lastError?: string;
  startedAt?: number;
  finishedAt?: number;

  startBuild: () => Promise<void>;
  reset: () => void;
}

const SIMULATED_OUTPUT = `📦 Cargo building...
   Compiling hello-world v0.1.0 (/workspace)
    Finished release [optimized] target(s) in 1.18s
✨ Built hello_world.wasm
   Path: target/wasm32v1-none/release/hello_world.wasm
   Size: 4.2 KB
   Target: wasm32v1-none`;

export const useBuildStore = create<BuildState>((set, get) => ({
  status: "idle",

  startBuild: async () => {
    if (get().status === "building") return;
    set({
      status: "building",
      startedAt: Date.now(),
      lastError: undefined,
      lastOutput: undefined,
    });
    // Simulate compile time. Real impl: POST /api/build → stream stdout.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    set({
      status: "success",
      finishedAt: Date.now(),
      lastOutput: SIMULATED_OUTPUT,
    });
  },

  reset: () =>
    set({
      status: "idle",
      lastOutput: undefined,
      lastError: undefined,
      startedAt: undefined,
      finishedAt: undefined,
    }),
}));
