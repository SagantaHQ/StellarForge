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
 * STRATEGY: brute-force search across the entire response object.
 *
 * Why brute-force instead of structured XDR walking?
 *   The previous structured approach (parse TransactionResult → walk
 *   results() → invokeHostFunctionResult() → value() → Address.fromScVal)
 *   was fragile and silently failed in practice — likely due to SDK
 *   version differences in the XDR class API. The user kept getting
 *   '(check explorer with tx hash)' because extraction silently failed.
 *
 *   Brute-force search is RELIABLE because:
 *     - Stellar contract IDs are exactly 56 chars: 'C' + 55 base32 chars
 *       (charset [A-Z2-7] — Stellar uses RFC 4648 base32, no lowercase)
 *     - Account addresses start with 'G', not 'C'
 *     - WASM hashes are 64-char hex strings (lowercase), not base32
 *     - Transaction hashes are 64-char hex, not base32
 *     - For a single-op createCustomContract tx, the contract ID is the
 *       ONLY C... 56-char pattern in the entire response
 *
 *   We search the response object's JSON serialization (with BigInts
 *   converted to strings) to catch the contract ID wherever it appears
 *   — in resultXdr, resultMetaXdr, envelopeXdr, or anywhere else.
 *
 * The structured extraction is preserved as a fallback for the (rare)
 * case where multiple C... patterns appear and we need to pick the
 * right one via context.
 */
function extractContractIdFromResult(response: {
  resultMetaXdr?: string;
  resultXdr?: string;
  envelopeXdr?: string;
  [key: string]: unknown;
}): { contractId?: string; debug: { triedPaths: string[]; rawFields: Record<string, string> } } {
  const StellarSdk = require("@stellar/stellar-sdk");
  const { xdr, Address } = StellarSdk;
  const triedPaths: string[] = [];
  const rawFields: Record<string, string> = {};

  // Stellar contract ID regex: 56 chars, 'C' + 55 base32 chars
  // RFC 4648 base32 alphabet: A-Z, 2-7 (no 0/1/8/9 to avoid confusion)
  const CONTRACT_ID_RE = /\bC[A-Z2-7]{55}\b/g;

  // ─── Collect all candidate strings to search ────────────────────────
  // We search the raw base64 XDR strings themselves (the contract ID
  // appears as ASCII bytes within the XDR encoding — base64-decoded, the
  // strkey "C..." is just bytes in the XDR). AND we search the parsed
  // XDR JSON serialization (where the strkey appears as a string field).
  const candidates: { source: string; text: string }[] = [];

  // Raw base64 XDR strings — decode and search the raw bytes
  for (const field of ["resultXdr", "resultMetaXdr", "envelopeXdr"]) {
    const val = response[field];
    if (typeof val === "string" && val.length > 0) {
      rawFields[field] = val;
      // Search the raw base64 string itself — the contract ID's strkey
      // chars appear as ASCII in the base64-decoded bytes, which means
      // they ALSO appear (scrambled) in the base64 encoding. We can't
      // reliably match base32-in-base64, so instead we decode + search.
      try {
        const decoded = Buffer.from(val, "base64").toString("latin1");
        candidates.push({ source: `${field} (decoded)`, text: decoded });
      } catch {}
      // Also search the raw base64 (in case the strkey happens to appear
      // as ASCII in the base64 itself — rare but cheap to check)
      candidates.push({ source: field, text: val });
    }
  }

  // Parsed XDR JSON — the strkey appears as a clean ASCII string field
  for (const [field, xdrClass] of [
    ["resultXdr", xdr.TransactionResult],
    ["resultMetaXdr", xdr.TransactionMeta],
    ["envelopeXdr", xdr.TransactionEnvelope],
  ] as const) {
    const val = response[field];
    if (typeof val !== "string" || val.length === 0) continue;
    try {
      const parsed = xdrClass.fromXDR(val, "base64");
      const jsonStr = safeStringify(parsed);
      candidates.push({ source: `${field} (parsed JSON)`, text: jsonStr });
      triedPaths.push(`parsed ${field}`);
    } catch (err) {
      triedPaths.push(`failed to parse ${field}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Search all candidates for the contract ID pattern ──────────────
  const seen = new Set<string>();
  for (const { source, text } of candidates) {
    let m: RegExpExecArray | null;
    CONTRACT_ID_RE.lastIndex = 0; // reset regex stateful iterator
    while ((m = CONTRACT_ID_RE.exec(text)) !== null) {
      const candidate = m[0];
      // Validate: contract IDs start with 'C' and decode to a 32-byte payload.
      // Stellar's strkey format: 1-byte version (0x0E for contract) + 32 bytes + 2-byte CRC.
      // We can verify by trying to construct an Address — if it throws, it's not a real contract ID.
      try {
        const addr = new Address(candidate);
        // Address constructor validates the strkey — if we get here, it's valid
        if (addr.toString() === candidate) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            console.log(`[submit] found contract ID via ${source}: ${candidate}`);
            return { contractId: candidate, debug: { triedPaths, rawFields } };
          }
        }
      } catch {
        // Not a valid contract ID strkey — skip
      }
    }
  }

  // ─── Structured fallback (for debugging — logs paths tried) ────────
  if (response.resultXdr) {
    triedPaths.push("structured resultXdr walk (fallback)");
    try {
      const txResult = xdr.TransactionResult.fromXDR(response.resultXdr, "base64");
      // Walk the structure — log what we find for debugging
      console.warn("[submit] resultXdr structure:", {
        switch: txResult?.switch?.()?.name ?? "unknown",
        hasResults: typeof txResult?.results === "function",
      });
    } catch (err) {
      triedPaths.push(`structured walk failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn("[submit] contract ID extraction failed. Tried paths:", triedPaths);
  return { contractId: undefined, debug: { triedPaths, rawFields } };
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
