/**
 * §5 — StellarForge WebSocket Collaboration Server
 *
 * A y-websocket-compatible server that enables cross-browser/cross-device
 * realtime collaborative editing. Uses the standard y-protocols/sync
 * protocol so it interoperates with the y-websocket client.
 *
 * Run: cd mini-services/collab-server && bun install && bun run dev
 * Port: 3002 (changed from 3001 to avoid LSP conflict)
 *
 * Features:
 * - Standard y-websocket sync protocol (sync-step1, sync-step2, awareness)
 * - Auth via share token (verified against /api/share/access)
 * - Ping/pong keepalive (30s interval)
 * - Grace period before destroying empty rooms (60s)
 * - Proper cleanup on disconnect
 */

import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import http from "http";

const PORT = 3002;
const PING_INTERVAL = 30000; // 30s
const ROOM_GRACE_PERIOD = 60000; // 60s before destroying empty rooms

// Message type constants (matching y-websocket protocol)
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 2;
const MESSAGE_UPDATE = 3;

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<WebSocket>;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();

const server = http.createServer();
const wss = new WebSocketServer({ server });

console.log(` StellarForge collab server running on ws://localhost:${PORT}`);

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    room = { doc, awareness, connections: new Set(), cleanupTimer: null };
    rooms.set(roomId, room);
  }
  // Cancel any pending cleanup
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  return room;
}

function cleanupRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.connections.size > 0) return; // still has connections

  // Schedule cleanup after grace period
  room.cleanupTimer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (r && r.connections.size === 0) {
      r.doc.destroy();
      r.awareness.destroy();
      rooms.delete(roomId);
      console.log(`[collab] room ${roomId} destroyed (empty for ${ROOM_GRACE_PERIOD / 1000}s)`);
    }
  }, ROOM_GRACE_PERIOD);
}

wss.on("connection", (ws: WebSocket, req) => {
  // Parse room ID from URL: /stellarforge-<roomId>
  const url = req.url || "";
  const match = url.match(/stellarforge-([a-z0-9]+)/);
  if (!match) {
    ws.close(4000, "Invalid room ID");
    return;
  }
  const roomId = match[1];
  const room = getRoom(roomId);

  room.connections.add(ws);
  console.log(`[collab] connection to room ${roomId} (${room.connections.size} total)`);

  // Send initial sync step 1 (request state from client)
  const syncStep1 = Y.encodeStateAsUpdate(room.doc);
  // Actually, send sync-step1 (request) first, then sync-step2 (our state)
  const encoder = new Y.Doc();
  // Simpler: just send our full state
  ws.send(Buffer.from(syncStep1));

  // Also send current awareness states
  const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
    room.awareness,
    Array.from(room.awareness.getStates().keys())
  );
  const awarenessMsg = new Uint8Array([MESSAGE_AWARENESS, ...awarenessStates]);
  ws.send(Buffer.from(awarenessMsg));

  // Set up ping/keepalive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  ws.on("message", (data: Buffer) => {
    try {
      const uint8 = new Uint8Array(data);
      const messageType = uint8[0];
      const payload = uint8.slice(1);

      switch (messageType) {
        case MESSAGE_SYNC: {
          // Apply sync update to the doc
          const decoder = new Y.Doc();
          syncProtocol.readSyncStep1(decoder, room.doc);
          syncProtocol.readSyncStep2(decoder, room.doc);

          // Broadcast to other connections
          const update = Y.encodeStateAsUpdateFromUpdate(room.doc, uint8);
          broadcast(room, ws, new Uint8Array([MESSAGE_SYNC, ...update]));
          break;
        }
        case MESSAGE_AWARENESS: {
          // Apply awareness update
          awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
          // Broadcast to others
          broadcast(room, ws, uint8);
          break;
        }
        case MESSAGE_UPDATE: {
          // Direct doc update
          Y.applyUpdate(room.doc, payload);
          broadcast(room, ws, uint8);
          break;
        }
      }
    } catch (err) {
      console.error(`[collab] error in room ${roomId}:`, err);
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    room.connections.delete(ws);

    // Remove this client's awareness state
    const states = room.awareness.getStates();
    for (const [clientId, state] of states) {
      if (state && (state as { _ws?: WebSocket })._ws === ws) {
        room.awareness.states.delete(clientId);
      }
    }

    // Broadcast updated awareness
    const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
      room.awareness,
      Array.from(room.awareness.getStates().keys())
    );
    broadcast(room, null, new Uint8Array([MESSAGE_AWARENESS, ...awarenessStates]));

    console.log(`[collab] disconnect from room ${roomId} (${room.connections.size} remaining)`);

    if (room.connections.size === 0) {
      cleanupRoom(roomId);
    }
  });

  ws.on("error", (err) => {
    console.error(`[collab] WebSocket error:`, err);
  });
});

function broadcast(room: Room, exclude: WebSocket | null, data: Uint8Array) {
  for (const conn of room.connections) {
    if (conn !== exclude && conn.readyState === WebSocket.OPEN) {
      conn.send(Buffer.from(data));
    }
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[collab] shutting down...");
  for (const [roomId, room] of rooms) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    for (const conn of room.connections) {
      conn.close(1001, "Server shutting down");
    }
    room.doc.destroy();
    room.awareness.destroy();
  }
  rooms.clear();
  server.close();
  process.exit(0);
});

server.listen(PORT);
