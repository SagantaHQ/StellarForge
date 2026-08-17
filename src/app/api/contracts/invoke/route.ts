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
 * §Fix (2026-08-16) — Manually decode an ScVal XDR object to a JSON-
 * serializable JavaScript value.
 *
 * scValToNative() from @stellar/stellar-sdk THROWS for many ScVal types:
 *   "The first argument must be of type string, Buffer, ArrayBuffer, Array,
 *    or Array-like Object. Received an instance of ChildUnion"
 *
 * This happens because scValToNative tries to use Buffer.from() on XDR
 * wrapper objects (ChildUnion) that aren't Buffer-compatible.
 *
 * Instead of using scValToNative, we decode the ScVal directly from its
 * XDR structure. The ScVal has a `switch()` method that tells us the type,
 * and arm-specific accessors to get the inner value.
 */
function decodeScVal(scVal: any): unknown {
  if (!scVal) return null;

  const switchName = typeof scVal.switch === "function" ? scVal.switch().name : "";
  
  switch (switchName) {
    case "scvVoid":
      return null;

    case "scvBool": {
      const v = scVal.b();
      return v;
    }

    case "scvU32": {
      return scVal.u32();
    }

    case "scvI32": {
      return scVal.i32();
    }

    case "scvU64":
    case "scvI64":
    case "scvU128":
    case "scvI128":
    case "scvU256":
    case "scvI256": {
      // Large integers — return as string (JS can't represent >2^53)
      try {
        const bigIntVal = scVal.toBigInt ? scVal.toBigInt() : null;
        if (bigIntVal !== null) return bigIntVal.toString();
      } catch {}
      // Fallback: try to get the value via the arm accessor
      try {
        const arm = switchName.replace("scv", "").toLowerCase();
        const v = scVal[arm]();
        if (v) {
          // ScInt has toString()
          if (typeof v.toString === "function") {
            const s = v.toString();
            if (/^-?\d+$/.test(s)) return s;
          }
          // Hi/Lo parts for 128/256
          if (v.hi !== undefined && v.lo !== undefined) {
            const hi = BigInt(v.hi.toString());
            const lo = BigInt(v.lo.toString());
            return (hi * (BigInt(1) << BigInt(64)) + lo).toString();
          }
        }
      } catch {}
      return null;
    }

    case "scvString": {
      // Soroban String — the XDR structure stores it as a Buffer of UTF-8
      // bytes. But depending on the SDK version, str() may return:
      //   1. A Node Buffer (most common) → Buffer.isBuffer(str) === true
      //   2. A Uint8Array → str instanceof Uint8Array === true
      //   3. An XDR String wrapper (older SDKs) → has .buffer or ._value
      //   4. A plain string (newer SDKs)
      //
      // We try ALL of these + fall back to _value (raw XDR field).
      // Every access is try/catch'd so we never throw.
      const tryDecodeBuffer = (b: any): string | null => {
        if (!b) return null;
        if (Buffer.isBuffer(b)) return b.toString("utf-8");
        if (b instanceof Uint8Array) return new TextDecoder().decode(b);
        if (Array.isArray(b)) return Buffer.from(b).toString("utf-8");
        if (b && typeof b === "object" && b.type === "Buffer" && Array.isArray(b.data)) {
          return Buffer.from(b.data).toString("utf-8");
        }
        if (typeof b === "string") return b;
        if (b && typeof b.toString === "function") {
          const s = b.toString();
          if (s && s !== "[object Object]" && s !== "[object Uint8Array]") return s;
        }
        // XDR wrapper — try .buffer or ._value
        if (b && typeof b === "object") {
          if (b.buffer) return tryDecodeBuffer(b.buffer);
          if (b._value) return tryDecodeBuffer(b._value);
          if (b.data) return tryDecodeBuffer(b.data);
        }
        return null;
      };

      // Try str() accessor first
      try {
        const str = scVal.str();
        const decoded = tryDecodeBuffer(str);
        if (decoded !== null) return decoded;
      } catch {}

      // Try _value (raw XDR field — same structure the user saw)
      try {
        const v = scVal._value;
        const decoded = tryDecodeBuffer(v);
        if (decoded !== null) return decoded;
      } catch {}

      // Try getting the XDR bytes directly and re-parsing
      try {
        const xdrBytes = scVal.toXDR();
        // The string content is embedded in the XDR — extract it
        // by looking for printable ASCII after the header
        const str = xdrBytes.toString("utf-8").replace(/[^\x20-\x7E]/g, "");
        if (str && str.length > 0) return str;
      } catch {}

      return null;
    }

    case "scvSymbol":
    case "scvSymbolSmall": {
      // Same approach as scvString — try sym(), then _value, then XDR bytes
      const tryDecodeBuffer = (b: any): string | null => {
        if (!b) return null;
        if (Buffer.isBuffer(b)) return b.toString("utf-8");
        if (b instanceof Uint8Array) return new TextDecoder().decode(b);
        if (Array.isArray(b)) return Buffer.from(b).toString("utf-8");
        if (b && typeof b === "object" && b.type === "Buffer" && Array.isArray(b.data)) {
          return Buffer.from(b.data).toString("utf-8");
        }
        if (typeof b === "string") return b;
        if (b && typeof b.toString === "function") {
          const s = b.toString();
          if (s && s !== "[object Object]" && s !== "[object Uint8Array]") return s;
        }
        if (b && typeof b === "object") {
          if (b.buffer) return tryDecodeBuffer(b.buffer);
          if (b._value) return tryDecodeBuffer(b._value);
          if (b.data) return tryDecodeBuffer(b.data);
        }
        return null;
      };
      try {
        const sym = scVal.sym();
        const decoded = tryDecodeBuffer(sym);
        if (decoded !== null) return decoded;
      } catch {}
      try {
        const v = scVal._value;
        const decoded = tryDecodeBuffer(v);
        if (decoded !== null) return decoded;
      } catch {}
      return null;
    }

    case "scvBytes": {
      const tryDecodeBytes = (b: any): string | null => {
        if (!b) return null;
        if (Buffer.isBuffer(b)) {
          const str = b.toString("utf-8");
          if (/^[\x20-\x7E]*$/.test(str)) return str;
          return b.toString("hex");
        }
        if (b instanceof Uint8Array) {
          const str = new TextDecoder().decode(b);
          if (/^[\x20-\x7E]*$/.test(str)) return str;
          return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
        }
        if (Array.isArray(b)) {
          const buf = Buffer.from(b);
          const str = buf.toString("utf-8");
          if (/^[\x20-\x7E]*$/.test(str)) return str;
          return buf.toString("hex");
        }
        if (b && typeof b === "object" && b.type === "Buffer" && Array.isArray(b.data)) {
          const buf = Buffer.from(b.data);
          const str = buf.toString("utf-8");
          if (/^[\x20-\x7E]*$/.test(str)) return str;
          return buf.toString("hex");
        }
        return null;
      };
      try {
        const b = scVal.bytes();
        const decoded = tryDecodeBytes(b);
        if (decoded !== null) return decoded;
      } catch {}
      try {
        const v = scVal._value;
        const decoded = tryDecodeBytes(v);
        if (decoded !== null) return decoded;
      } catch {}
      return null;
    }

    case "scvAddress": {
      try {
        const addr = scVal.address();
        if (addr) {
          if (typeof addr.toString === "function") {
            const s = addr.toString();
            if (/^[GC][A-Z0-9]{48,55}$/.test(s)) return s;
          }
        }
      } catch {}
      // Try _value
      try {
        const v = scVal._value;
        if (v && typeof v.toString === "function") {
          const s = v.toString();
          if (/^[GC][A-Z0-9]{48,55}$/.test(s)) return s;
        }
      } catch {}
      return null;
    }

    case "scvVec": {
      try {
        const vec = scVal.vec();
        if (vec && typeof vec.map === "function") {
          return vec.map((item: any) => decodeScVal(item));
        }
      } catch {}
      // Try _value
      try {
        const v = scVal._value;
        if (Array.isArray(v)) return v.map((item: any) => decodeScVal(item));
        if (v && typeof v.map === "function") return v.map((item: any) => decodeScVal(item));
      } catch {}
      return [];
    }

    case "scvMap": {
      try {
        const map = scVal.map();
        if (map && typeof map.forEach === "function") {
          const result: Record<string, unknown> = {};
          map.forEach((entry: any) => {
            try {
              const key = decodeScVal(entry.key());
              const val = decodeScVal(entry.val());
              result[String(key)] = val;
            } catch {}
          });
          return result;
        }
      } catch {}
      return {};
    }

    case "scvContractInstance": {
      try {
        const inst = scVal.instance();
        if (inst) {
          return {
            type: "contractInstance",
            address: inst.address ? String(inst.address) : undefined,
          };
        }
      } catch {}
      return null;
    }

    default: {
      // Unknown type — try common accessors
      try {
        if (typeof scVal.b === "function") return scVal.b();
      } catch {}
      try {
        if (typeof scVal.u32 === "function") return scVal.u32();
      } catch {}
      try {
        if (typeof scVal.i32 === "function") return scVal.i32();
      } catch {}
      // Last resort: try _value
      try {
        const v = scVal._value;
        if (v !== undefined) {
          if (Buffer.isBuffer(v)) return v.toString("utf-8");
          if (v instanceof Uint8Array) return new TextDecoder().decode(v);
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
          if (typeof v === "bigint") return v.toString();
        }
      } catch {}
      return `[${switchName || "unknown"}]`;
    }
  }
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
    const { rpc: stellarRpc, BASE_FEE, Operation, TransactionBuilder, nativeToScVal, Address } = StellarSdk;

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

      // Parse the retval (base64 ScVal XDR) and decode to JSON-serializable.
      //
      // §Fix (2026-08-16) — DON'T use scValToNative() — it throws
      // "The first argument must be of type string, Buffer, ArrayBuffer,
      // Array, or Array-like Object. Received an instance of ChildUnion"
      // for scvString and other types.
      //
      // Instead, use decodeScVal() which manually reads the XDR structure
      // via the arm accessors (str(), b(), u32(), vec(), etc.).
      try {
        const scVal = StellarSdk.xdr.ScVal.fromXDR(result.retval, "base64");
        const decoded = decodeScVal(scVal);
        return NextResponse.json({
          result: decoded,
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
