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
            //
            // Phases:
            //   "upload"  — uploadContractWasm (Phase A of deploy): no extraction needed
            //   "create"  — createCustomContract (Phase B): extract contract ID from result
            //   "update"  — updateContractWasm (upgrade): contract ID already known
            //   "invoke"  — invokeContractFunction (write call): just return tx hash
            let contractId: string | undefined;

            if (phase === "create") {
              contractId = extractContractIdFromResult(response);
            } else if (phase === "update") {
              contractId = existingContractId;
            }
            // For "upload" and "invoke" phases, contractId stays undefined —
            // the caller doesn't need it (they already have the wasm hash
            // for upload, or know the contract ID for invoke).

            // Persist the deploy/upgrade to the database
            // The schema (DeployedContract + WasmVersion) ties the deploy
            // to the project via projectId. We surface errors here so the
            // user knows if their deploy record wasn't saved — they need
            // it for the contract interaction panel to find the deployed
            // contract on next page load.
            if (phase === "create" || phase === "update") {
              try {
                await persistDeployRecord({
                  projectId,
                  network,
                  walletAddress,
                  wasmHash,
                  wasmSizeBytes,
                  wasmPath,
                  isUpgrade: phase === "update" || isUpgrade,
                  contractId: contractId ?? existingContractId ?? "",
                });
              } catch (dbErr) {
                // DB save failure is NOT fatal — the contract is already
                // deployed on-chain. But we DO need to surface it so the
                // user knows the local DB record is stale (they'll need
                // to manually import the contract ID later if they want
                // the interaction panel to find it).
                console.error("[submit] failed to persist deploy record:", dbErr);
                // Include a warning in the response so the client can show it
                return NextResponse.json({
                  hash: txHash,
                  status: "SUCCESS" as const,
                  contractId,
                  isUpgrade: phase === "update" || !!isUpgrade,
                  warning: `Deploy succeeded on-chain but failed to save to local DB: ${
                    dbErr instanceof Error ? dbErr.message : String(dbErr)
                  }. The contract is live at ${contractId ?? "(unknown)"} but won't appear in this project's deploy list.`,
                });
              }
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
 * The `resultXdr` field from `rpc.Server.getTransaction()` is a
 * **TransactionResult** XDR (the full tx result), NOT an OperationResult.
 * The structure is:
 *
 *   TransactionResult
 *     └── results(): OperationResult[]
 *         └── [0] (first — and only — operation)
 *             └── tr(): OperationResultTr
 *                 └── invokeHostFunctionResult(): InvokeHostFunctionResult
 *                                                  (= HostFunctionSuccess | HostFunctionFailure)
 *                     └── value(): ScVal
 *                         └── Address containing the new contract ID (C...)
 *
 * We use `Address.fromScVal()` to convert the ScVal to a contract strkey.
 *
 * Fallback: scan `resultMetaXdr` for any 56-char C... pattern in case the
 * resultXdr path fails (SDK version differences, etc.).
 */
function extractContractIdFromResult(response: {
  resultMetaXdr?: string;
  resultXdr?: string;
}): string | undefined {
  const StellarSdk = require("@stellar/stellar-sdk");
  const { xdr, Address, scValToNative } = StellarSdk;

  // ─── Path 1: parse resultXdr as TransactionResult ──────────────────
  // resultXdr is the FULL TransactionResult (not a single OperationResult).
  // Old code was parsing it as OperationResult, which silently returned
  // garbage — that's why the contract ID was never extracted.
  if (response.resultXdr) {
    try {
      const txResult = xdr.TransactionResult.fromXDR(response.resultXdr, "base64");
      // results() may be undefined if the tx had no operations (impossible for
      // a deploy, but be defensive)
      const opResults = txResult.results?.() ?? [];

      for (const opResult of opResults) {
        try {
          const tr = opResult.tr();
          // For invokeHostFunction-type ops (covers uploadContractWasm,
          // createCustomContract, invokeContractFunction, etc.), the
          // result is an InvokeHostFunctionResult (= HostFunctionSuccess).
          const invokeResult = tr.invokeHostFunctionResult();
          if (!invokeResult) continue;

          // HostFunctionSuccess has .value() returning ScVal
          let scVal;
          try {
            scVal = invokeResult.value();
          } catch {
            // HostFunctionFailure has no .value() — skip
            continue;
          }
          if (!scVal) continue;

          // Try Address.fromScVal first — this is the canonical way
          // to convert an Address ScVal to a strkey
          try {
            const addr = Address.fromScVal(scVal);
            if (addr && addr.toString().startsWith("C")) {
              return addr.toString();
            }
          } catch {
            // not an Address — fall through to other strategies
          }

          // Fallback: scValToNative — sometimes returns the strkey string
          try {
            const native = scValToNative(scVal);
            if (typeof native === "string" && native.startsWith("C") && native.length === 56) {
              return native;
            }
            // Or as an Address-like object with .toString()
            if (native && typeof native === "object" && "toString" in native) {
              const str = String(native.toString());
              if (str.startsWith("C") && str.length === 56) return str;
            }
          } catch {}
        } catch {
          // wrong operation type — continue to next
        }
      }
    } catch (err) {
      console.warn("[submit] failed to parse resultXdr as TransactionResult:", err);
    }
  }

  // ─── Path 2: scan resultMetaXdr for any C... pattern ───────────────
  // Brute-force fallback. The TransactionMeta contains all effects of the
  // tx — including the new contract ID. Slower but catches SDK differences.
  if (response.resultMetaXdr) {
    try {
      const meta = xdr.TransactionMeta.fromXDR(response.resultMetaXdr, "base64");
      // Convert to a string representation and search for any C[A-Z2-7]{55}
      // pattern (Stellar contract IDs are 56 chars: 'C' + 55 base32 chars)
      const metaStr = JSON.stringify(meta, (_, v) =>
        typeof v === "bigint" ? v.toString() : v
      );
      const match = metaStr.match(/C[A-Z2-7]{55}/);
      if (match) {
        return match[0];
      }
    } catch (err) {
      console.warn("[submit] failed to parse resultMetaXdr:", err);
    }
  }

  return undefined;
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
