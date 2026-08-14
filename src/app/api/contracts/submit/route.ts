import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/contracts/submit
 *
 * Submits a signed Soroban transaction to the network, polls for
 * confirmation, and — for createCustomContract / updateContractWasm —
 * extracts the contract ID from the result and saves the deploy record
 * to the database.
 *
 * Used by BOTH phases of the two-phase deploy flow:
 *   Phase A: submit signed `uploadContractWasm` tx → returns tx hash
 *   Phase B: submit signed `createCustomContract` or `updateContractWasm`
 *            tx → returns tx hash + contractId (extracted from the result)
 *
 * The caller knows which phase they're in via the `phase` field, which
 * we use only to decide what to extract from the on-chain result:
 *   - phase="upload"        → just return the tx hash (caller has the wasm hash already)
 *   - phase="create"        → extract the contract ID from the result
 *   - phase="update"        → contract ID is already known (upgrade), just return it
 *
 * Body:
 *   {
 *     signedXdr: string,        // signed transaction XDR (base64)
 *     walletAddress: string,
 *     network: string,         // testnet | mainnet | futurenet | local
 *     projectId: string,
 *     wasmHash: string,        // SHA-256 hex of the WASM (for DB record)
 *     wasmSizeBytes: number,
 *     wasmPath: string,
 *     phase: "upload" | "create" | "update",
 *     isUpgrade: boolean,
 *     existingContractId?: string,  // for upgrades — the contract being updated
 *   }
 *
 * Returns:
 *   {
 *     hash: string,             // transaction hash
 *     status: "SUCCESS" | "FAILED" | "PENDING",
 *     contractId?: string,      // present only for phase=create / update
 *     isUpgrade: boolean,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      signedXdr,
      walletAddress,
      network,
      projectId,
      wasmHash,
      wasmSizeBytes,
      wasmPath,
      phase = "upload",
      isUpgrade,
      existingContractId,
    } = body;

    if (!signedXdr || !network || !projectId) {
      return NextResponse.json(
        { error: "Missing required fields: signedXdr, network, projectId" },
        { status: 400 }
      );
    }

    const rpcUrl = NETWORK_RPC[network];
    const passphrase = NETWORK_PASSPHRASE[network];
    if (!rpcUrl || !passphrase) {
      return NextResponse.json(
        { error: `Unknown network: ${network}` },
        { status: 400 }
      );
    }

    // Load the Stellar SDK + reconstruct the Transaction from XDR
    const StellarSdk = await import("@stellar/stellar-sdk");
    const { rpc: stellarRpc, TransactionBuilder, xdr } = StellarSdk;

    const server = new stellarRpc.Server(rpcUrl);
    const rawTx = xdr.TransactionEnvelope.fromXDR(signedXdr, "base64");
    const tx = TransactionBuilder.fromXDR(rawTx, passphrase);

    // Submit the signed transaction
    let sendResponse;
    try {
      sendResponse = await server.sendTransaction(tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Network rejected the transaction",
          detail: msg,
        },
        { status: 502 }
      );
    }

    if (sendResponse.status === "ERROR") {
      return NextResponse.json(
        {
          error: "Transaction submission failed",
          detail: sendResponse.errorResult?.toString() ?? "Unknown error",
        },
        { status: 502 }
      );
    }

    if (sendResponse.status === "TRY_AGAIN_LATER") {
      return NextResponse.json(
        { error: "Network busy — try again in a few seconds" },
        { status: 503 }
      );
    }

    const txHash = sendResponse.hash;

    // Poll for confirmation — Soroban transactions need a few seconds to
    // be included in a ledger. We poll up to 30 times (60s total).
    if (sendResponse.status === "PENDING") {
      const MAX_POLLS = 30;
      const POLL_INTERVAL_MS = 2000;

      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const response = await server.getTransaction(txHash);

          if (response.status === "SUCCESS") {
            // Transaction confirmed on-chain. For phase=create, extract
            // the contract ID from the result. For other phases, just
            // return the tx hash.
            let contractId: string | undefined;

            if (phase === "create") {
              contractId = extractContractIdFromResult(response);
            } else if (phase === "update") {
              contractId = existingContractId;
            }

            // Persist the deploy/upgrade to the database (best-effort)
            if (phase === "create" || phase === "update") {
              await persistDeployRecord({
                projectId,
                network,
                walletAddress,
                wasmHash,
                wasmSizeBytes,
                wasmPath,
                isUpgrade: phase === "update" || isUpgrade,
                contractId: contractId ?? existingContractId ?? "",
              }).catch((err) => {
                console.warn("[submit] failed to persist deploy record:", err);
              });
            }

            return NextResponse.json({
              hash: txHash,
              status: "SUCCESS" as const,
              contractId,
              isUpgrade: phase === "update" || !!isUpgrade,
            });
          }

          if (response.status === "FAILED") {
            return NextResponse.json(
              {
                error: "Transaction failed on-chain",
                detail: response.resultXdr
                  ? StellarSdk.scValToNative(xdr.Result.fromXDR(response.resultXdr, "base64"))
                  : "Transaction was rejected by the network",
              },
              { status: 502 }
            );
          }

          // status === "NOT_FOUND" — keep polling
        } catch {
          // Network error during poll — keep polling
        }
      }

      // Timed out polling — tx might still confirm eventually
      return NextResponse.json({
        hash: txHash,
        status: "PENDING" as const,
        message: "Transaction submitted but not yet confirmed after 60s. Check the explorer.",
        isUpgrade: phase === "update" || !!isUpgrade,
      });
    }

    // Shouldn't reach here — sendResponse.status should be one of PENDING/ERROR/TRY_AGAIN_LATER
    return NextResponse.json({
      hash: txHash,
      status: sendResponse.status,
      isUpgrade: phase === "update" || !!isUpgrade,
    });
  } catch (err) {
    console.error("[submit] error:", err);
    return NextResponse.json(
      {
        error: "Failed to submit transaction",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * Extract the contract ID from a successful `createCustomContract`
 * transaction result.
 *
 * The Soroban transaction result contains a `resultMetaXdr` field with
 * the operation result. For `createCustomContract`, the inner result
 * value is a `Address` SCVal containing the new contract ID (C...).
 *
 * This is somewhat fragile because the XDR structure can vary between
 * SDK versions — wrap in try/catch and return undefined if extraction
 * fails (the caller can still use the tx hash to look it up on the
 * explorer).
 */
function extractContractIdFromResult(response: {
  resultMetaXdr?: string;
  resultXdr?: string;
}): string | undefined {
  try {
    // Dynamic import — can't use top-level import in server route
    const StellarSdk = require("@stellar/stellar-sdk");
    const { xdr, scValToNative } = StellarSdk;

    // Try the operation result first (resultXdr) — that's where the
    // createCustomContract result lives.
    if (response.resultXdr) {
      const result = xdr.OperationResult.fromXDR(response.resultXdr, "base64");
      const innerResult = result?.tr()?.createCustomContractResult()?.innerResult();
      if (innerResult) {
        // The inner result is a CreateCustomContractResult containing
        // a contractId Address. scValToNative converts to a plain string.
        const val = innerResult.value();
        if (val) {
          const native = scValToNative(val);
          if (typeof native === "string" && native.startsWith("C")) {
            return native;
          }
          // Sometimes the result is an object with .address()
          if (typeof native === "object" && native !== null && "address" in native) {
            const addr = (native as { address: () => string }).address();
            if (typeof addr === "string" && addr.startsWith("C")) return addr;
          }
        }
      }
    }

    // Fall back to scanning the resultMetaXdr for any created contract ID.
    // This is more expensive but catches cases where the operation result
    // structure differs from what we expect.
    if (response.resultMetaXdr) {
      const meta = xdr.TransactionMeta.fromXDR(response.resultMetaXdr, "base64");
      const metaJson = meta.toObject ? meta.toObject() : JSON.stringify(meta);
      // Look for any C... pattern (Stellar contract IDs are 56 chars: C + 55 base32)
      const match = JSON.stringify(metaJson).match(/"C[A-Z2-7]{55}"/);
      if (match) {
        return match[0].replace(/"/g, "");
      }
    }

    return undefined;
  } catch (err) {
    console.warn("[submit] failed to extract contract ID from result:", err);
    return undefined;
  }
}

/**
 * Persist the deploy record to the database.
 * - New deploy: create a DeployedContract row + first WasmVersion row
 * - Upgrade: increment upgradeCount + add a new WasmVersion row
 *
 * Idempotent — if a record already exists for (projectId, network, wasmHash),
 * we don't duplicate it.
 */
async function persistDeployRecord(opts: {
  projectId: string;
  network: string;
  walletAddress: string;
  wasmHash: string;
  wasmSizeBytes: number;
  wasmPath: string;
  isUpgrade: boolean;
  contractId: string;
}): Promise<void> {
  const { projectId, network, walletAddress, wasmHash, wasmSizeBytes, wasmPath, isUpgrade, contractId } = opts;

  if (isUpgrade) {
    // Find the existing contract record
    const existing = await db.deployedContract.findUnique({
      where: { projectId_network: { projectId, network } },
    });

    if (existing) {
      // Check if we already recorded this WASM version (idempotent)
      const existingVersion = await db.wasmVersion.findFirst({
        where: { contractId: existing.id, wasmHash },
      });
      if (existingVersion) return;

      // Update the contract's wasmHash + increment upgrade count
      await db.deployedContract.update({
        where: { id: existing.id },
        data: {
          wasmHash,
          upgradeCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      // Add the new WASM version
      const versionCount = await db.wasmVersion.count({ where: { contractId: existing.id } });
      await db.wasmVersion.create({
        data: {
          contractId: existing.id,
          wasmHash,
          wasmPath,
          wasmSizeBytes,
          version: versionCount + 1,
          isUpgrade: true,
        },
      });
    } else if (contractId) {
      // No existing record but we have the contract ID (e.g., DB was wiped
      // after the initial deploy). Create a fresh record treating this as
      // the initial deploy with version 1.
      await db.deployedContract.create({
        data: {
          projectId,
          contractId,
          network,
          deployerAddress: walletAddress,
          wasmHash,
          isUpgradeable: true,
          upgradeCount: 0,
        },
      });
      await db.wasmVersion.create({
        data: {
          contract: { connect: { projectId_network: { projectId, network } } },
          wasmHash,
          wasmPath,
          wasmSizeBytes,
          version: 1,
          isUpgrade: false,
        },
      });
    }
  } else {
    // New deploy — check if a record already exists (idempotent)
    const existing = await db.deployedContract.findUnique({
      where: { projectId_network: { projectId, network } },
    });
    if (existing) return; // already recorded

    if (!contractId) {
      console.warn("[submit] cannot persist deploy record — no contractId for new deploy");
      return;
    }

    const newContract = await db.deployedContract.create({
      data: {
        projectId,
        contractId,
        network,
        deployerAddress: walletAddress,
        wasmHash,
        isUpgradeable: true,
        upgradeCount: 0,
      },
    });

    await db.wasmVersion.create({
      data: {
        contractId: newContract.id,
        wasmHash,
        wasmPath,
        wasmSizeBytes,
        version: 1,
        isUpgrade: false,
      },
    });
  }
}
