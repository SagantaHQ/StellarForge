import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/contracts/create-tx
 *
 * Phase B of the two-phase Soroban deploy flow:
 *   Phase A (deploy-tx): uploadContractWasm  → wallet signs → submit → wasm installed
 *   Phase B (this):     createCustomContract OR updateContractWasm
 *                       → wallet signs → submit → contract instance exists
 *
 * For a NEW deploy:  builds a `createCustomContract` operation using the
 *   WASM hash returned from Phase A. Returns unsigned XDR for wallet signing.
 *
 * For an UPGRADE (existing contract on this network): builds an
 *   `updateContractWasm` operation that swaps the contract's installed
 *   WASM to the new hash. The contract ID stays the same.
 *
 * Body:
 *   {
 *     projectId: string,
 *     walletAddress: string,
 *     network: string,
 *     wasmHash: string,         // SHA-256 hex of the WASM bytes (from Phase A)
 *     existingContractId?: string,  // present when upgrading
 *   }
 *
 * Returns:
 *   {
 *     unsignedXdr: string,      // base64 transaction XDR (unsigned)
 *     network: string,
 *     networkPassphrase: string,
 *     isUpgrade: boolean,
 *     contractId: string | null,  // existing contract ID if upgrade
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

/**
 * Parse a hex string into a Uint8Array.
 * The WASM hash comes from Phase A as a 64-char hex string (SHA-256 = 32 bytes).
 */
function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleaned.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${cleaned.length}`);
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate a 32-byte salt for `createCustomContract`.
 * The salt makes the contract ID deterministic — same (deployer, wasmHash, salt)
 * always produces the same contract ID. We use a random salt so the user can
 * deploy multiple instances of the same WASM if they want.
 *
 * Crypto.getRandomValues is available in Node 19+ (globalThis.crypto).
 * Falls back to Node's `crypto` module for older runtimes.
 */
function generateSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    // Browser/Node 19+ WebCrypto path
    globalThis.crypto.getRandomValues(salt);
  } else {
    // Node 18 fallback
    const nodeCrypto = require("crypto") as typeof import("crypto");
    nodeCrypto.randomFillSync(salt);
  }
  return salt;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, walletAddress, network, wasmHash, existingContractId } = body;

    if (!projectId || !walletAddress || !network || !wasmHash) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, walletAddress, network, wasmHash" },
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

    // Look up the existing deployed contract for this project + network.
    // If found → this is an upgrade (we'll use updateContractWasm).
    // If not found → new deploy (we'll use createCustomContract).
    let dbContract: { id: string; contractId: string; wasmHash: string } | null = null;
    try {
      dbContract = await db.deployedContract.findUnique({
        where: { projectId_network: { projectId, network } },
        select: { id: true, contractId: true, wasmHash: true },
      });
    } catch {
      // DB might be unavailable — proceed assuming new deploy
    }

    const isUpgrade = !!dbContract || !!existingContractId;
    const onChainContractId = dbContract?.contractId ?? existingContractId ?? null;

    // Parse the WASM hash hex into bytes
    let wasmHashBytes: Uint8Array;
    try {
      wasmHashBytes = hexToBytes(wasmHash);
      if (wasmHashBytes.length !== 32) {
        throw new Error(`WASM hash must be 32 bytes, got ${wasmHashBytes.length}`);
      }
    } catch (err) {
      return NextResponse.json(
        {
          error: "Invalid wasmHash",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 400 }
      );
    }

    // Load the Stellar SDK + fetch the source account
    const StellarSdk = await import("@stellar/stellar-sdk");
    const { rpc: stellarRpc, BASE_FEE, Operation, TransactionBuilder, Address } = StellarSdk;

    const server = new stellarRpc.Server(rpc);

    // Fetch the source account — will throw if the account doesn't exist
    // (e.g. unfunded testnet account). Give a helpful error.
    let sourceAccount;
    try {
      sourceAccount = await server.getAccount(walletAddress);
    } catch {
      const friendbotUrl = network === "testnet"
        ? `https://friendbot.stellar.org?addr=${walletAddress}`
        : null;
      return NextResponse.json(
        {
          error:
            `Account ${walletAddress.substring(0, 12)}… not found on ${network}.` +
            (friendbotUrl ? ` Fund it first: ${friendbotUrl}` : " Make sure the wallet is connected to the correct network."),
        },
        { status: 400 }
      );
    }

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    });

    if (isUpgrade && onChainContractId) {
      // ──────────────────────────────────────────────────────────────
      // UPGRADE: update the contract's installed WASM to the new hash.
      // The contract ID stays the same — only the code changes.
      // ──────────────────────────────────────────────────────────────
      txBuilder.addOperation(
        Operation.updateContractWasm({
          contractId: onChainContractId,
          wasmHash: wasmHashBytes,
        })
      );
    } else {
      // ──────────────────────────────────────────────────────────────
      // NEW DEPLOY: create a new contract instance from the WASM hash.
      // We use createCustomContract (not createContract) because the
      // former supports a constructor if present, and falls back to a
      // no-op constructor if the contract has none.
      //
      // The `address` field is the deployer — required for auth on the
      // create operation (so only the wallet that signed can deploy).
      // The `salt` makes the contract ID deterministic per (deployer,
      // wasmHash, salt) — random so multiple deploys of the same WASM
      // produce different contract IDs.
      // ──────────────────────────────────────────────────────────────
      const deployerAddress = new Address(walletAddress);
      const salt = generateSalt();

      txBuilder.addOperation(
        Operation.createCustomContract({
          address: deployerAddress,
          wasmHash: wasmHashBytes,
          salt,
          // constructorArgs: left empty — most Soroban contracts either
          // have no constructor or use __constructor() with no args.
          // Future: pass parsed constructor args from the deploy UI.
        })
      );
    }

    txBuilder.setTimeout(300);
    const tx = txBuilder.build();

    // Simulate + prepare the transaction (attach resource footprint + fees)
    // For createContract, simulation is REQUIRED — it computes the
    // resource footprint + reveals any auth requirements.
    let preparedTx;
    try {
      preparedTx = await server.prepareTransaction(tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Simulation failed — the contract cannot be created with the provided WASM hash.",
          detail: msg,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      unsignedXdr: preparedTx.toXDR(),
      network,
      networkPassphrase: passphrase,
      isUpgrade,
      contractId: onChainContractId,
    });
  } catch (err) {
    console.error("[create-tx] error:", err);
    return NextResponse.json(
      {
        error: "Failed to build create-contract transaction",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
