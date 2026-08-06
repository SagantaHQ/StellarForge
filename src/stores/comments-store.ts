"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createIDBStorage } from "@/lib/storage/zustand-idb-storage";

/**
 * §6 — File-level comments system.
 *
 * Data model mirrors the Postgres `Comment` table:
 *   id, project_id, file_path, line_number, line_snapshot, author_id,
 *   body, priority, status, created_at, resolved_at, resolved_by.
 *
 * Anchoring rules (§6.1, §5.4):
 * - Comments store both lineNumber AND lineSnapshot (content of the anchored line)
 * - When the file changes, we re-anchor by content match if line shifted
 * - If the anchored line is deleted, mark isOrphaned=true
 *
 * Realtime sync (§6.6): comment mutations broadcast over the collab WS channel.
 * Here we simulate with optimistic UI + a "remote echo" event.
 */

export type CommentPriority = "urgent" | "high" | "normal" | "low" | "suggestion";
export type CommentStatus = "open" | "resolved" | "deleted";

export interface Comment {
  id: string;
  projectPath: string; // scope key — project identifier
  filePath: string;
  lineNumber: number;
  lineSnapshot: string; // content of the anchored line at creation time
  anchorCrdtPos?: string; // CRDT position (placeholder for Yjs integration)
  authorId: string;
  authorName: string;
  authorAvatarColor: string;
  body: string;
  priority: CommentPriority;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolvedById?: string;
  resolvedByName?: string;
  isOrphaned: boolean;
}

interface CommentsState {
  comments: Comment[];
  /** Currently-active file path — switching files switches visible comment set */
  activeFilePath: string | null;
  /** Per-file floating panel positions (px from top-left of editor area) */
  panelPositions: Record<string, { x: number; y: number }>;
  /** Per-file panel collapse state */
  panelCollapsed: Record<string, boolean>;
  /** Currently focused comment thread (for click-to-scroll highlights) */
  focusedCommentId: string | null;
  /** Comments currently being added (inline input under line) */
  addingAt: { filePath: string; lineNumber: number } | null;

  setActiveFile: (path: string) => void;
  startAdding: (filePath: string, lineNumber: number) => void;
  cancelAdding: () => void;
  addComment: (input: {
    filePath: string;
    lineNumber: number;
    lineSnapshot: string;
    body: string;
    priority: CommentPriority;
    authorName: string;
    authorAvatarColor: string;
  }) => Comment;
  updateComment: (id: string, body: string) => void;
  setPriority: (id: string, priority: CommentPriority) => void;
  resolveComment: (id: string, resolverName: string) => void;
  unresolveComment: (id: string) => void;
  deleteComment: (id: string, requesterId: string) => boolean; // returns true if allowed
  reanchorComments: (filePath: string, newLines: string[]) => void;
  setPanelPosition: (filePath: string, pos: { x: number; y: number }) => void;
  setPanelCollapsed: (filePath: string, collapsed: boolean) => void;
  focusComment: (id: string | null) => void;
  getCommentsForFile: (filePath: string) => Comment[];
  getCommentsForLine: (filePath: string, line: number) => Comment[];
  getHighestPriorityForLine: (filePath: string, line: number) => CommentPriority | null;
}

const CURRENT_USER = {
  id: "local-user",
  name: "You",
  avatarColor: "#4F8C8C",
};

function colorFromAddress(addr: string): string {
  const palette = ["#4F8C8C", "#C5794B", "#7B96B3", "#6FA885", "#A88FB3", "#C9A66B", "#D29464", "#9A88A8"];
  let hash = 0;
  for (let i = 0; i < addr.length; i++) { hash = ((hash << 5) - hash) + addr.charCodeAt(i); hash |= 0; }
  return palette[Math.abs(hash) % palette.length];
}

// No seed comments — zero mocked data. Comments are created by real users
// and persisted to Postgres via /api/comments.
const SEED_COMMENTS: Comment[] = [];

