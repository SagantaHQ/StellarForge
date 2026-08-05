import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

/**
 * §3 — Deploy API.
 *
 * Runs `stellar contract deploy --wasm <path> --source-account <key>
 * --network <mainnet|testnet|futurenet|local>` and streams the deploy
 * transaction progress. Returns the contract ID on success.
 *
 * SECURITY: source account secrets travel with the request, are used only
 * for this deploy, and are NEVER stored or logged. In production, prefer
 * signing via the browser wallet (stellar-appkit) rather than passing
 * secrets to the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILDS_DIR = "/tmp/soroban-builds";

const NETWORK_RPC: Record<string, string> = {
  mainnet: "https://rpc.mainnet.stellar.org",
  testnet: "https://rpc.testnet.stellar.org",
  futurenet: "https://rpc.futurenet.stellar.org",
  local: "http://localhost:8000",
};

const NETWORK_PASSPHRASE: Record<string, string> = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
  local: "Standalone Network ; February 2017",
};

export async function POST(req: NextRequest) {
  let body: {
    projectId: string;
    wasmPath?: string;
    network: string;
    sourceAccountSecret: string;
    command?: "deploy";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projectId || !body.network || !body.sourceAccountSecret) {
    return NextResponse.json(
      { error: "Missing projectId, network, or sourceAccountSecret" },
      { status: 400 }
    );
  }

  const rpc = NETWORK_RPC[body.network];
  const passphrase = NETWORK_PASSPHRASE[body.network];
  if (!rpc || !passphrase) {
    return NextResponse.json(
      { error: `Unknown network: ${body.network}` },
      { status: 400 }
    );
  }

  const workspaceDir = path.join(BUILDS_DIR, body.projectId);

  // Find the .wasm file (either specified or first one found)
  let wasmPath = body.wasmPath
    ? path.join(workspaceDir, body.wasmPath)
    : null;
  if (!wasmPath) {
    const found = await findWasm(workspaceDir);
    if (!found) {
      return NextResponse.json(
        { error: "No .wasm file found. Run a build first." },
        { status: 400 }
      );
    }
    wasmPath = found;
  }

  try {
    await fs.access(wasmPath);
  } catch {
    return NextResponse.json(
      { error: `WASM file not found: ${wasmPath}` },
      { status: 400 }
    );
  }

  const home = process.env.HOME ?? "/home/z";
  const cargoBin = `${home}/.cargo/bin`;
  const env = {
    ...process.env,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
    CARGO_HOME: `${home}/.cargo`,
    RUSTUP_HOME: `${home}/.rustup`,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      send("start", { network: body.network, wasmPath: wasmPath!.replace(workspaceDir + "/", "") });

      const child = spawn(
        "stellar",
        [
          "contract", "deploy",
          "--wasm", wasmPath!,
          "--source-account", body.sourceAccountSecret,
          "--rpc-url", rpc,
          "--network-passphrase", passphrase,
        ],
        { cwd: workspaceDir, env, stdio: ["ignore", "pipe", "pipe"] }
      );

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        const lines = text.split("\n").filter((l) => l.length > 0);
        for (const line of lines) send("stdout", { line });
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const lines = text.split("\n").filter((l) => l.length > 0);
        for (const line of lines) send("stderr", { line });
      });

      child.on("error", (err) => {
        send("error", { message: err.message });
        controller.close();
      });

      child.on("close", (code) => {
        send("exit", { code, stdout, stderr });
        // Try to extract contract ID from stdout
        const match = stdout.match(/[A-Z0-9]{56}/);
        if (match) {
          send("contractId", { id: match[0] });
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function findWasm(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".wasm")) return fullPath;
    if (entry.isDirectory()) {
      const found = await findWasm(fullPath);
      if (found) return found;
    }
  }
  return null;
}
