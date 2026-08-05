/**
 * §5 — Soroban.Build WebSocket Collaboration Server
 *
 * A y-websocket server that enables cross-browser/cross-device realtime
 * collaborative editing. Each project gets its own Yjs document room.
 *
 * Run: cd mini-services/collab-server && bun install && bun run dev
 * Port: 3001
 *
 * The browser connects via:
 *   new WebsocketProvider(`soroban-build-${roomId}`, ydoc, {
 *     url: "ws://localhost:3001"
 *   })
 */

import { WebSocketServer } from "ws";
import * as Y from "yjs";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(` Soroban.Build collab server running on ws://localhost:${PORT}`);

// Room management — each room has its own Yjs document
interface Room {
  doc: Y.Doc;
  connections: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  if (!rooms.has(roomId)) {
    const doc = new Y.Doc();
    const connections = new Set<WebSocket>();
    rooms.set(roomId, { doc, connections });
    console.log(`  + Created room: ${roomId}`);
  }
  return rooms.get(roomId)!;
}

wss.on("connection", (ws: WebSocket, req) => {
  // Parse room ID from URL: /soroban-build-<roomId>
  const url = req.url ?? "";
  const roomMatch = url.match(/soroban-build-([a-z0-9]+)/i);
  const roomId = roomMatch?.[1] ?? "default";

  const room = getOrCreateRoom(roomId);
  room.connections.add(ws);
  console.log(`  → Client joined room: ${roomId} (${room.connections.size} total)`);

  // Send initial sync state
  const update = Y.encodeStateAsUpdate(room.doc);
  if (update.length > 0) {
    const message = new Uint8Array(update.length + 1);
    message[0] = 0; // sync message type
    message.set(update, 1);
    ws.send(message);
  }

  ws.on("message", (data: Buffer) => {
    try {
      const uint8 = new Uint8Array(data);

      // Check if this is a sync update (type 0) or awareness update (type 1)
      if (uint8[0] === 0) {
        // Apply the update to the room's document
        const updateData = uint8.slice(1);
        Y.applyUpdate(room.doc, updateData);

        // Broadcast to all other connections in the room
        const broadcast = new Uint8Array(updateData.length + 1);
        broadcast[0] = 0;
        broadcast.set(updateData, 1);

        for (const conn of room.connections) {
          if (conn !== ws && conn.readyState === 1) {
            conn.send(broadcast);
          }
        }
      } else if (uint8[0] === 1) {
        // Awareness update — broadcast to all other connections
        for (const conn of room.connections) {
          if (conn !== ws && conn.readyState === 1) {
            conn.send(uint8);
          }
        }
      }
    } catch (err) {
      console.error("  ! Error processing message:", err);
    }
  });

  ws.on("close", () => {
    room.connections.delete(ws);
    console.log(`  ← Client left room: ${roomId} (${room.connections.size} remaining)`);

    // Clean up empty rooms
    if (room.connections.size === 0) {
      room.doc.destroy();
      rooms.delete(roomId);
      console.log(`  - Destroyed empty room: ${roomId}`);
    }
  });

  ws.on("error", (err) => {
    console.error("  ! WebSocket error:", err);
    room.connections.delete(ws);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n  Shutting down collab server...");
  for (const [id, room] of rooms) {
    room.doc.destroy();
    for (const conn of room.connections) {
      conn.close();
    }
  }
  wss.close();
  process.exit(0);
});
