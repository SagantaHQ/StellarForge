import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spawn } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";

const execFileAsync = promisify(spawn);

/**
 * POST /api/contracts/deploy-tx
 *
 * Builds a Soroban contract deploy (or upgrade) transaction XDR that the
 * client signs with their wallet. The client then submits the signed XDR
 * via /api/contracts/submit.
 *
 * Flow:
 *   1. Find the .wasm file from the last build
 *   2. Upload the WASM to the network (stellar contract upload)
 *   3. Build a CreateContract or RestoreContract transaction
 *   4. Return the unsigned XDR + wasm hash to the client
 *
 * For upgrades:
 *   - If a DeployedContract already exists for this project + network,
 *     we build an upgrade transaction instead ( stellar contract install )
 *
 * Body:
 *   {
 *     projectId: string,       // server project ID
 *     walletAddress: string,   // deployer's wallet address
 *     network: string,         // testnet | mainnet | futurenet
 *     wasmPath?: string,       // optional explicit wasm path
 *   }
 *
 * Returns:
 *   {
 *     unsignedXdr: string,     // base64 XDR for the wallet to sign
 *     wasmHash: string,        // SHA-256 hash of the WASM
 *     isUpgrade: boolean,      // true if this is an upgrade (contract already deployed)
 *     contractId?: string,     // existing contract ID (for upgrades)
 *     network: string,
 *     networkPassphrase: string,
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function findWasm(dir: string): Promise<string | null> {
  const { readdir, stat } = await import("fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, walletAddress, network, wasmPath } = body;

    if (!projectId || !walletAddress || !network) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, walletAddress, network" },
        { status: 400 }
      );
    }

    const rpc = NETWORK_RPC[network];
    const passphrase = NETWORK_PASSPHRASE[network];
    if (!rpc || !passphrase) {
      return NextResponse.json(
        { error: `Unknown network: ${network}` },
        { status: 400 }
      );
    }

    // Find the WASM file
    const workspaceDir = path.join(BUILDS_DIR, projectId);
    const wasmFilePath = wasmPath
      ? path.join(workspaceDir, wasmPath)
      : await findWasm(workspaceDir);

    if (!wasmFilePath) {
      return NextResponse.json(
        { error: "No .wasm file found. Run a build first." },
        { status: 400 }
      );
    }

    // Read the WASM binary + compute hash
    const wasmBuffer = await readFile(wasmFilePath);
    const wasmHash = createHash("sha256").update(wasmBuffer).digest("hex");

    // Check if this contract was already deployed (upgrade scenario)
    let existingContract: { id: string; contractId: string; wasmHash: string } | null = null;
    try {
      existingContract = await db.deployedContract.findUnique({
        where: {
          projectId_network: { projectId, network },
        },
        select: { id: true, contractId: true, wasmHash: true },
      });
    } catch {
      // DB might be unavailable — proceed as new deploy
    }

    const isUpgrade = !!existingContract;
    const existingContractId = existingContract?.contractId ?? null;

    // Check if the WASM hash matches the last deployed version
    if (existingContract) {
      const lastVersion = await db.wasmVersion.findFirst({
        where: { contractId: existingContract.id },
        orderBy: { version: "desc" },
      });
      if (lastVersion && lastVersion.wasmHash === wasmHash) {
        return NextResponse.json(
          { error: "WASM unchanged — no need to upgrade. Build after making changes." },
          { status: 409 }
        );
      }
    }

    // Use stellar-cli to build the transaction XDR
    // For a new deploy: stellar contract deploy --build-only --wasm <path> --source-account <addr> --rpc-url <rpc> --network-passphrase <passphrase>
    // For an upgrade: stellar contract install --build-only --wasm <path> --source-account <addr> --rpc-url <rpc> --network-passphrase <passphrase>
    //   then: stellar contract extend --wasm-hash <hash> ...
    //
    // Actually, stellar contract deploy with --build-only outputs the unsigned XDR.
    // For upgrades, we use: stellar contract deploy --build-only --wasm <path> --source-account <addr> --rpc-url <rpc> --network-passphrase <passphrase> --contract-id <existing>

    const home = process.env.HOME ?? "/home/z";
    const cargoBin = `${home}/.cargo/bin`;
    const env = {
      ...process.env,
      PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
      CARGO_HOME: `${home}/.cargo`,
      RUSTUP_HOME: `${home}/.rustup`,
    };

    // Build the deploy/upgrade transaction
    const args = [
      "contract", "deploy",
      "--build-only",
      "--wasm", wasmFilePath,
      "--source-account", walletAddress,
      "--rpc-url", rpc,
      "--network-passphrase", passphrase,
    ];

    // For upgrades, add --contract-id
    if (isUpgrade && existingContractId) {
      args.push("--contract-id", existingContractId);
    }

    const { stdout, stderr } = await new Promise<{stdout: string; stderr: string}>((resolve, reject) => {
      const child = spawn("stellar", args, {
        cwd: workspaceDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`stellar contract deploy --build-only failed (exit ${code}): ${stderr || stdout}`));
      });

      child.on("error", (err) => reject(err));

      // 30s timeout
      setTimeout(() => {
        child.kill();
        reject(new Error("Build transaction timed out after 30s"));
      }, 30000);
    });

    // The XDR is the last line of stdout (strip any warnings)
    const xdrLine = stdout.trim().split("\n").pop();
    if (!xdrLine || xdrLine.length < 50) {
      return NextResponse.json(
        { error: "Failed to build transaction XDR", detail: stdout + stderr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      unsignedXdr: xdrLine.trim(),
      wasmHash,
      wasmSizeBytes: wasmBuffer.length,
      isUpgrade,
      contractId: existingContractId ?? null,
      network,
      networkPassphrase: passphrase,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to build deploy transaction", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
