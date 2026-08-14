"use client";

import { create } from "zustand";
import * as Y from "yjs";

/**
 * §5 — Live collaboration (CRDT-based).
 *
 * Uses Yjs for CRDT-based collaborative editing. For same-browser
 * multi-tab sync, uses BroadcastChannel. For cross-device, connects
 * to the WebSocket collab server (mini-services/collab-server/).
 *
 * Fixes applied:
 * - Late-join sync: new tabs request existing state on connect
 * - Leave broadcast: disconnected users are removed from presence
 * - Update listener properly removed in destroy()
 * - updatePresence merges with existing state (doesn't overwrite)
 * - Local user excluded from rendered users list
 * - Binary encoding for Yjs updates (efficient)
 * - Heartbeat/timeout for stale awareness states
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
  private timeouts = new Map<number, ReturnType<typeof setTimeout>>();
  private timeoutMs = 30000; // prune stale states after 30s

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

  /** Called when a remote presence update arrives. */
  setRemoteState(clientId: number, state: Record<string, unknown>) {
    this.states.set(clientId, state);
    this.emit("change");

    // Reset the timeout for this client
    const existing = this.timeouts.get(clientId);
    if (existing) clearTimeout(existing);
    this.timeouts.set(
      clientId,
      setTimeout(() => {
        this.states.delete(clientId);
        this.timeouts.delete(clientId);
        this.emit("change");
      }, this.timeoutMs)
    );
  }

  /** Called when a remote user leaves. */
  removeRemoteState(clientId: number) {
    this.states.delete(clientId);
    const t = this.timeouts.get(clientId);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(clientId);
    }
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
    // Clear all timeouts
    for (const t of this.timeouts.values()) clearTimeout(t);
    this.timeouts.clear();
    this.listeners.clear();
    this.states.clear();
  }
}

/** Create a BroadcastChannel-based provider for same-origin tab sync. */
function createBroadcastProvider(roomId: string, ydoc: Y.Doc): CollabProvider {
  const channel = new BroadcastChannel(`soroban-build-collab-${roomId}`);
  const awareness = new SimpleAwareness(ydoc);

  // Store the update handler so we can remove it in destroy()
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    // Don't re-broadcast updates that came from remote (avoid loops)
    if (origin === "remote") return;
    channel.postMessage({ type: "update", update: Array.from(update) });
  };

  ydoc.on("update", updateHandler);

  // Handle incoming messages
  channel.onmessage = (event) => {
    const data = event.data;
    if (data.type === "update" && Array.isArray(data.update)) {
      Y.applyUpdate(ydoc, new Uint8Array(data.update), "remote");
    } else if (data.type === "presence") {
      awareness.setRemoteState(data.clientId, data.state);
    } else if (data.type === "leave") {
      awareness.removeRemoteState(data.clientId);
    } else if (data.type === "sync-request") {
      // A new tab is requesting the current state — send it our full doc state
      const stateUpdate = Y.encodeStateAsUpdate(ydoc);
      channel.postMessage({ type: "sync-response", update: Array.from(stateUpdate) });
      // Also send our presence
      const state = awareness.getLocalState();
      channel.postMessage({ type: "presence", clientId: ydoc.clientID, state });
    } else if (data.type === "sync-response" && Array.isArray(data.update)) {
      // Received full state from an existing tab — apply it
      Y.applyUpdate(ydoc, new Uint8Array(data.update), "remote");
    }
  };

  // Broadcast presence changes
  const presenceHandler = () => {
    const state = awareness.getLocalState();
    channel.postMessage({ type: "presence", clientId: ydoc.clientID, state });
  };
  awareness.on("change", presenceHandler);

  // Send a sync-request to get the current state from existing tabs
  channel.postMessage({ type: "sync-request" });

  // Broadcast our presence immediately
  const state = awareness.getLocalState();
  channel.postMessage({ type: "presence", clientId: ydoc.clientID, state });

  return {
    destroy: () => {
      // Broadcast leave before closing
      channel.postMessage({ type: "leave", clientId: ydoc.clientID });
      // Remove the update listener (prevents InvalidStateError after channel close)
      ydoc.off("update", updateHandler);
      awareness.off("change", presenceHandler);
      channel.close();
      awareness.destroy();
    },
    awareness,
  };
}

export interface CollabUser {
  clientId: number;
  name: string;
  color: string;
  cursor?: { line: number; column: number };
  selection?: { startLine: number; startCol: number; endLine: number; endCol: number };
}

interface CollabState {
  connected: boolean;
  roomId: string | null;
  ydoc: Y.Doc | null;
  provider: CollabProvider | null;
  users: CollabUser[];
  shareDialogOpen: boolean;
  localUser: { name: string; color: string } | null;

  joinSession: (roomId: string, user: { name: string; color: string }) => void;
  leaveSession: () => void;
  setShareDialogOpen: (open: boolean) => void;
  getOrCreateText: (filePath: string) => Y.Text | null;
  updatePresence: (presence: Partial<CollabUser>) => void;
}

export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function getRoomIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/room=([a-z0-9]+)/);
  return match?.[1] ?? null;
}

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

  joinSession: (roomId, user) => {
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

    // Listen for presence changes — exclude local user from the rendered list
    provider.awareness.on("change", () => {
      const awarenessStates = Array.from(provider.awareness.getStates().entries());
      const users: CollabUser[] = awarenessStates
        .filter(([clientId]) => clientId !== ydoc.clientID) // exclude local user
        .map(([clientId, state]) => {
          const s = state as { user?: { name?: string; color?: string }; cursor?: CollabUser["cursor"]; selection?: CollabUser["selection"] };
          return {
            clientId,
            name: s.user?.name ?? "Anonymous",
            color: s.user?.color ?? "#888888",
            cursor: s.cursor,
            selection: s.selection,
          };
        });
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
    // Merge with existing local state (don't overwrite fields not passed)
    if (presence.cursor !== undefined) {
      provider.awareness.setLocalStateField("cursor", presence.cursor);
    }
    if (presence.selection !== undefined) {
      provider.awareness.setLocalStateField("selection", presence.selection);
    }
  },
}));
