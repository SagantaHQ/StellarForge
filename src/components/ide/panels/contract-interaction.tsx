"use client";

import { useState, useMemo } from "react";
import { Play, Copy, Check, FunctionSquare, Eye, Send, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  parseContractSpec,
  defaultValueForType,
  formatInvokeResult,
  type ContractFunction,
} from "@/lib/soroban/spec-parser";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProfileStore } from "@/stores/profile-store";
import { findFile } from "@/lib/soroban/sample-project";

interface ContractInteractionPanelProps {
  contractId?: string;
  network?: string;
}

type InvokeMode = "read" | "write";
type InvokeState = {
  loading: boolean;
  result?: unknown;
  error?: string;
  txHash?: string;
  pendingSign?: boolean; // true when waiting for wallet signature
};

export function ContractInteractionPanel({
  contractId,
  network = "testnet",
}: ContractInteractionPanelProps) {
  const tree = useFileSystemStore((s) => s.tree);
  const profile = useProfileStore((s) => s.profile);
  const walletConnected = useProfileStore((s) => s.walletConnected);

  // Per-function state: arg values + invoke state (loading/result/error)
  const [argValues, setArgValues] = useState<Record<string, Record<string, string>>>({});
  const [invokeStates, setInvokeStates] = useState<Record<string, InvokeState>>({});

  // Manual contract ID entry — used when the deploy succeeded but contract
  // ID extraction failed on the server. The user pastes the contract ID
  // they found on the explorer.
  const [manualContractId, setManualContractId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  // Effective contract ID: use the prop if provided, otherwise use the
  // manually-entered value (if it looks valid)
  const effectiveContractId = contractId || (manualContractId.startsWith("C") && manualContractId.length === 56 ? manualContractId : undefined);

  // Find the active Rust file and parse its contract spec
  const functions = useMemo(() => {
    const rustFile = findFile(tree, "src/lib.rs");
    if (!rustFile) return [];
    return parseContractSpec(rustFile.content);
  }, [tree]);

  // No contract ID available (neither from prop nor manual entry) — show
  // a manual-entry form so the user can paste the contract ID from the
  // explorer. This handles the case where the deploy succeeded but the
  // server couldn't auto-extract the contract ID.
  if (!effectiveContractId) {
    return (
      <div className="border-t border-[var(--border-subtle)] p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Interact with deployed contract
        </div>
        <div className="rounded-md border border-[var(--status-warning)]/30 bg-[color-mix(in_srgb,var(--status-warning)_6%,transparent)] p-2.5 space-y-2">
          <div className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
            <AlertCircle size={12} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-[var(--text-primary)] mb-0.5">
                Contract ID not auto-extracted
              </div>
              <div className="text-[var(--text-muted)]">
                The deploy succeeded but we couldn&apos;t auto-extract the contract ID.
                Find it on the explorer (link above) and paste it here to interact.
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-[var(--text-secondary)] mb-0.5 block">
              Contract ID
            </label>
            <input
              value={manualContractId}
              onChange={(e) => {
                setManualContractId(e.target.value.trim());
                setManualError(null);
              }}
              placeholder="C…"
              className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              spellCheck={false}
              autoComplete="off"
            />
            {manualError && (
              <div className="text-[10px] text-[var(--status-error)] mt-1">{manualError}</div>
            )}
            {manualContractId && !effectiveContractId && (
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                Enter a valid 56-character contract ID starting with &quot;C&quot;
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (functions.length === 0) {
    return (
      <div className="p-3 text-center">
        <p className="text-xs text-[var(--text-muted)]">
          No contract functions found in <code className="font-mono">src/lib.rs</code>.
        </p>
      </div>
    );
  }

  function getArgValue(fnName: string, argName: string): string {
    return argValues[fnName]?.[argName] ?? "";
  }

  function setArgValue(fnName: string, argName: string, value: string) {
    setArgValues((prev) => ({
      ...prev,
      [fnName]: { ...(prev[fnName] ?? {}), [argName]: value },
    }));
  }

  function setInvokeState(fnName: string, partial: Partial<InvokeState>) {
    setInvokeStates((prev) => ({
      ...prev,
      [fnName]: { loading: false, ...(prev[fnName] ?? {}), ...partial },
    }));
  }

  /**
   * Parse a string arg value into the right native type for the SDK.
   * Basic heuristic — user types are passed as strings and the SDK infers.
   * Numbers become Number/bigint, true/false become boolean, etc.
   */
  function parseArgValue(value: string, type: string): unknown {
    const t = type.trim();
    // Numeric types
    if (/^(u\d+|i\d+)$/.test(t)) {
      // Use bigint for u64/i64/u128/i128, Number for u32/i32
      if (t.endsWith("64") || t.endsWith("128")) {
        return BigInt(value);
      }
      return Number(value);
    }
    // Boolean
    if (t === "bool") {
      return value === "true" || value === "1";
    }
    // Address — the SDK's nativeToScVal doesn't auto-convert strings to
    // Address type, so we wrap it in a new Address() on the server side.
    // For now, pass the string and let the server handle it via a special
    // __type marker. (Future: extend nativeToScVal wrapper.)
    if (t === "Address") {
      return { __type: "address", value };
    }
    // Bytes — parse as hex
    if (t === "Bytes" || t.startsWith("BytesN<")) {
      const hex = value.startsWith("0x") ? value.slice(2) : value;
      return Buffer.from(hex, "hex");
    }
    // Vec/Map — try JSON parse, fall back to string
    if (t.startsWith("Vec<") || t.startsWith("Map<")) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    // Default: string (covers String, Symbol, custom types)
    return value;
  }

  /**
   * QUERY mode — read-only simulation, no wallet signing.
   * Uses /api/contracts/invoke?mode=read
   */
  async function handleQuery(fn: ContractFunction) {
    if (!effectiveContractId) return;
    setInvokeState(fn.name, { loading: true, error: undefined, result: undefined });

    try {
      const visibleArgs = fn.args.filter((a) => a.name !== "env" && a.name !== "_env");
      const args = visibleArgs.map((a) => {
        const val = getArgValue(fn.name, a.name) || defaultValueForType(a.type);
        return parseArgValue(val, a.type);
      });

      const res = await fetch("/api/contracts/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: effectiveContractId,
          network,
          function: fn.name,
          args,
          mode: "read",
          // §Fix — pass walletAddress for read mode too, so the simulation
          // runs as the user's account (matches how the tx would actually
          // execute, and provides proper auth context for require_auth calls)
          walletAddress: profile?.address || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setInvokeState(fn.name, {
          loading: false,
          error: data.detail ? `${data.error}: ${data.detail}` : data.error,
        });
        return;
      }

      setInvokeState(fn.name, {
        loading: false,
        result: data.result,
        error: data.error, // may be present even on 200 (decode failure)
      });
    } catch (err) {
      setInvokeState(fn.name, {
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * TRANSACT mode — write transaction, requires wallet signing.
   * Uses /api/contracts/invoke?mode=write to build the tx, then signs
   * via appkit.signTransaction, then submits via /api/contracts/submit.
   */
  async function handleTransact(fn: ContractFunction) {
    if (!effectiveContractId) return;

    if (!profile?.address || !walletConnected) {
      setInvokeState(fn.name, {
        loading: false,
        error: "Wallet not connected. Click the wallet button in the top bar to connect.",
      });
      // Open the wallet modal
      const handle = (window as unknown as { __walletModal?: { open: () => void } }).__walletModal;
      handle?.open();
      return;
    }

    setInvokeState(fn.name, {
      loading: true,
      error: undefined,
      result: undefined,
      pendingSign: true,
    });

    try {
      const visibleArgs = fn.args.filter((a) => a.name !== "env" && a.name !== "_env");
      const args = visibleArgs.map((a) => {
        const val = getArgValue(fn.name, a.name) || defaultValueForType(a.type);
        return parseArgValue(val, a.type);
      });

      // Step 1: build the unsigned invoke tx (server simulates + prepares)
      const buildRes = await fetch("/api/contracts/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // §Fix (2026-08-16) — was "effectiveContractId", API expects "contractId"
          contractId: effectiveContractId,
          network,
          function: fn.name,
          args,
          mode: "write",
          walletAddress: profile.address,
        }),
      });

      const buildData = await buildRes.json();
      if (!buildRes.ok) {
        setInvokeState(fn.name, {
          loading: false,
          pendingSign: false,
          error: buildData.detail ? `${buildData.error}: ${buildData.detail}` : buildData.error,
        });
        return;
      }

      // Step 2: get the appkit signing handle
      const appkit = await getAppKitForSigning();
      if (!appkit) {
        setInvokeState(fn.name, {
          loading: false,
          pendingSign: false,
          error: "Wallet signing unavailable. Reconnect your wallet and try again.",
        });
        return;
      }

      // Step 3: sign the tx with the wallet
      setInvokeState(fn.name, { loading: true, pendingSign: true, error: "Please sign the transaction in your wallet…" });
      let signedXdr: string;
      try {
        const signResult = await appkit.signTransaction(buildData.unsignedXdr, {
          network: network.toUpperCase(),
          networkPassphrase: buildData.networkPassphrase,
        });
        signedXdr = signResult.signedTxXdr || signResult.signedXdr || "";
        if (!signedXdr) {
          throw new Error("Wallet did not return a signed transaction");
        }
      } catch (signErr) {
        const msg = signErr instanceof Error ? signErr.message : String(signErr);
        const isReject = /reject|cancel|denied/i.test(msg);
        setInvokeState(fn.name, {
          loading: false,
          pendingSign: false,
          error: isReject
            ? "Transaction signing was rejected."
            : `Wallet signing failed: ${msg}`,
        });
        return;
      }

      // Step 4: submit the signed tx
      setInvokeState(fn.name, { loading: true, pendingSign: false, error: "Submitting to network…" });
      const submitRes = await fetch("/api/contracts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedXdr,
          walletAddress: profile.address,
          network,
          projectId: "invoke-tx", // not tied to a project deploy record
          phase: "invoke",
        }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        setInvokeState(fn.name, {
          loading: false,
          error: submitData.detail ? `${submitData.error}: ${submitData.detail}` : submitData.error,
        });
        return;
      }

      if (submitData.status === "FAILED") {
        setInvokeState(fn.name, {
          loading: false,
          error: submitData.detail || "Transaction failed on-chain",
        });
        return;
      }

      setInvokeState(fn.name, {
        loading: false,
        result: { txHash: submitData.hash, status: submitData.status },
        error: submitData.status === "PENDING" ? "Transaction submitted but not yet confirmed after 60s." : undefined,
      });
    } catch (err) {
      setInvokeState(fn.name, {
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    // §Fix (2026-08-16) — removed h-full + overflow-hidden. The panel was
    // constrained to its parent's height, which made the function list
    // tiny (especially after deploy when there's a lot of content above).
    // Now the panel expands to its natural height, and the parent
    // DeployPanel (which has overflow-y-auto) handles scrolling.
    <div className="flex flex-col border-t border-[var(--border-subtle)]">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Interact with deployed contract
        </div>
        {/* Contract ID with copy button */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <code className="flex-1 text-[11px] font-mono text-[var(--text-primary)] truncate" title={effectiveContractId}>
            {effectiveContractId}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(effectiveContractId);
            }}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Copy contract ID"
          >
            <Copy size={11} strokeWidth={1.75} />
          </button>
        </div>
        <div className="text-[11px] text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">Network:</span>{" "}
          <span className="font-medium capitalize">{network}</span>
          <span className="mx-1.5 text-[var(--border-subtle)]">·</span>
          <span className="text-[var(--text-muted)]">Functions:</span>{" "}
          <span className="font-medium">{functions.length}</span>
        </div>
      </div>

      {/* Functions list — no longer scrollable internally; the parent
          DeployPanel handles scrolling so all functions are visible
          when the user scrolls the deploy panel. */}
      <div className="p-3 space-y-2">
        {functions.map((fn) => (
          <FunctionInvoker
            key={fn.name}
            fn={fn}
            state={invokeStates[fn.name] ?? { loading: false }}
            argValues={argValues[fn.name] ?? {}}
            onArgChange={(argName, value) => setArgValue(fn.name, argName, value)}
            onQuery={() => handleQuery(fn)}
            onTransact={() => handleTransact(fn)}
          />
        ))}
      </div>
    </div>
  );
}

function FunctionInvoker({
  fn,
  state,
  argValues,
  onArgChange,
  onQuery,
  onTransact,
}: {
  fn: ContractFunction;
  state: InvokeState;
  argValues: Record<string, string>;
  onArgChange: (argName: string, value: string) => void;
  onQuery: () => void;
  onTransact: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleArgs = fn.args.filter((a) => a.name !== "env" && a.name !== "_env");
  const { loading, result, error, pendingSign } = state;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
      {/* Function header (click to expand) */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        <FunctionSquare size={11} strokeWidth={1.75} className={fn.isReadonly ? "text-[var(--status-info)]" : "text-[var(--accent)]"} shrink-0 />
        <span className="text-[12px] font-mono font-medium text-[var(--text-primary)]">
          {fn.name}
        </span>
        {fn.isConstructor && (
          <span className="rounded bg-[var(--accent-subtle)] px-1 text-[9px] text-[var(--accent)]">
            constructor
          </span>
        )}
        {/* Read-only / Write badge — shows whether the function modifies state */}
        {fn.isReadonly ? (
          <span className="rounded bg-[var(--status-info)]/15 px-1 text-[9px] text-[var(--status-info)]">
            read
          </span>
        ) : (
          <span className="rounded bg-[var(--accent)]/15 px-1 text-[9px] text-[var(--accent)]">
            write
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {visibleArgs.length} {visibleArgs.length === 1 ? "arg" : "args"} → {fn.returnType}
        </span>
      </button>

      {/* Expanded: args + buttons + result */}
      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-2.5 space-y-2">
          {/* Args */}
          {visibleArgs.length === 0 ? (
            <p className="text-[11px] text-[var(--text-muted)] italic">No arguments</p>
          ) : (
            visibleArgs.map((arg) => (
              <div key={arg.name}>
                <label className="text-[10px] font-mono text-[var(--text-secondary)] mb-0.5 block">
                  {arg.name}: <span className="text-[var(--text-muted)]">{arg.type}</span>
                </label>
                <input
                  value={argValues[arg.name] ?? defaultValueForType(arg.type)}
                  onChange={(e) => onArgChange(arg.name, e.target.value)}
                  placeholder={defaultValueForType(arg.type)}
                  className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            ))
          )}

          {/* Action buttons — read-only functions show only "Query";
              write functions show both "Query" + "Transact" */}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={onQuery}
              disabled={loading}
              className="flex-1 h-7 gap-1.5 bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[11px] disabled:opacity-50"
              title={fn.isReadonly
                ? "Read-only function — simulate the call (free, no transaction)"
                : "Simulate the call without submitting a transaction (read-only)"}
            >
              <Eye size={10} strokeWidth={1.75} />
              {loading && !pendingSign ? "Querying…" : "Query"}
            </Button>
            {/* Only show the Transact button for write functions —
                read-only functions don't need a transaction (they don't
                modify state, so simulating is equivalent to executing) */}
            {!fn.isReadonly && (
              <Button
                size="sm"
                onClick={onTransact}
              disabled={loading}
              className="flex-1 h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-[11px] disabled:opacity-50"
              title="Write — submit a transaction (requires wallet signing)"
            >
              {loading && pendingSign ? <AlertCircle size={10} strokeWidth={1.75} /> : <Send size={10} strokeWidth={1.75} />}
              {loading && pendingSign ? "Sign…" : loading ? "Submitting…" : "Transact"}
            </Button>
            )}
          </div>

          {/* Pending-sign message */}
          {pendingSign && error && (
            <div className="text-[10px] text-[var(--accent)] italic">{error}</div>
          )}

          {/* Result (Query mode) */}
          {result !== undefined && !pendingSign && (
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
                {typeof result === "object" && result !== null && "txHash" in result
                  ? "Transaction submitted"
                  : "Result"}
              </div>
              <pre className="rounded bg-[var(--surface-app)] p-1.5 text-[11px] font-mono text-[var(--status-success)] overflow-x-auto whitespace-pre-wrap break-all">
                {formatInvokeResult(result)}
              </pre>
              {typeof result === "object" && result !== null && "txHash" in result && (
                <div className="text-[9px] text-[var(--text-muted)] mt-1">
                  Tx hash: <code className="font-mono">{String((result as { txHash: string }).txHash).substring(0, 16)}…</code>
                  {typeof result === "object" && result !== null && "status" in result && (
                    <span className="ml-1.5">({String((result as { status: string }).status)})</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && !pendingSign && (
            <div className="text-[11px] text-[var(--status-error)] break-all">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper to get the appkit instance for signing.
// Same as in right-panel.tsx — duplicated here to avoid coupling.
// (Future: extract into a shared hook.)
async function getAppKitForSigning(): Promise<{
  signTransaction: (xdr: string, opts?: Record<string, unknown>) => Promise<{ signedTxXdr?: string; signedXdr?: string }>;
} | null> {
  try {
    const appkit = (window as unknown as {
      __appkit?: {
        signTransaction: (xdr: string, opts?: Record<string, unknown>) => Promise<{ signedTxXdr?: string; signedXdr?: string }>;
      } | null;
    }).__appkit;

    if (appkit && typeof appkit.signTransaction === "function") {
      return appkit;
    }
    return null;
  } catch {
    return null;
  }
}
