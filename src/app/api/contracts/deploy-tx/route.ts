import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import { createHash, randomBytes } from "crypto";
import path from "path";

/**
 * POST /api/contracts/deploy-tx
 *
 * Builds a Soroban contract deploy (or upgrade) transaction XDR that the
 * client signs with their wallet. Uses @stellar/stellar-sdk directly (NOT
 * stellar-cli) to avoid spawning a subprocess + cargo metadata which was
 * causing OOM crashes on the 4GB sandbox.
 *
 * Flow:
 *   1. Find the .wasm file from the last build
 *   2. Read the WASM + compute hash
 *   3. Build an uploadContractWasm + createCustomContract transaction
 *      (or uploadContractWasm only for upgrades)
 *   4. Simulate + prepare the transaction (attach footprint + fees)
 *   5. Return the unsigned XDR for the wallet to sign
 *
 * Body:
 *   {
 *     projectId: string,
 *     walletAddress: string,
 *     network: string,
 *     wasmPath?: string,
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUILDS_DIR = "/tmp/stellarforge-builds";

const NETWORK_RPC: Record<string, string> = {
  mainnet: "https://soroban-mainnet.stellar.org",
  testnet: "https://soroban-testnet.stellar.org",
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
  const { readdir } = await import("fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });

  // First pass: check files in THIS directory
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".wasm")) {
      return path.join(dir, entry.name);
    }
  }

  // Second pass: recurse into subdirectories (skip deps/, .fingerprint/, build/)
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "deps" && entry.name !== ".fingerprint" && entry.name !== "build") {
      const found = await findWasm(path.join(dir, entry.name));
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
      try {
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
      } catch {
        // DB unavailable — skip the check
      }
    }

    // Build the transaction using @stellar/stellar-sdk directly (no subprocess)
    const StellarSdk = await import("@stellar/stellar-sdk");
    const { rpc: stellarRpc, Address, BASE_FEE, Operation, TransactionBuilder } = StellarSdk;

    const server = new stellarRpc.Server(rpc);

    // Fetch the source account — this will fail if the account doesn't exist
    // on the network (e.g. unfunded testnet account). Give a helpful error.
    let sourceAccount;
    try {
      sourceAccount = await server.getAccount(walletAddress);
    } catch {
      const friendbotUrl = network === "testnet"
        ? `https://friendbot.stellar.org?addr=${walletAddress}`
        : null;
      return NextResponse.json(
        {
          error: `Account ${walletAddress.substring(0, 12)}… not found on ${network}.` +
            (friendbotUrl ? ` Fund it first: ${friendbotUrl}` : " Make sure the wallet is connected to the correct network."),
        },
        { status: 400 }
      );
    }

    // Build the transaction — upload WASM only.
    // The contract creation (createCustomContract) is done in a SEPARATE
    // transaction after the upload is confirmed. prepareTransaction doesn't
    // support multi-operation Soroban transactions ("Transaction contains
    // more than one operation" error).
    //
    // Flow:
    //   1. This endpoint: build uploadContractWasm tx → user signs → submit
    //   2. After upload confirmed: build createCustomContract tx → user signs → submit
    //   (step 2 is handled by the submit route after it detects the upload succeeded)
    const wasmBytes = Buffer.from(wasmBuffer);

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    });

    txBuilder.addOperation(
      Operation.uploadContractWasm({
        wasm: wasmBytes,
      })
    );

    txBuilder.setTimeout(300);

    const tx = txBuilder.build();

    // Simulate + prepare the transaction (attach resource footprint + fees)
    const preparedTx = await server.prepareTransaction(tx);

    return NextResponse.json({
      unsignedXdr: preparedTx.toXDR(),
      wasmHash,
      wasmSizeBytes: wasmBuffer.length,
      isUpgrade,
      contractId: existingContractId ?? null,
      network,
      networkPassphrase: passphrase,
    });
  } catch (err) {
    console.error("[deploy-tx] error:", err);
    return NextResponse.json(
      { error: "Failed to build deploy transaction", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
