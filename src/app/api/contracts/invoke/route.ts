import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/contracts/invoke
 *
 * Invoke a function on a deployed Soroban contract using @stellar/stellar-sdk
 * directly (no CLI subprocess — much faster than spawning `stellar contract invoke`).
 *
 * Two modes:
 *   1. READ (simulation only): for view/pure functions that don't modify state.
 *      Uses server.simulateTransaction() — no wallet signing needed, no fee.
 *      Returns the result immediately.
 *   2. WRITE (transaction): for functions that modify state.
 *      Builds the tx, simulates, returns unsigned XDR for the wallet to sign.
 *      The client then signs via appkit.signTransaction and submits via
 *      /api/contracts/submit (phase="invoke").
 *
 * Body:
 *   {
 *     contractId: string,       // "C..." on-chain contract ID
 *     network: string,          // testnet | mainnet | futurenet | local
 *     function: string,         // contract function name (e.g. "increment")
 *     args?: unknown[],         // native JS values, converted via nativeToScVal
 *     mode?: "read" | "write",  // default: "read"
 *     walletAddress?: string,   // required for "write" (signer source)
 *   }
 *
 * Returns (mode="read"):
 *   { result: unknown }   // the function's return value, converted via scValToNative
 *
 * Returns (mode="write"):
 *   {
 *     unsignedXdr: string,  // unsigned transaction XDR for wallet signing
 *     networkPassphrase: string,
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
    const { contractId, network, function: fnName, args, mode = "read", walletAddress } = body;

    if (!contractId || !network || !fnName) {
      return NextResponse.json(
        { error: "Missing required fields: contractId, network, function" },
        { status: 400 }
      );
    }

    if (mode === "write" && !walletAddress) {
      return NextResponse.json(
        { error: "walletAddress is required for write mode (transactions need a source account)" },
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

    // Load the Stellar SDK
    const StellarSdk = await import("@stellar/stellar-sdk");
    const { rpc: stellarRpc, BASE_FEE, Operation, TransactionBuilder, nativeToScVal, scValToNative, Address } = StellarSdk;

    const server = new stellarRpc.Server(rpc);

    // Convert native JS args to ScVal[] — same approach as create-tx.
    // For typed args (Address, ScInt), the client should pass SDK types
    // directly. Basic types (u32, string, bool, vec, map) are inferred.
    //
    // Special case: the client may send { __type: "address", value: "G..." }
    // to indicate an Address type — we convert via new Address(value).toScVal()
    // because nativeToScVal treats strings as scvString, not scvAddress.
    const scValArgs: ReturnType<typeof nativeToScVal>[] = [];
    if (Array.isArray(args) && args.length > 0) {
      for (let i = 0; i < args.length; i++) {
        try {
          const arg = args[i];

          // Address type marker — convert via SDK Address
          if (
            arg &&
            typeof arg === "object" &&
            !Array.isArray(arg) &&
            !Buffer.isBuffer(arg) &&
            (arg as { __type?: string }).__type === "address"
          ) {
            const addrValue = (arg as { value: string }).value;
            try {
              const addr = new Address(addrValue);
              scValArgs.push(addr.toScVal());
              continue;
            } catch (err) {
              throw new Error(
                `args[${i}] is marked as Address but value "${addrValue}" is not a valid Stellar address: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          }

          // Default: nativeToScVal handles u32, u64, i32, i64, u128, i128,
          // string, bool, vec, map, bytes, null.
          scValArgs.push(nativeToScVal(arg));
        } catch (err) {
          return NextResponse.json(
            {
              error: `Failed to convert args[${i}] to ScVal`,
              detail: err instanceof Error ? err.message : String(err),
              argType: typeof args[i],
              argValue: String(args[i]).substring(0, 100),
            },
            { status: 400 }
          );
        }
      }
    }

    // Build the contract address from the contract ID (C...)
    let contractAddress: InstanceType<typeof Address>;
    try {
      contractAddress = new Address(contractId);
    } catch (err) {
      return NextResponse.json(
        {
          error: "Invalid contractId — must be a 56-char Stellar contract address starting with 'C'",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 400 }
      );
    }

    // ─── READ mode: simulate only, no transaction ────────────────────
    // Use server.simulateTransaction() to dry-run the call. This is free
    // (no fee) and instant — perfect for view functions like get_count,
    // balance_of, etc.
    if (mode === "read") {
      // For simulation, we still need a TransactionBuilder, but the source
      // account doesn't need to be funded — we can use a fake account.
      // Use the contract ID's derived account as a placeholder.
      const fakeAccount = new StellarSdk.Account(
        contractAddress.toString(),
        "0" // sequence number — doesn't matter for simulation
      );

      const txBuilder = new TransactionBuilder(fakeAccount, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      });

      txBuilder.addOperation(
        Operation.invokeContractFunction({
          contract: contractAddress.toString(),
          function: fnName,
          args: scValArgs,
        })
      );
      txBuilder.setTimeout(30);

      const tx = txBuilder.build();

      // Simulate — this returns the result without submitting
      let simResponse;
      try {
        simResponse = await server.simulateTransaction(tx);
      } catch (err) {
        return NextResponse.json(
          {
            error: "Simulation failed — the function may not exist, or the args are wrong.",
            detail: err instanceof Error ? err.message : String(err),
          },
          { status: 400 }
        );
      }

      // Check for simulation errors
      if (simResponse.error) {
        return NextResponse.json(
          {
            error: "Simulation failed",
            detail: simResponse.error,
          },
          { status: 400 }
        );
      }

      // Extract the result from the simulation
      // simulateTransaction returns ApiSimulateTransactionResponse with
      // .result — for invokeContractFunction, it's an ApiHostFunctionResult
      // with .retval being the ScVal return value.
      const result = (simResponse as { result?: { retval?: string } }).result;
      if (!result || !result.retval) {
        return NextResponse.json({
          result: null,
          message: "Function returned void (no return value)",
        });
      }

      // Parse the retval (base64 ScVal XDR) and convert to native
      try {
        const scVal = StellarSdk.xdr.ScVal.fromXDR(result.retval, "base64");
        const native = scValToNative(scVal);
        return NextResponse.json({
          result: native,
          scvalType: scVal.switch().name,
        });
      } catch (err) {
        return NextResponse.json({
          result: result.retval,
          raw: true,
          error: `Failed to decode result: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // ─── WRITE mode: build a real transaction ────────────────────────
    // Fetch the source account (must be funded on the network)
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
            (friendbotUrl ? ` Fund it first: ${friendbotUrl}` : ""),
        },
        { status: 400 }
      );
    }

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    });

    txBuilder.addOperation(
      Operation.invokeContractFunction({
        contract: contractAddress.toString(),
        function: fnName,
        args: scValArgs,
        // source: walletAddress,  // optional — defaults to tx source
      })
    );
    txBuilder.setTimeout(300);

    const tx = txBuilder.build();

    // Simulate + prepare (attach resource footprint + fees)
    let preparedTx;
    try {
      preparedTx = await server.prepareTransaction(tx);
    } catch (err) {
      return NextResponse.json(
        {
          error: "Simulation failed — the function call cannot be prepared.",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      unsignedXdr: preparedTx.toXDR(),
      networkPassphrase: passphrase,
      network,
      contractId,
      function: fnName,
    });
  } catch (err) {
    console.error("[invoke] error:", err);
    return NextResponse.json(
      {
        error: "Failed to invoke contract function",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
