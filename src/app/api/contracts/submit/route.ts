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
            let extractionDebug: { triedPaths: string[]; rawFields: Record<string, string> } | undefined;

            if (phase === "create") {
              const extraction = extractContractIdFromResult(response);
              contractId = extraction.contractId;
              extractionDebug = extraction.debug;
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
              // Include debug info so the client can surface WHY the contract
              // ID extraction failed — the user can copy/paste the raw XDRs
              // from the network tab into a Stellar XDR inspector.
              ...(phase === "create" && !contractId
                ? {
                    extractionFailed: true,
                    extractionDebug,
                    hint:
                      "Contract ID could not be extracted from the transaction result. The deploy succeeded on-chain — use the tx hash above to look up the contract ID on https://testnet.stellarchain.io/tx/" + txHash,
                  }
                : {}),
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
 * ROOT CAUSE of previous failures:
 *   The contract ID is stored as a RAW 32-BYTE HASH in the XDR — NOT as
 *   a strkey string ("C..."). So scanning the response for `C[A-Z2-7]{55}`
 *   doesn't find it (the hash bytes don't match that pattern).
 *
 *   The correct path is to walk the XDR structure:
 *     resultMetaXdr → TransactionMeta → v3 → sorobanMeta → returnValue
 *       → ScVal (scvAddress) → Address.fromScVal() → strkey
 *
 *   OR from resultXdr:
 *     TransactionResult → results[0] → tr → invokeHostFunctionResult
 *       → invokeHostFunctionSuccess → returnValue → ScVal → Address.fromScVal
 *
 *   We try BOTH paths + a fallback that scans ContractEvents in the
 *   SorobanTransactionMeta for any event whose contractId field (raw
 *   32-byte hash) can be converted via StrKey.encodeContract.
 */
