"use client";

import { useState, useMemo } from "react";
import { Play, Copy, Check, FunctionSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  parseContractSpec,
  defaultValueForType,
  formatInvokeResult,
  type ContractFunction,
} from "@/lib/soroban/spec-parser";
import { useFileSystemStore } from "@/stores/file-system-store";
import { findFile } from "@/lib/soroban/sample-project";

interface ContractInteractionPanelProps {
  contractId?: string;
}

export function ContractInteractionPanel({ contractId }: ContractInteractionPanelProps) {
  const tree = useFileSystemStore((s) => s.tree);
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [argValues, setArgValues] = useState<Record<string, Record<string, string>>>({});

  // Find the active Rust file and parse its contract spec
  const functions = useMemo(() => {
    const rustFile = findFile(tree, "src/lib.rs");
    if (!rustFile) return [];
    return parseContractSpec(rustFile.content);
  }, [tree]);

  if (!contractId) {
    return (
      <div className="p-3 text-center">
        <FunctionSquare size={20} strokeWidth={1.5} className="mx-auto mb-2 text-[var(--text-muted)]" />
        <p className="text-xs text-[var(--text-muted)]">
          Deploy a contract first to see the interaction panel.
        </p>
      </div>
    );
  }

  if (functions.length === 0) {
    return (
      <div className="p-3 text-center">
        <p className="text-xs text-[var(--text-muted)]">
          No contract functions found in src/lib.rs.
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

  async function handleInvoke(fn: ContractFunction) {
    setLoading(fn.name);
    try {
      // In production, this would call the deployed contract via stellar-sdk:
      //   const result = await contract.invoke(fn.name, args);
      // For now, simulate based on the function name
      const args = fn.args
        .filter((a) => a.name !== "env" && a.name !== "_env")
        .map((a) => getArgValue(fn.name, a.name));

      await new Promise((r) => setTimeout(r, 500));

      // Simulated results based on known functions
      let result: unknown;
      if (fn.name === "hello" || fn.name === "greet") {
        result = args[0] ? `Hello, ${args[0]}!` : "Hello, World!";
      } else if (fn.name === "get_greeting") {
        result = "Hello";
      } else if (fn.name === "get_value" || fn.name === "total_supply") {
        result = args[0] ?? "0";
      } else if (fn.name === "increment") {
        result = (parseInt(args[0] ?? "0") + 1).toString();
      } else if (fn.name === "balance_of") {
        result = "1000000";
      } else if (fn.returnType === "()") {
        result = "()";
      } else {
        result = `(simulated) ${fn.returnType}`;
      }

      setResults((prev) => ({ ...prev, [fn.name]: result }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [fn.name]: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setLoading(null);
    }
  }

  function handleCopyContractId() {
    if (contractId) {
      navigator.clipboard.writeText(contractId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Contract ID header */}
      <div className="border-b border-[var(--border-subtle)] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
          Contract ID
        </div>
        <div className="flex items-center gap-1.5">
          <code className="flex-1 text-[11px] font-mono text-[var(--text-secondary)] truncate">
            {contractId}
          </code>
          <button
            onClick={handleCopyContractId}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Copy contract ID"
          >
            {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      {/* Functions */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Functions ({functions.length})
        </h3>

        {functions.map((fn) => (
          <FunctionInvoker
            key={fn.name}
            fn={fn}
            loading={loading === fn.name}
            result={results[fn.name]}
            argValues={argValues[fn.name] ?? {}}
            onArgChange={(argName, value) => setArgValue(fn.name, argName, value)}
            onInvoke={() => handleInvoke(fn)}
          />
        ))}
      </div>
    </div>
  );
}

function FunctionInvoker({
  fn,
  loading,
  result,
  argValues,
  onArgChange,
  onInvoke,
}: {
  fn: ContractFunction;
  loading: boolean;
  result?: unknown;
  argValues: Record<string, string>;
  onArgChange: (argName: string, value: string) => void;
  onInvoke: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleArgs = fn.args.filter((a) => a.name !== "env" && a.name !== "_env");

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] overflow-hidden">
      {/* Function header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        <FunctionSquare size={11} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
        <span className="text-[12px] font-mono font-medium text-[var(--text-primary)]">
          {fn.name}
        </span>
        {fn.isConstructor && (
          <span className="rounded bg-[var(--accent-subtle)] px-1 text-[9px] text-[var(--accent)]">
            constructor
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {visibleArgs.length} {visibleArgs.length === 1 ? "arg" : "args"} → {fn.returnType}
        </span>
      </button>

      {/* Expanded: args + invoke button */}
      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-2.5 space-y-2">
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

          <Button
            size="sm"
            onClick={onInvoke}
            disabled={loading}
            className="w-full h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] text-[11px] disabled:opacity-50"
          >
            <Play size={10} strokeWidth={2} fill="currentColor" />
            {loading ? "Invoking…" : `Invoke ${fn.name}()`}
          </Button>

          {/* Result */}
          {result !== undefined && (
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
                Result
              </div>
              <pre className="rounded bg-[var(--surface-app)] p-1.5 text-[11px] font-mono text-[var(--status-success)] overflow-x-auto whitespace-pre-wrap break-all">
                {formatInvokeResult(result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
