"use client";

import { create } from "zustand";

/**
 * §5.2 — Line attribution markers.
 *
 * Tracks which user last edited each line of each file. Shown as colored
 * left-border segments in the Monaco gutter. Hover → tooltip with
 * username + timestamp.
 *
 * In a full CRDT implementation, this would be derived from the Yjs document's
 * delta history. Here we track edits as they happen (via the file system
 * store's updateFileContent) and store per-line authorship.
 *
 * AI edits (§9.9) are attributed as "{username} via AI agent ({provider}/{model})".
 */

export interface LineAttribution {
  /** User ID (wallet address or 'local-user') */
  authorId: string;
  /** Display name */
  authorName: string;
  /** Avatar color */
  authorColor: string;
  /** Timestamp of the edit */
  timestamp: number;
  /** Whether this was an AI-assisted edit */
  viaAI?: boolean;
  /** AI provider/model if viaAI */
  aiProvider?: string;
  aiModel?: string;
}

interface AttributionState {
  /** Map: filePath → lineNumber → attribution */
  attributions: Record<string, Record<number, LineAttribution>>;
  /** Whether attribution markers are visible */
  visible: boolean;

  /** Record an edit to a specific line range */
  recordEdit: (
    filePath: string,
    startLine: number,
    endLine: number,
    author: { id: string; name: string; color: string },
    viaAI?: { provider: string; model: string }
  ) => void;
  /** Get attribution for a specific line */
  getAttribution: (filePath: string, line: number) => LineAttribution | null;
  /** Get all attributions for a file */
  getFileAttributions: (filePath: string) => Record<number, LineAttribution>;
  /** Toggle visibility */
  toggle: () => void;
  /** Clear attributions for a file (e.g. on file delete) */
  clearFile: (filePath: string) => void;
}

export const useAttributionStore = create<AttributionState>((set, get) => ({
  attributions: {},
  visible: true,

  recordEdit: (filePath, startLine, endLine, author, viaAI) => {
    set((s) => {
      const fileAttribs = { ...(s.attributions[filePath] ?? {}) };
      const ts = Date.now();
      for (let line = startLine; line <= endLine; line++) {
        fileAttribs[line] = {
          authorId: author.id,
          authorName: viaAI
            ? `${author.name} via AI`
            : author.name,
          authorColor: author.color,
          timestamp: ts,
          viaAI: !!viaAI,
          aiProvider: viaAI?.provider,
          aiModel: viaAI?.model,
        };
      }
      return {
        attributions: { ...s.attributions, [filePath]: fileAttribs },
      };
    });
  },

  getAttribution: (filePath, line) => {
    const fileAttribs = get().attributions[filePath];
    if (!fileAttribs) return null;
    return fileAttribs[line] ?? null;
  },

  getFileAttributions: (filePath) => {
    return get().attributions[filePath] ?? {};
  },

  toggle: () => set((s) => ({ visible: !s.visible })),

  clearFile: (filePath) =>
    set((s) => {
      const newAttribs = { ...s.attributions };
      delete newAttribs[filePath];
      return { attributions: newAttribs };
    }),
}));
