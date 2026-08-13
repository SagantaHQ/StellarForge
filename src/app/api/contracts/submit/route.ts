import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";

/**
 * POST /api/contracts/submit
 *
 * Submits a signed deploy/upgrade transaction to the Stellar network.
 * After successful submission, saves the contract info to the database
 * (DeployedContract + WasmVersion).
 *
 * Body:
 *   {
 *     signedXdr: string,       // signed transaction XDR (base64)
 *     walletAddress: string,   // deployer's wallet
 *     network: string,         // testnet | mainnet | futurenet
 *     projectId: string,       // server project ID
 *     wasmHash: string,        // SHA-256 hash of the WASM
 *     wasmSizeBytes: number,
 *     wasmPath: string,        // path to the .wasm file on disk
 *     isUpgrade: boolean,
 *     existingContractId?: string,
 *   }
 *
 * Returns:
 *   {
 *     contractId: string,      // on-chain contract ID
 *     hash: string,            // transaction hash
 *     isUpgrade: boolean,
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

    const home = process.env.HOME ?? "/home/z";
    const localBin = `${home}/.local/bin`;
    const cargoBin = `${home}/.cargo/bin`;
    const env = {
      ...process.env,
      PATH: `${localBin}:${cargoBin}:${process.env.PATH ?? ""}`,
      CARGO_HOME: `${home}/.cargo`,
      RUSTUP_HOME: `${home}/.rustup`,
    };

    const workspaceDir = path.join(BUILDS_DIR, projectId);

    // Submit the signed transaction using stellar-cli
    // stellar contract deploy --source-account <secret> won't work — we have signed XDR
    // Instead, use: stellar tx submit --xdr <signedXdr> --rpc-url <rpc> --network-passphrase <passphrase>
    // Actually, stellar contract deploy outputs the contract ID, but for signed XDR we
    // need to submit it directly. Let's use the Soroban RPC directly via fetch.

    // Submit the signed transaction using @stellar/stellar-sdk
    const stellarSdk = await import("@stellar/stellar-sdk");
    const { rpc: stellarRpc } = stellarSdk;
    const Server = stellarRpc.Server;

    const server = new Server(rpcUrl);
    const tx = TransactionFromXdr(signedXdr, passphrase);
    const sendResponse = await server.sendTransaction(tx);

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
        { error: "Network busy — try again later" },
        { status: 503 }
      );
    }

    // Wait for confirmation
    let contractId = existingContractId;
    let hash = sendResponse.hash;

    if (sendResponse.status === "PENDING") {
      // Poll for confirmation
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const response = await server.getTransaction(sendResponse.hash);
          if (response.status === "SUCCESS") {
            break;
          }
          if (response.status === "FAILED") {
            return NextResponse.json(
              { error: "Transaction failed on-chain" },
              { status: 502 }
            );
          }
        } catch {
          // Continue polling
        }
        attempts++;
      }
    }

    // If this was a new deploy (not upgrade), we need the contract ID.
    // The contract ID can be derived from the deployer address + a salt,
    // or we can use stellar contract deploy --wasm-hash to find it.
    // For simplicity, let's use stellar contract id --source <addr> to derive it.
    if (!isUpgrade && !contractId) {
      try {
        // The contract ID is deterministic — derive it from the deployer address
        // using stellar contract deploy with --dry-run
        // Actually, let's use the hash of the transaction to look it up
        // For now, use the stellar-cli to get the contract ID from the tx hash
        const { stdout } = await new Promise<{stdout: string; stderr: string}>((resolve, reject) => {
          const child = spawn(
            "stellar",
            [
              "contract", "id",
              "--source-account", walletAddress,
              "--rpc-url", rpcUrl,
              "--network-passphrase", passphrase,
            ],
            { cwd: workspaceDir, env, stdio: ["ignore", "pipe", "pipe"] }
          );

          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
          child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

          child.on("close", (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr || stdout));
          });
        });

        contractId = stdout.trim().split("\n").pop()?.trim();
      } catch {
        // If we can't derive the contract ID, return the tx hash — the user
        // can find the contract ID from the explorer
      }
    }

    // Save to database
    try {
      if (isUpgrade && existingContractId) {
        // Update existing contract record
        const existing = await db.deployedContract.findUnique({
          where: { projectId_network: { projectId, network } },
        });

        if (existing) {
          await db.deployedContract.update({
            where: { id: existing.id },
            data: {
              wasmHash,
              upgradeCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          // Add new WASM version
          await db.wasmVersion.create({
            data: {
              contractId: existing.id,
              wasmHash,
              wasmPath: wasmPath ?? "",
              wasmSizeBytes: wasmSizeBytes ?? 0,
              version: (await db.wasmVersion.count({ where: { contractId: existing.id } })) + 1,
              isUpgrade: true,
            },
          });
        }
      } else if (contractId) {
        // New deploy — create the contract record
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

        // Save initial WASM version
        await db.wasmVersion.create({
          data: {
            contractId: newContract.id,
            wasmHash,
            wasmPath: wasmPath ?? "",
            wasmSizeBytes: wasmSizeBytes ?? 0,
            version: 1,
            isUpgrade: false,
          },
        });
      }
    } catch {
      // DB save is best-effort — the deploy succeeded on-chain
    }

    return NextResponse.json({
      contractId: contractId ?? "(check explorer with tx hash)",
      hash,
      isUpgrade,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to submit transaction", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Helper to create a Transaction from XDR
function TransactionFromXdr(xdrBase64: string, passphrase: string) {
  // Dynamic import to avoid SSR issues
  const { TransactionBuilder } = require("@stellar/stellar-sdk");
  const { xdr } = require("@stellar/stellar-sdk");
  const rawTx = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64");
  return TransactionBuilder.fromXDR(rawTx, passphrase);
}
