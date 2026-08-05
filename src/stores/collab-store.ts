"use client";

import { create } from "zustand";
import * as Y from "yjs";

/**
 * §5 — Live collaboration (CRDT-based).
 *
 * Uses Yjs for CRDT-based collaborative editing. For same-browser
 * multi-tab sync (demo), uses BroadcastChannel — no external servers
 * needed. Open two tabs to the same URL and edits sync in realtime.
 *
 * Production: swap BroadcastChannel for y-websocket (§5.4 hardening)
 * to enable cross-browser/cross-device collaboration.
 */

interface CollabProvider {
  destroy: () => void;
  awareness: {
    setLocalStateField: (key: string, value: unknown) => void;
    getLocalState: () => Record<string, unknown> | null;
    getStates: () => Map<number, Record<string, unknown>>;
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
}

/** Simple presence map — avoids y-protocols/awareness dependency. */
class SimpleAwareness {
  private localState: Record<string, unknown> = {};
  private states = new Map<number, Record<string, unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  private clientId: number;

  constructor(ydoc: Y.Doc) {
    this.clientId = ydoc.clientID;
    this.states.set(this.clientId, {});
  }

  setLocalStateField(key: string, value: unknown) {
    this.localState[key] = value;
    this.states.set(this.clientId, { ...this.localState });
    this.emit("change");
  }

  getLocalState() {
    return this.localState;
  }

  getStates() {
    return this.states;
  }

  /** Called when a remote presence update arrives via BroadcastChannel. */
  setRemoteState(clientId: number, state: Record<string, unknown>) {
    this.states.set(clientId, state);
    this.emit("change");
  }

  on(event: string, handler: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: () => void) {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string) {
    this.listeners.get(event)?.forEach((h) => h());
  }

  destroy() {
    this.listeners.clear();
    this.states.clear();
  }
}

/** Create a BroadcastChannel-based provider for same-origin tab sync. */
function createBroadcastProvider(roomId: string, ydoc: Y.Doc): CollabProvider {
  const channel = new BroadcastChannel(`soroban-build-collab-${roomId}`);
  const awareness = new SimpleAwareness(ydoc);

  // Sync Yjs updates over BroadcastChannel
  ydoc.on("update", (update: Uint8Array) => {
    channel.postMessage({ type: "update", update: Array.from(update) });
  });

  channel.onmessage = (event) => {
    const data = event.data;
    if (data.type === "update" && Array.isArray(data.update)) {
      Y.applyUpdate(ydoc, new Uint8Array(data.update));
    } else if (data.type === "presence") {
      awareness.setRemoteState(data.clientId, data.state);
    }
  };

  // Broadcast presence changes
  awareness.on("change", () => {
    const state = awareness.getLocalState();
    channel.postMessage({ type: "presence", clientId: ydoc.clientID, state });
  });

  return {
    destroy: () => {
      channel.close();
      awareness.destroy();
    },
    awareness,
  };
}

/**
 * §5 — Live collaboration (CRDT-based).
 *
 * Uses Yjs for CRDT-based collaborative editing:
 *   - Each file gets its own Y.Text instance
 *   - y-monaco binds the Monaco editor to the Y.Text
 *   - WebRTC provider connects peers (uses public signaling servers
 *     for demo; production uses a dedicated y-websocket server)
 *   - Awareness protocol tracks presence (name, color, cursor)
 *
 * §5.2 — Line attribution markers:
 *   - Y.Text has a delta history; we track which user last edited each line
 *   - Shown as colored left-border segments in the Monaco gutter
 *   - Hover → tooltip with username + timestamp
 *
 * §5.1 — Sharing model:
 *   - Public sharing via URL: generate a room ID, encode in the URL hash
 *   - Anyone with the link joins the Yjs room
 *   - Private sharing by username: invite specific users (requires auth)
 */

export interface CollabUser {
  clientId: number;
  name: string;
  color: string;
  cursor?: { line: number; column: number };
  selection?: { startLine: number; startCol: number; endLine: number; endCol: number };
}

interface CollabState {
  /** Whether the user has joined a collaboration session */
  connected: boolean;
  /** Room ID — derived from share URL hash or auto-generated */
  roomId: string | null;
  /** The Yjs document for the current session */
  ydoc: Y.Doc | null;
  /** The collaboration provider (BroadcastChannel for demo, y-websocket for production) */
  provider: CollabProvider | null;
  /** Currently connected users (presence) */
  users: CollabUser[];
  /** Whether the share dialog is open */
  shareDialogOpen: boolean;
  /** The user's display name + color for this session */
  localUser: { name: string; color: string } | null;

  joinSession: (roomId: string, user: { name: string; color: string }) => Promise<void>;
  leaveSession: () => void;
  setShareDialogOpen: (open: boolean) => void;
  getOrCreateText: (filePath: string) => Y.Text | null;
  updatePresence: (presence: Partial<CollabUser>) => void;
}

/** Generate a random room ID for sharing */
export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Get or create a room ID from the URL hash */
export function getRoomIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/room=([a-z0-9]+)/);
  return match?.[1] ?? null;
}

/** Set the room ID in the URL hash (for shareable links) */
export function setRoomIdInUrl(roomId: string | null) {
  if (typeof window === "undefined") return;
  if (roomId) {
    window.location.hash = `room=${roomId}`;
  } else {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export const useCollabStore = create<CollabState>((set, get) => ({
  connected: false,
  roomId: null,
  ydoc: null,
  provider: null,
  users: [],
  shareDialogOpen: false,
  localUser: null,

  joinSession: async (roomId, user) => {
    // Leave any existing session first
    const existing = get();
    if (existing.provider) {
      existing.provider.destroy();
    }
    if (existing.ydoc) {
      existing.ydoc.destroy();
    }

    const ydoc = new Y.Doc();
    const provider = createBroadcastProvider(roomId, ydoc);

    // Set local presence
    provider.awareness.setLocalStateField("user", {
      name: user.name,
      color: user.color,
    });

    // Listen for presence changes
    provider.awareness.on("change", () => {
      const awarenessStates = Array.from(provider.awareness.getStates().entries());
      const users: CollabUser[] = awarenessStates.map(([clientId, state]) => ({
        clientId,
        name: state.user?.name ?? "Anonymous",
        color: state.user?.color ?? "#888888",
        cursor: state.cursor,
        selection: state.selection,
      }));
      set({ users });
    });

    set({
      connected: true,
      roomId,
      ydoc,
      provider,
      localUser: user,
    });

    setRoomIdInUrl(roomId);
  },

  leaveSession: () => {
    const { provider, ydoc } = get();
    if (provider) {
      provider.destroy();
    }
    if (ydoc) {
      ydoc.destroy();
    }
    set({
      connected: false,
      roomId: null,
      ydoc: null,
      provider: null,
      users: [],
      localUser: null,
    });
    setRoomIdInUrl(null);
  },

  setShareDialogOpen: (open) => set({ shareDialogOpen: open }),

  getOrCreateText: (filePath: string) => {
    const { ydoc } = get();
    if (!ydoc) return null;
    return ydoc.getText(`file:${filePath}`);
  },

  updatePresence: (presence) => {
    const { provider } = get();
    if (!provider) return;
    // Merge with existing local state
    const current = provider.awareness.getLocalState() ?? {};
    provider.awareness.setLocalStateField("cursor", presence.cursor);
    provider.awareness.setLocalStateField("selection", presence.selection);
  },
}));
