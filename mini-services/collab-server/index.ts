/**
 * StellarForge — WebSocket Collaboration Server
 *
 * Uses the standard y-websocket protocol with proper lib0 encoding.
 *
 * Port: 3002
 *
 * Protocol (y-websocket standard):
 *   Message type 0 (SYNC): bidirectional state sync (sync-step1 + sync-step2)
 *   Message type 1 (AWARENESS): cursor/presence updates
 *   Message type 2 (QUERY_AWARENESS): request all awareness states
 *   Message type 3 (UPDATE): raw document update (broadcast to other clients)
 *
 * The KEY fix: we listen on `room.doc.on("update", ...)` to broadcast
 * document changes to all other clients. The previous code tried to
 * manually slice the raw message bytes — which is incorrect because
 * the sync protocol has its own framing inside the payload.
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

    // ─── KEY: listen for doc updates and broadcast to all clients ──
    // When any client applies an update (via sync-step2 or direct UPDATE),
    // the doc fires an "update" event. We broadcast the update to ALL
    // other clients in the room. This is the standard y-websocket pattern.
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_UPDATE);
      encoding.writeVarUint8Array(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const ws of room!.connections) {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    });
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
  const url = req.url || "";
  // Match everything after "stellarforge-" until the end or a query string.
  // Previous regex [a-z0-9] didn't match hyphens → "iso-A" and "iso-B"
  // both resolved to room "iso" (same room!). Now matches [a-z0-9-].
  const match = url.match(/stellarforge-([a-z0-9-]+)/i);
  const roomId = match ? match[1] : "default";

  const room = getRoom(roomId);
  room.connections.add(ws);
  console.log(`[collab] client joined room ${roomId} (${room.connections.size} total)`);

  // ─── Send sync-step1 AND sync-step2 on connection ─────────
  // sync-step1: asks the client "what state do you have?" → client
  //   responds with sync-step2 (its state) → server applies to room.doc
  // sync-step2: sends the SERVER's full state to the client → client
  //   applies it. This is how late joiners get the existing document.
  //
  // IMPORTANT: send as TWO SEPARATE messages, not one concatenated.
  // readSyncMessage() only reads ONE sync message per call. If both
  // are in a single message, the second is silently ignored.
  const syncStep1Encoder = encoding.createEncoder();
  encoding.writeVarUint(syncStep1Encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncStep1Encoder, room.doc);
  ws.send(encoding.toUint8Array(syncStep1Encoder));

  const syncStep2Encoder = encoding.createEncoder();
  encoding.writeVarUint(syncStep2Encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(syncStep2Encoder, room.doc);
  ws.send(encoding.toUint8Array(syncStep2Encoder));

  // ─── Send current awareness states ────────────────────────
  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(awarenessStates.keys())
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
          // readSyncMessage handles BOTH sync-step1 (server asks client)
          // and sync-step2 (client sends its state). If sync-step2, the
          // update is applied to room.doc, which triggers the "update"
          // listener → broadcasts to other clients. We don't need to
          // manually re-broadcast here.
          const encoder = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
          // Send any response back to the client (e.g. sync-step2 response)
          const response = encoding.toUint8Array(encoder);
          if (response.length > 1) {
            ws.send(response);
          }
          break;
        }

        case MESSAGE_AWARENESS: {
          // Client sent awareness (cursor/presence) — apply + broadcast
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
          // Client requests all awareness states
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
          // Raw document update from client — apply to room.doc.
          // The "update" listener will broadcast to other clients.
          const update = decoding.readVarUint8Array(decoder);
          Y.applyUpdate(room.doc, update, ws);
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
    const statesToRemove = Array.from(room.awareness.getStates().keys()).filter(
      (clientId) => {
        const meta = room.awareness.meta.get(clientId);
        return meta?.cookie === ws || meta?._ws === ws;
      }
    );
    if (statesToRemove.length > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, statesToRemove, ws);

      // Broadcast updated awareness to remaining clients
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