function extractContractIdFromResult(response: {
  resultMetaXdr?: string;
  resultXdr?: string;
  envelopeXdr?: string;
  [key: string]: unknown;
}): { contractId?: string; debug: { triedPaths: string[]; rawFields: Record<string, string> } } {
  const StellarSdk = require("@stellar/stellar-sdk");
  const { xdr, Address, StrKey, scValToNative } = StellarSdk;
  const triedPaths: string[] = [];
  const rawFields: Record<string, string> = {};

  // Save raw XDR strings for debugging
  for (const field of ["resultXdr", "resultMetaXdr", "envelopeXdr"]) {
    const val = response[field];
    if (typeof val === "string" && val.length > 0) {
      rawFields[field] = val.substring(0, 200) + (val.length > 200 ? "…" : "");
    }
  }

  // ─── Path 1: resultMetaXdr → TransactionMeta → v3 → sorobanMeta → returnValue ──
  // For createCustomContract, the SorobanTransactionMeta contains a
  // returnValue which is an ScVal of type scvAddress containing the
  // new contract ID. This is the MOST RELIABLE path.
  if (response.resultMetaXdr) {
    triedPaths.push("resultMetaXdr → sorobanMeta.returnValue");
    try {
      const meta = xdr.TransactionMeta.fromXDR(response.resultMetaXdr, "base64");
      const contractId = tryExtractFromTransactionMeta(meta, xdr, Address, StrKey, scValToNative, triedPaths);
      if (contractId) {
        console.log(`[submit] extracted contract ID from TransactionMeta: ${contractId}`);
        return { contractId, debug: { triedPaths, rawFields } };
      }
    } catch (err) {
      triedPaths.push(`resultMetaXdr parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Path 2: resultXdr → TransactionResult → results[0] → invokeHostFunctionResult ──
  // The OperationResult for createCustomContract contains an
  // InvokeHostFunctionResult. For success, the inner value is an ScVal
  // (scvAddress) containing the contract ID.
  if (response.resultXdr) {
    triedPaths.push("resultXdr → results[0].tr.invokeHostFunctionResult");
    try {
      const txResult = xdr.TransactionResult.fromXDR(response.resultXdr, "base64");
      const opResults = txResult.results?.() ?? [];
      for (const opResult of opResults) {
        try {
          const tr = opResult.tr();
          const invokeResult = tr.invokeHostFunctionResult();
          if (!invokeResult) continue;

          // The success arm — try to get the returnValue (ScVal)
          let scVal;
          try {
            scVal = invokeResult.success();
          } catch {
            continue; // not a success — skip
          }
          if (!scVal) continue;

          // Try Address.fromScVal — the canonical conversion
          try {
            const addr = Address.fromScVal(scVal);
            if (addr && addr.toString().startsWith("C") && addr.toString().length === 56) {
              console.log(`[submit] extracted contract ID from resultXdr success ScVal: ${addr.toString()}`);
              return { contractId: addr.toString(), debug: { triedPaths, rawFields } };
            }
          } catch {}

          // Fallback: scValToNative might return the strkey as a string
          try {
            const native = scValToNative(scVal);
            if (typeof native === "string" && native.startsWith("C") && native.length === 56) {
              console.log(`[submit] extracted contract ID from scValToNative: ${native}`);
              return { contractId: native, debug: { triedPaths, rawFields } };
            }
          } catch {}
        } catch {
          // wrong operation type — continue
        }
      }
    } catch (err) {
      triedPaths.push(`resultXdr parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Path 3: Last-resort brute-force scan for strkey pattern ──
  // This catches the rare case where the contract ID appears as a strkey
  // string somewhere in the JSON-serialized XDR (some SDK versions
  // serialize Hash fields as strkeys in their toJSON method).
  triedPaths.push("brute-force strkey scan (last resort)");
  const CONTRACT_ID_RE = /\bC[A-Z2-7]{55}\b/g;
  for (const field of ["resultMetaXdr", "resultXdr", "envelopeXdr"]) {
    const val = response[field];
    if (typeof val !== "string" || val.length === 0) continue;
    try {
      const parsed = xdr.TransactionMeta.fromXDR(val, "base64");
      const jsonStr = safeStringify(parsed);
      CONTRACT_ID_RE.lastIndex = 0;
      const m = CONTRACT_ID_RE.exec(jsonStr);
      if (m) {
        try {
          const addr = new Address(m[0]);
          if (addr.toString() === m[0]) {
            console.log(`[submit] extracted contract ID via brute-force scan in ${field}: ${m[0]}`);
            return { contractId: m[0], debug: { triedPaths, rawFields } };
          }
        } catch {}
      }
    } catch {}
  }

  console.warn("[submit] contract ID extraction failed. Tried paths:", triedPaths);
  return { contractId: undefined, debug: { triedPaths, rawFields } };
}

/**
 * Walk a TransactionMeta XDR object looking for the contract ID.
 *
 * Tries multiple sub-paths:
 *   1. v3.sorobanMeta.returnValue (ScVal → Address.fromScVal)
 *   2. v2.sorobanMeta.returnValue
 *   3. v3.sorobanMeta.events[].event.contractId (raw 32-byte Hash → StrKey.encodeContract)
 *   4. v3.sorobanMeta.events[].event.data (ScVal → might be Address)
 *   5. v1.changes / v2.changes / v3.changes — LEDGER_ENTRY_CREATED with ContractCode (has contract hash)
 *
 * Returns the first valid contract ID strkey found, or undefined.
 */
function tryExtractFromTransactionMeta(
  meta: any,
  xdr: any,
  Address: any,
  StrKey: any,
  scValToNative: any,
  triedPaths: string[]
): string | undefined {
  // Helper: convert a 32-byte Buffer to a contract strkey
  const hashToStrkey = (hash: Buffer | Uint8Array): string | undefined => {
    try {
      const buf = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
      if (buf.length !== 32) return undefined;
      const strkey = StrKey.encodeContract(buf);
      return strkey;
    } catch {
      return undefined;
    }
  };

  // Helper: try to extract contract ID from an ScVal
  const scValToContractId = (scVal: any): string | undefined => {
    if (!scVal) return undefined;
    try {
      const addr = Address.fromScVal(scVal);
      const str = addr.toString();
      if (str.startsWith("C") && str.length === 56) return str;
    } catch {}
    try {
      const native = scValToNative(scVal);
      if (typeof native === "string" && native.startsWith("C") && native.length === 56) return native;
    } catch {}
    return undefined;
  };

  // ─── Try v3 (current Soroban format) ──
  try {
    const v3 = meta.v3();
    if (v3) {
      const sorobanMeta = v3.sorobanMeta?.();
      if (sorobanMeta) {
        // Path 1: returnValue (for createCustomContract, this is the contract ID)
        try {
          const returnValue = sorobanMeta.returnValue?.();
          if (returnValue) {
            const id = scValToContractId(returnValue);
            if (id) {
              triedPaths.push("v3.sorobanMeta.returnValue → contract ID");
              return id;
            }
          }
        } catch {}

        // Path 2: events → contractId field (raw 32-byte hash)
        try {
          const txEvents = sorobanMeta.events?.() ?? [];
          for (const txEvent of txEvents) {
            const contractEvent = txEvent.event?.();
            if (!contractEvent) continue;
            // The contractId field is a Hash (raw 32 bytes)
            const contractIdHash = contractEvent.contractId?.();
            if (contractIdHash) {
              const id = hashToStrkey(contractIdHash);
              if (id) {
                triedPaths.push("v3.sorobanMeta.events[].contractId → StrKey");
                return id;
              }
            }
            // The data field might be an ScVal containing the address
            try {
              const data = contractEvent.body?.()?.data?.();
              if (data) {
                const id = scValToContractId(data);
                if (id) {
                  triedPaths.push("v3.sorobanMeta.events[].body.data → contract ID");
                  return id;
                }
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {
    // not v3 — continue
  }

  // ─── Try v2 (older Soroban format) ──
  try {
    const v2 = meta.v2();
    if (v2) {
      const sorobanMeta = v2.sorobanMeta?.();
      if (sorobanMeta) {
        try {
          const returnValue = sorobanMeta.returnValue?.();
          if (returnValue) {
            const id = scValToContractId(returnValue);
            if (id) {
              triedPaths.push("v2.sorobanMeta.returnValue → contract ID");
              return id;
            }
          }
        } catch {}

        try {
          const txEvents = sorobanMeta.events?.() ?? [];
          for (const txEvent of txEvents) {
            const contractEvent = txEvent.event?.();
            if (!contractEvent) continue;
            const contractIdHash = contractEvent.contractId?.();
            if (contractIdHash) {
              const id = hashToStrkey(contractIdHash);
              if (id) {
                triedPaths.push("v2.sorobanMeta.events[].contractId → StrKey");
                return id;
              }
            }
          }
        } catch {}
      }
    }
  } catch {
    // not v2 — continue
  }

  // ─── Try v1 (very old format — just operations + changes) ──
  try {
    const v1 = meta.v1?.();
    if (v1) {
      // v1 has changes — scan for LEDGER_ENTRY_CREATED with contract entries
      const changes = v1.changes?.() ?? [];
      for (const change of changes) {
        try {
          // LEDGER_ENTRY_CREATED has a created() method returning LedgerEntry
          const created = change.created?.();
          if (!created) continue;
          // Check if it's a ContractCode entry — its key contains the contract hash
          const data = created.data?.();
          if (data && data.contractCode) {
            const contractHash = data.contractCode().hash?.();
            if (contractHash) {
              const id = hashToStrkey(contractHash);
              if (id) {
                triedPaths.push("v1.changes[].created.contractCode.hash → StrKey");
                return id;
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return undefined;
}

/**
 * JSON.stringify with BigInt support — XDR objects often contain BigInts
 * (u128, i128) which JSON.stringify can't serialize natively.
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  }, 0);
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