export const useCommentsStore = create<CommentsState>()(
  persist(
    (set, get) => ({
      comments: SEED_COMMENTS,
      activeFilePath: "src/lib.rs",
      panelPositions: {},
      panelCollapsed: {},
      focusedCommentId: null,
      addingAt: null,

      setActiveFile: (path) => set({ activeFilePath: path, addingAt: null, focusedCommentId: null }),

      startAdding: (filePath, lineNumber) =>
        set({ addingAt: { filePath, lineNumber } }),

      cancelAdding: () => set({ addingAt: null }),

      addComment: (input) => {
        // Gate: must be logged in to comment
        // Lazy import to avoid circular dependency
        const profileState = (window as unknown as { __profileStore?: { isLoggedIn: () => boolean; profile: { address: string; username: string } | null } }).__profileStore;
        if (profileState && !profileState.isLoggedIn()) {
          return {} as Comment; // silently fail — UI should check before showing
        }
        const profile = profileState?.profile;
        const newComment: Comment = {
          id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          projectPath: "hello-world",
          filePath: input.filePath,
          lineNumber: input.lineNumber,
          lineSnapshot: input.lineSnapshot,
          anchorCrdtPos: `${input.filePath}:${input.lineNumber}`,
          authorId: profile?.address ?? CURRENT_USER.id,
          authorName: profile?.username ?? CURRENT_USER.name,
          authorAvatarColor: profile ? colorFromAddress(profile.address) : CURRENT_USER.avatarColor,
          body: input.body,
          priority: input.priority,
          status: "open",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isOrphaned: false,
        };
        set((s) => ({
          comments: [...s.comments, newComment],
          addingAt: null,
          focusedCommentId: newComment.id,
        }));
        // §6.5 — Sync to Postgres (fire-and-forget, optimistic UI)
        syncCommentToServer(newComment).catch(() => {});
        return newComment;
      },

      updateComment: (id, body) => {
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id ? { ...c, body, updatedAt: Date.now() } : c
          ),
        }));
        // §6.5 — Sync update to Postgres
        patchCommentOnServer(id, { body }).catch(() => {});
      },

      setPriority: (id, priority) => {
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id ? { ...c, priority, updatedAt: Date.now() } : c
          ),
        }));
        // §6.5 — Sync priority to Postgres
        patchCommentOnServer(id, { priority: priority.toUpperCase() }).catch(() => {});
      },

      resolveComment: (id, resolverName) => {
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "resolved",
                  resolvedAt: Date.now(),
                  resolvedById: CURRENT_USER.id,
                  resolvedByName: resolverName,
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
        // §6.5 — Sync resolve to Postgres
        patchCommentOnServer(id, { status: "RESOLVED", resolvedById: CURRENT_USER.id }).catch(() => {});
      },

      unresolveComment: (id) => {
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "open",
                  resolvedAt: undefined,
                  resolvedById: undefined,
                  resolvedByName: undefined,
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
        // §6.5 — Sync reopen to Postgres
        patchCommentOnServer(id, { status: "OPEN" }).catch(() => {});
      },

      deleteComment: (id, requesterId) => {
        const comment = get().comments.find((c) => c.id === id);
        if (!comment) return false;
        // §6.8 — only the comment's own author can delete (server-enforced)
        if (comment.authorId !== requesterId) return false;
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id ? { ...c, status: "deleted", updatedAt: Date.now() } : c
          ),
        }));
        // §6.5 — Sync delete to Postgres (server enforces author-only)
        deleteCommentOnServer(id, requesterId).catch(() => {});
        return true;
      },

      /**
       * Re-anchor comments when the file content changes.
       * Strategy (§5.4):
       * 1. Try to find the snapshot text in the new line array (within a small window)
       * 2. If found, update lineNumber
       * 3. If not found, mark as orphaned
       */
      reanchorComments: (filePath, newLines) => {
        set((s) => ({
          comments: s.comments.map((c) => {
            if (c.filePath !== filePath || c.status === "deleted") return c;
            // Search for the snapshot text near the original line number
            const snapshot = c.lineSnapshot.trim();
            if (!snapshot) return c;
            // Look in a ±10 line window first, then expand
            const searchWindow = 10;
            for (let offset = 0; offset < newLines.length; offset++) {
              for (const dir of [0, 1, -1]) {
                const candidateLine = c.lineNumber + dir * offset;
                if (candidateLine < 1 || candidateLine > newLines.length) continue;
                if (Math.abs(candidateLine - c.lineNumber) > searchWindow && offset > searchWindow) continue;
                if (newLines[candidateLine - 1]?.trim() === snapshot) {
                  return { ...c, lineNumber: candidateLine, isOrphaned: false };
                }
              }
              if (offset > searchWindow) break;
            }
            // Not found — mark as orphaned
            return { ...c, isOrphaned: true };
          }),
        }));
      },

      setPanelPosition: (filePath, pos) =>
        set((s) => ({
          panelPositions: { ...s.panelPositions, [filePath]: pos },
        })),

      setPanelCollapsed: (filePath, collapsed) =>
        set((s) => ({
          panelCollapsed: { ...s.panelCollapsed, [filePath]: collapsed },
        })),

      focusComment: (id) => set({ focusedCommentId: id }),

      getCommentsForFile: (filePath) => {
        return get()
          .comments.filter(
            (c) => c.filePath === filePath && c.status !== "deleted"
          )
          .sort((a, b) => {
            // Open comments first, then resolved
            if (a.status !== b.status) {
              return a.status === "open" ? -1 : 1;
            }
            // Sort by line number
            return a.lineNumber - b.lineNumber;
          });
      },

      getCommentsForLine: (filePath, line) =>
        get().comments.filter(
          (c) =>
            c.filePath === filePath &&
            c.lineNumber === line &&
            c.status !== "deleted"
        ),

      getHighestPriorityForLine: (filePath, line) => {
        const lineComments = get().getCommentsForLine(filePath, line);
        const openComments = lineComments.filter((c) => c.status === "open");
        if (openComments.length === 0) return null;
        const order: CommentPriority[] = ["urgent", "high", "normal", "low", "suggestion"];
        for (const p of order) {
          if (openComments.some((c) => c.priority === p)) return p;
        }
        return null;
      },
    }),
    {
      name: "soroban-build:comments",
      storage: createJSONStorage(() => createIDBStorage()),
      partialize: (s) => ({
        comments: s.comments,
        panelPositions: s.panelPositions,
        panelCollapsed: s.panelCollapsed,
      }),
    }
  )
);

