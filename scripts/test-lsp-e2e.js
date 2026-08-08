/**
 * Quick test: connect to the LSP gateway via WebSocket, send LSP initialize,
 * and verify rust-analyzer responds.
 *
 * Run: node scripts/test-lsp-e2e.js
 */

const WebSocket = require("ws");

const WORKSPACE_ID = "test-e2e";
const URL = `ws://localhost:3099/lsp?workspace=${WORKSPACE_ID}`;

console.log(`[test] connecting to ${URL}`);
const ws = new WebSocket(URL);

let messageId = 0;
function sendLsp(method, params) {
  const id = ++messageId;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  ws.send(msg);
  return id;
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  ws.send(msg);
}

ws.on("open", () => {
  console.log("[test] WS connected — sending LSP initialize");

  // 1. initialize
  sendLsp("initialize", {
    processId: process.pid,
    clientInfo: { name: "test-client", version: "1.0" },
    locale: "en",
    rootUri: `file:///tmp/soroban-builds/${WORKSPACE_ID}`,
    capabilities: {
      textDocument: {
        synchronization: { didOpen: true, didChange: true, didClose: true },
        completion: {
          completionItem: {
            snippetSupport: true,
            documentationFormat: ["markdown", "plaintext"],
          },
        },
        hover: { contentFormat: ["markdown", "plaintext"] },
      },
    },
    initializationOptions: {},
  });
});

let initialized = false;
let initializeId = null;

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.id === initializeId && msg.result) {
    console.log("[test] ✅ initialize succeeded — server capabilities received");
    console.log(`[test]   server: ${msg.result.serverInfo?.name} ${msg.result.serverInfo?.version}`);

    // 2. initialized notification
    sendNotification("initialized", {});

    // 3. didOpen for lib.rs
    setTimeout(() => {
      console.log("[test] sending didOpen for src/lib.rs");
      sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: `file:///tmp/soroban-builds/${WORKSPACE_ID}/src/lib.rs`,
          languageId: "rust",
          version: 1,
          text: `#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, String};\n\n#[contract]\npub struct Hello;\n\n#[contractimpl]\nimpl Hello {\n    pub fn hello(_env: Env) -> String {\n        String::from_str(&_env, "Hello")\n    }\n}\n`,
        },
      });

      // 4. Request completion at position after "use soroban_sdk::"
      setTimeout(() => {
        console.log("[test] requesting completion at line 2, col 20 (after 'soroban_sdk::')");
        const completionId = sendLsp("textDocument/completion", {
          textDocument: { uri: `file:///tmp/soroban-builds/${WORKSPACE_ID}/src/lib.rs` },
          position: { line: 1, character: 20 }, // after "use soroban_sdk::"
          context: { triggerKind: 2, triggerCharacter: ":" },
        });
      }, 15000); // wait 15s for rust-analyzer to index soroban-sdk
    }, 1000);

    return;
  }

  if (msg.method === "textDocument/publishDiagnostics") {
    const diags = msg.params?.diagnostics || [];
    console.log(`[test] 📋 diagnostics for ${msg.params?.uri}: ${diags.length} items`);
    for (const d of diags.slice(0, 3)) {
      console.log(`[test]   ${d.severity === 1 ? "ERROR" : "WARN"}: ${d.message}`);
    }
    return;
  }

  if (msg.id && msg.result !== undefined) {
    // This is likely the completion response
    if (Array.isArray(msg.result)) {
      console.log(`[test] ✅ completion returned ${msg.result.length} items`);
      for (const item of msg.result.slice(0, 10)) {
        console.log(`[test]   - ${item.label} (${item.kind})`);
      }
    } else if (msg.result?.items) {
      console.log(`[test] ✅ completion returned ${msg.result.items.length} items`);
      for (const item of msg.result.items.slice(0, 10)) {
        console.log(`[test]   - ${item.label} (${item.kind})`);
      }
    }

    // Done — close
    setTimeout(() => {
      console.log("[test] closing connection");
      ws.close();
      process.exit(0);
    }, 1000);
  }
});

ws.on("error", (err) => {
  console.error("[test] WS error:", err.message);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`[test] WS closed: ${code} ${reason}`);
});

// Capture the initialize ID
const origSend = sendLsp;
sendLsp = function (method, params) {
  const id = ++messageId;
  if (method === "initialize") initializeId = id;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  ws.send(msg);
  return id;
};

// Timeout after 60s
setTimeout(() => {
  console.error("[test] ⏰ timeout — closing");
  process.exit(1);
}, 60000);
