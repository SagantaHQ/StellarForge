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

/**
 * §Fix (2026-08-16) — Convert scValToNative() output to a JSON-serializable
 * primitive/object.
 *
 * scValToNative() returns SDK-specific types that aren't JSON-serializable:
 *   - ScInt → { _value, _arm, ... } (raw XDR structure)
 *   - Address → "G..." string (this one is fine)
 *   - Buffer/Uint8Array → { type: "Buffer", data: [...] } (Node Buffer JSON)
 *   - XDR wrappers → { _switch, _arm, _value, ... } (raw XDR structure)
 *
 * This function handles all these cases + falls back to JSON.stringify
 * for anything unexpected.
 */
function serializeScValResult(native: unknown, scVal: unknown): unknown {
  // null / undefined / boolean / number / string — already serializable
  if (native === null || native === undefined) return native;
  if (typeof native === "boolean" || typeof native === "number" || typeof native === "string") {
    return native;
  }

  // BigInt (i128, u128, i64, u64) — convert to string
  if (typeof native === "bigint") {
    return native.toString();
  }

  // Array — recurse
  if (Array.isArray(native)) {
    return native.map((item) => serializeScValResult(item, undefined));
  }

  // Plain object — recurse over values
  if (typeof native === "object") {
    // Address (stellar-sdk) — has toString() returning "G..." or "C..."
    if (typeof (native as { toString?: () => string }).toString === "function") {
      const str = (native as { toString: () => string }).toString();
      // If toString returns a valid Stellar address (starts with G or C),
      // return the string. This catches Address + ScVal types with toString.
      if (/^[GC][A-Z0-9]{48,55}$/.test(str)) {
        return str;
      }
    }

    // Buffer / Uint8Array — convert to string (UTF-8 if printable, else hex)
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(native)) {
      const buf = native as Buffer;
      // Try UTF-8 first — if it's a Soroban String, the bytes are UTF-8
      try {
        const str = buf.toString("utf-8");
        // Check if it's printable ASCII/UTF-8 (no null bytes, no control chars)
        if (/^[\x20-\x7E\xA0-\xFF\n\r\t]*$/.test(str)) {
          return str;
        }
      } catch {}
      // Fallback: hex string
      return buf.toString("hex");
    }

    // Uint8Array (not a Buffer) — same treatment
    if (native instanceof Uint8Array) {
      try {
        const str = new TextDecoder().decode(native);
        if (/^[\x20-\x7E\xA0-\xFF\n\r\t]*$/.test(str)) {
          return str;
        }
      } catch {}
      return Array.from(native).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // ScInt / large number types — have a toString() that returns the number
    // Check for common SDK number-like types
    const numStr = (native as { toString?: () => string }).toString?.();
    if (numStr && /^\d+$/.test(numStr)) {
      return numStr;
    }

    // Object with _value / _arm / _switch — raw XDR structure that
    // scValToNative didn't fully convert. Try to extract the inner value.
    const xdrObj = native as { _value?: unknown; _arm?: string; _switch?: { name?: string } };
    if (xdrObj._arm !== undefined || xdrObj._switch !== undefined) {
      // This is an XDR wrapper — try to get the inner value
      if (xdrObj._value !== undefined) {
        // For scvString, _value is a Buffer — convert to string
        if (Buffer.isBuffer(xdrObj._value) || xdrObj._value instanceof Uint8Array) {
          try {
            const buf = Buffer.isBuffer(xdrObj._value)
              ? xdrObj._value
              : Buffer.from(xdrObj._value as Uint8Array);
            return buf.toString("utf-8");
          } catch {
            return String(xdrObj._value);
          }
        }
        // For other types, recurse
        return serializeScValResult(xdrObj._value, undefined);
      }
      // No _value — return the switch name as a fallback
      if (xdrObj._switch?.name) {
        return `[${xdrObj._switch.name}]`;
      }
    }

    // Generic object — try to serialize its keys/values
    try {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(native as Record<string, unknown>)) {
        // Skip internal XDR fields (start with _)
        if (key.startsWith("_")) continue;
        result[key] = serializeScValResult(value, undefined);
      }
      if (Object.keys(result).length > 0) {
        return result;
      }
    } catch {}

    // Last resort: stringify
    try {
      return JSON.parse(JSON.stringify(native, (_key, val) =>
        typeof val === "bigint" ? val.toString() : val
      ));
    } catch {
      return String(native);
    }
  }

  return String(native);
}

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
      // §Fix (2026-08-16) — for simulation, we need a valid Stellar account
      // ID (G...) as the source, NOT the contract ID (C...). The old code
      // used contractAddress.toString() which starts with 'C' — the SDK's
      // Account constructor accepted it, but the RPC server rejected it
      // with "accountId is invalid" when simulating.
      //
      // For read-only simulation, the source account doesn't need to be
      // funded or even exist on-ledger — the simulator just needs a
      // syntactically valid G... address. We use the caller's wallet
      // address if provided (write mode), or a well-known dummy address.
      //
      // The Stellar testnet account GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF is
      // a commonly-used dummy — it's syntactically valid but not funded.
      // Alternatively, if walletAddress is provided, use that.
      const simSourceAccount = walletAddress || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const fakeAccount = new StellarSdk.Account(
        simSourceAccount,
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

      // Parse the retval (base64 ScVal XDR) and convert to a
      // JSON-serializable native value.
      //
      // §Fix (2026-08-16) — scValToNative() returns SDK-specific types
      // (ScInt, Address, Buffer-like objects, XDR wrappers) that are NOT
      // directly JSON-serializable. When NextResponse.json() tries to
      // serialize them, it produces the raw internal XDR structure
      // (with _switch, _arm, _value, etc.) instead of the actual value.
      //
      // Fix: use scValToNative() for basic types, but manually convert
      // SDK types to plain JS primitives/objects before returning.
      try {
        const scVal = StellarSdk.xdr.ScVal.fromXDR(result.retval, "base64");
        const native = scValToNative(scVal);

        // Convert SDK-specific types to JSON-serializable primitives
        const serialized = serializeScValResult(native, scVal);

        return NextResponse.json({
          result: serialized,
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
