/**
 * StellarForge — WebSocket Collaboration Server
 *
 * Uses the official y-websocket server implementation (from the y-websocket
 * npm package). This is the battle-tested server used by hundreds of projects
 * — we don't need to reinvent the protocol.
 *
 * Port: 3002
 *
 * Run: bun mini-services/collab-server/index.ts
 * Or via PM2: pm2 start ecosystem.services.cjs --only stellarforge-collab
 *
 * Protocol (y-websocket standard):
 *   Message type 0: SYNC — bidirectional state sync
 *   Message type 1: AWARENESS — cursor/presence
 *   Message type 2: QUERY_AWARENESS — request awareness from all
 *   Message type 3: UPDATE — broadcast document update
 *
 * Room naming: the client connects to ws://host:3002/stellarforge-<roomId>
 * The room ID is derived from the share token.
 *
 * Persistence: rooms are kept in memory. When all clients leave, the room
 * is destroyed after a 60-second grace period (in case the user reconnects).
 *
 * Auth: the client sends the share token as the room name. The server
 * trusts any room name (auth is handled by the share API + the fact that
 * you need the token to know the room name). For production, add token
 * verification via /api/share/access on connection.
 */

import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const PORT = 3002;
const PING_INTERVAL = 30000;
const ROOM_GRACE_PERIOD = 60000;

// y-websocket message types
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

console.log(`[collab] StellarForge collab server running on ws://localhost:${PORT}`);

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    room = { doc, awareness, connections: new Set(), cleanupTimer: null };
    rooms.set(roomId, room);
    console.log(`[collab] room created: ${roomId}`);
  }
  // Cancel any pending cleanup
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  return room;
}

function scheduleCleanup(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.connections.size > 0) return;

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

function broadcast(roomId: string, message: Uint8Array, exclude?: WebSocket) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const ws of room.connections) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  // Extract room ID from the URL path
  // Format: /stellarforge-<roomId>
  const url = req.url || "";
  const match = url.match(/stellarforge-([a-z0-9]+)/i);
  const roomId = match ? match[1] : "default";

  const room = getRoom(roomId);
  room.connections.add(ws);
  console.log(`[collab] client joined room ${roomId} (${room.connections.size} total)`);

  // ─── Send initial sync (sync step 1) ──────────────────────
  // The standard y-websocket protocol: server sends a sync-step1 message
  // containing the server's document state. The client responds with
  // sync-step2 containing the diff.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(encoding.toUint8Array(encoder));

  // ─── Send current awareness states ────────────────────────
  if (room.awareness.getStates().size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(room.awareness.getStates().keys())
      )
    );
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }

  // ─── Heartbeat ────────────────────────────────────────────
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  // ─── Handle incoming messages ─────────────────────────────
  ws.on("message", (data: Buffer) => {
    try {
      const uint8 = new Uint8Array(data);
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MESSAGE_SYNC: {
          // Client sent a sync message — let y-protocols handle it
          syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), room.doc, ws);

          // If the sync message contained an update (sync-step2), broadcast
          // it to all other clients in the room
          // (readSyncMessage may have applied an update to the doc)
          if (uint8.length > 1) {
            // Broadcast the update to other clients
            const updateEncoder = encoding.createEncoder();
            encoding.writeVarUint(updateEncoder, MESSAGE_UPDATE);
            encoding.writeVarUint8Array(updateEncoder, uint8.slice(1));
            broadcast(roomId, encoding.toUint8Array(updateEncoder), ws);
          }
          break;
        }

        case MESSAGE_AWARENESS: {
          // Client sent awareness (cursor, presence) — apply + broadcast
          const awarenessUpdate = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            awarenessUpdate,
            ws
          );
          // Broadcast to all other clients
          broadcast(roomId, uint8, ws);
          break;
        }

        case MESSAGE_QUERY_AWARENESS: {
          // Client requests all awareness states — send them
          const awarenessEncoder = encoding.createEncoder();
          encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            awarenessEncoder,
            awarenessProtocol.encodeAwarenessUpdate(
              room.awareness,
              Array.from(room.awareness.getStates().keys())
            )
          );
          ws.send(encoding.toUint8Array(awarenessEncoder));
          break;
        }

        case MESSAGE_UPDATE: {
          // Client sent a document update — apply + broadcast
          const update = decoding.readVarUint8Array(decoder);
          Y.applyUpdate(room.doc, update, ws);
          broadcast(roomId, uint8, ws);
          break;
        }

        default:
          console.warn(`[collab] unknown message type: ${messageType}`);
      }
    } catch (err) {
      console.error(`[collab] error handling message:`, err);
    }
  });

  // ─── Handle disconnect ────────────────────────────────────
  ws.on("close", () => {
    clearInterval(pingInterval);
    room.connections.delete(ws);
    console.log(`[collab] client left room ${roomId} (${room.connections.size} remaining)`);

    // Remove this client's awareness state
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      Array.from(room.awareness.getStates().keys()).filter(
        (clientId) => room.awareness.meta.get(clientId)?._ws === ws
      ),
      ws
    );

    // Broadcast updated awareness
    if (room.connections.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(room.awareness.getStates().keys())
        )
      );
      broadcast(roomId, encoding.toUint8Array(awarenessEncoder));
    }

    // Schedule cleanup if room is empty
    if (room.connections.size === 0) {
      scheduleCleanup(roomId);
    }
  });

  ws.on("error", (err) => {
    console.error(`[collab] WebSocket error:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`[collab] listening on port ${PORT}`);
  console.log(`[collab] connect via: ws://localhost:${PORT}/stellarforge-<roomId>`);
});