export const COMMENT_PRIORITY_COLORS: Record<CommentPriority, string> = {
  urgent: "var(--priority-urgent)",
  high: "var(--priority-high)",
  normal: "var(--priority-normal)",
  low: "var(--priority-low)",
  suggestion: "var(--priority-suggestion)",
};

export const COMMENT_PRIORITY_LABELS: Record<CommentPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low / FYI",
  suggestion: "Suggestion",
};

export const COMMENT_PRIORITY_DOTS: Record<CommentPriority, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "🟡",
  low: "🔵",
  suggestion: "🟢",
};

// ============================================================
// §6.5 — Postgres sync helpers (fire-and-forget, optimistic UI)
// ============================================================

const PROJECT_ID = "local-project";

async function syncCommentToServer(comment: Comment): Promise<void> {
  await fetch("/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      filePath: comment.filePath,
      lineNumber: comment.lineNumber,
      lineSnapshot: comment.lineSnapshot,
      authorId: comment.authorId,
      body: comment.body,
      priority: comment.priority.toUpperCase(),
    }),
  });
}

async function patchCommentOnServer(id: string, updates: Record<string, unknown>): Promise<void> {
  await fetch("/api/comments", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...updates }),
  });
}

async function deleteCommentOnServer(id: string, requesterId: string): Promise<void> {
  await fetch(`/api/comments?id=${id}&requesterId=${requesterId}`, {
    method: "DELETE",
  });
}

/**
 * Fetch comments from Postgres and merge into the local store.
 * Called on app mount to sync server-side state.
 */
export async function fetchCommentsFromServer(filePath: string): Promise<void> {
  try {
    const res = await fetch(`/api/comments?projectId=${PROJECT_ID}&filePath=${encodeURIComponent(filePath)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.comments && Array.isArray(data.comments) && data.comments.length > 0) {
      // Merge server comments with local — server takes precedence for IDs that exist in both
      const local = useCommentsStore.getState().comments;
      const serverComments = data.comments.map((c: Record<string, unknown>) => c);
      const merged = [...local];
      for (const sc of serverComments) {
        const idx = merged.findIndex((lc) => lc.id === sc.id || (lc.filePath === sc.filePath && lc.lineNumber === sc.lineNumber && lc.body === sc.body));
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...sc };
        } else {
          // Don't add server comments to local — they may be from other users
          // and we don't want to duplicate. In a full implementation, this would
          // merge with proper conflict resolution.
        }
      }
      useCommentsStore.setState({ comments: merged });
    }
  } catch {
    // Silently fail — local-first means we work offline
  }
}
