/**
 * End-to-end test for the StellarForge collab server.
 * Tests the full y-websocket protocol.
 */

import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebSocket } from "ws";

const PORT = 3002;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 2;
const MESSAGE_UPDATE = 3;

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ FAIL: ${msg}`); }
}

function connectClient(roomId: string, ydoc: Y.Doc): Promise<{ ws: WebSocket; awareness: awarenessProtocol.Awareness }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/stellarforge-${roomId}`);
    ws.binaryType = "arraybuffer";
    const awareness = new awarenessProtocol.Awareness(ydoc);

    ws.on("open", () => {
      console.log(`  [client] connected to room ${roomId}`);
    });

    ws.on("message", (data: Buffer) => {
      const uint8 = new Uint8Array(data);
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MESSAGE_SYNC: {
          // Handle both sync-step1 (from server) and sync-step2
          const encoder = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
          // Send any response back (e.g. sync-step2 if server asked)
          const response = encoding.toUint8Array(encoder);
          if (response.length > 1) {
            ws.send(response);
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
          break;
        }
        case MESSAGE_QUERY_AWARENESS: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
          );
          ws.send(encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_UPDATE: {
          // Server broadcast a document update — apply it
          Y.applyUpdate(ydoc, decoding.readVarUint8Array(decoder), "remote");
          break;
        }
      }
    });

    ws.on("error", (err) => reject(err));

    // Resolve after a short delay (let the initial sync happen)
    setTimeout(() => resolve({ ws, awareness }), 500);
  });
}

/** Send a document update to the server (MESSAGE_UPDATE) */
function sendUpdate(ws: WebSocket, update: Uint8Array) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_UPDATE);
  encoding.writeVarUint8Array(encoder, update);
  ws.send(encoding.toUint8Array(encoder));
}

/** Send sync-step2 to the server (our document state) */
function sendSyncStep2(ws: WebSocket, ydoc: Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(encoder, ydoc);
  ws.send(encoding.toUint8Array(encoder));
}

/** Send awareness update to the server */
function sendAwareness(ws: WebSocket, awareness: awarenessProtocol.Awareness) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
  );
  ws.send(encoding.toUint8Array(encoder));
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  StellarForge Collab Server — End-to-End Test");
  console.log("═══════════════════════════════════════════════════════\n");

  // Test 1: Server connectivity
  console.log("Test 1: Server connectivity");
  {
    const ws = new WebSocket(`ws://localhost:${PORT}/stellarforge-connect-test`);
    const connected = await new Promise<boolean>(resolve => {
      ws.on("open", () => { ws.close(); resolve(true); });
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 3000);
    });
    assert(connected, "WebSocket connects to server on port 3002");
  }

  // Test 2: Two clients sync document state
  console.log("\nTest 2: Document sync between two clients");
  {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();

    // Client A has text "Hello"
    ydocA.getText("shared").insert(0, "Hello");

    const clientA = await connectClient("sync-2", ydocA);
    const clientB = await connectClient("sync-2", ydocB);

    // Client A sends its state via sync-step2 (server applies + broadcasts UPDATE)
    sendSyncStep2(clientA.ws, ydocA);

    // Wait for propagation
    await sleep(1000);

    const textB = ydocB.getText("shared").toString();
    assert(textB === "Hello", `Client B received "Hello" (got "${textB}")`);

    clientA.ws.close();
    clientB.ws.close();
    await sleep(500);
  }

  // Test 3: Real-time text editing
  console.log("\nTest 3: Real-time text editing");
  {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();

    const clientA = await connectClient("edit-3", ydocA);
    const clientB = await connectClient("edit-3", ydocB);

    // Both start empty — Client A types "World"
    ydocA.getText("shared").insert(0, "World");

    // Send the update via MESSAGE_UPDATE
    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));

    await sleep(1000);

    const textB = ydocB.getText("shared").toString();
    assert(textB === "World", `Client B received "World" (got "${textB}")`);

    clientA.ws.close();
    clientB.ws.close();
    await sleep(500);
  }

  // Test 4: Multiple sequential edits
  console.log("\nTest 4: Multiple sequential edits");
  {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();

    const clientA = await connectClient("multi-4", ydocA);
    const clientB = await connectClient("multi-4", ydocB);

    const ytextA = ydocA.getText("doc");

    ytextA.insert(0, "Hello");
    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));
    await sleep(300);

    ytextA.insert(5, " World");
    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));
    await sleep(300);

    ytextA.insert(11, "!");
    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));
    await sleep(500);

    const textB = ydocB.getText("doc").toString();
    assert(textB === "Hello World!", `Client B received "Hello World!" (got "${textB}")`);

    clientA.ws.close();
    clientB.ws.close();
    await sleep(500);
  }

  // Test 5: Room isolation
  console.log("\nTest 5: Room isolation");
  {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();

    ydocA.getText("shared").insert(0, "RoomA");

    const clientA = await connectClient("iso-A", ydocA);
    const clientB = await connectClient("iso-B", ydocB);

    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));
    await sleep(1000);

    const textB = ydocB.getText("shared").toString();
    assert(textB === "", `Room B did NOT receive Room A's data (got "${textB}")`);

    clientA.ws.close();
    clientB.ws.close();
    await sleep(500);
  }

  // Test 6: Client disconnect + room persistence
  console.log("\nTest 6: Room persistence after disconnect");
  {
    const ydocA = new Y.Doc();
    ydocA.getText("shared").insert(0, "Persist");

    const clientA = await connectClient("persist-6", ydocA);
    sendSyncStep2(clientA.ws, ydocA);
    await sleep(500);

    clientA.ws.close();
    await sleep(1000);

    // New client joins — should receive the persisted state
    const ydocB = new Y.Doc();
    const clientB = await connectClient("persist-6", ydocB);
    await sleep(1000);

    const textB = ydocB.getText("shared").toString();
    assert(textB === "Persist", `New client received persisted state (got "${textB}")`);

    clientB.ws.close();
    await sleep(500);
  }

  // Test 7: Late-joiner sync
  console.log("\nTest 7: Late-joiner sync");
  {
    const ydocA = new Y.Doc();
    const clientA = await connectClient("late-7", ydocA);

    // Client A types something
    ydocA.getText("doc").insert(0, "BeforeJoin");
    sendUpdate(clientA.ws, Y.encodeStateAsUpdate(ydocA));
    await sleep(500);

    // Client B joins LATE
    const ydocB = new Y.Doc();
    const clientB = await connectClient("late-7", ydocB);
    await sleep(1000);

    const textB = ydocB.getText("doc").toString();
    assert(textB === "BeforeJoin", `Late joiner received existing state (got "${textB}")`);

    clientA.ws.close();
    clientB.ws.close();
    await sleep(500);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════════════════════");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(console.error);
