"use client";

import { create } from "zustand";

/**
 * §9.7 — Bridge between terminal 'Fix with AI' and the AI agent panel.
 *
 * When the user clicks 'Fix with AI' in the terminal, this store captures
 * the error context. The agent panel reads it on next render and auto-sends
 * a fix request to the configured provider.
 */

interface FixWithAIState {
  /** Pending fix request — set by terminal, consumed by agent panel */
  pendingFix: {
    errorOutput: string;
    command: string;
    ts: number;
  } | null;

  /** Submit a fix request from the terminal */
  requestFix: (errorOutput: string, command: string) => void;
  /** Consume the pending fix (agent panel calls this after sending) */
  consumeFix: () => void;
}

export const useFixWithAIStore = create<FixWithAIState>((set) => ({
  pendingFix: null,

  requestFix: (errorOutput, command) =>
    set({
      pendingFix: {
        errorOutput,
        command,
        ts: Date.now(),
      },
    }),

  consumeFix: () => set({ pendingFix: null }),
}));
