"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Bot,
  Wrench,
  Rocket,
  TestTube,
  GitBranch,
  Check,
  Loader2,
  X,
  FileCode2,
  Search as SearchIcon,
  FileText,
  ExternalLink,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentPanel } from "./agent-panel";
import { ContractInteractionPanel } from "./contract-interaction";
import { ContractInspectPanel } from "./contract-inspect-panel";
import { useBuildStore } from "@/stores/build-store";
import { useTestStore } from "@/stores/test-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProfileStore } from "@/stores/profile-store";
import { useProjectsStore } from "@/stores/projects-store";
import { flattenFiles } from "@/lib/soroban/sample-project";

type RightPanelView = "agent" | "compile" | "deploy" | "inspect";

interface RightPanelProps {
  view: RightPanelView;
  onChangeView: (v: RightPanelView) => void;
  onOpenSettings?: () => void;
  network?: string;
}

const VIEW_ITEMS: { id: RightPanelView; icon: LucideIcon; label: string }[] = [
  { id: "agent", icon: Bot, label: "AI Agent" },
  { id: "compile", icon: Wrench, label: "Build" },
  { id: "deploy", icon: Rocket, label: "Deploy" },
  { id: "inspect", icon: SearchIcon, label: "Inspect" },
];

export function RightPanel({ view, onChangeView, onOpenSettings, network = "testnet" }: RightPanelProps) {
  return (
    <div className="flex h-full flex-col bg-[var(--surface-panel)]">
      {/* View switcher */}
      <div className="flex h-9 items-center gap-1 border-b border-[var(--border-subtle)] px-2">
        {VIEW_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
                isActive
                  ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              )}
            >
              <Icon size={12} strokeWidth={1.75} />
              <span className="hidden xl:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "agent" && <AgentPanel onOpenSettings={() => onOpenSettings?.()} />}
        {view === "compile" && <CompilePanel />}
        {view === "deploy" && <DeployPanel network={network} />}
        {view === "inspect" && <ContractInspectPanel />}
      </div>
    </div>
  );
}

function CompilePanel() {
  const [subTab, setSubTab] = useState<"build" | "tests">("build");
  const status = useBuildStore((s) => s.status);
  const lines = useBuildStore((s) => s.lines);
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const error = useBuildStore((s) => s.error);
  const silent = useBuildStore((s) => s.silent);
  const startBuild = useBuildStore((s) => s.startBuild);
  const outputRef = useRef<HTMLDivElement>(null);
  const tree = useFileSystemStore((s) => s.tree);

  // Get the active project name for WASM file naming
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projectsList = useProjectsStore((s) => s.projects);
  const activeProject = activeProjectId
    ? projectsList.find((p) => p.id === activeProjectId) ?? null
    : null;

  // Parse contract functions from the Rust source after successful build
  const contractFunctions = useMemo(() => {
    if (status !== "success") return [];
    const rustFile = flattenFiles(tree).find((f) => f.path === "src/lib.rs" || f.path.endsWith("lib.rs"));
    if (!rustFile) return [];
    const fns: { name: string; args: string; returns: string }[] = [];
    const fnRegex = /pub\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/g;
    let match;
    while ((match = fnRegex.exec(rustFile.content)) !== null) {
      const args = match[2].split(",").map((a) => a.trim()).filter((a) => a && a !== "env: Env" && a !== "_env: Env");
      fns.push({ name: match[1], args: args.join(", "), returns: (match[3] ?? "()").trim() });
    }
    return fns;
  }, [status, tree]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-hidden">
      {/* Sub-tabs: Build / Tests */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-2">
        <button
          onClick={() => setSubTab("build")}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors",
            subTab === "build"
              ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          )}
        >
          <Wrench size={11} strokeWidth={1.75} />
          Build
        </button>
        <button
          onClick={() => setSubTab("tests")}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors",
            subTab === "tests"
              ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          )}
        >
          <TestTube size={11} strokeWidth={1.75} />
          Tests
        </button>
      </div>

      {subTab === "tests" ? (
        <TestPanel />
      ) : (
        <>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Build
        </h3>
        <div className="space-y-2">
          <Button
            size="sm"
            onClick={() => startBuild({ silent: false, projectName: activeProject?.name })}
            disabled={status === "building"}
            className="w-full h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] gap-2 disabled:opacity-60"
          >
            {status === "building" && !silent ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Wrench size={13} strokeWidth={1.75} />
            )}
            stellar contract build
          </Button>
          <Button
            size="sm"
            onClick={() => startBuild({ command: "cargo", silent: false })}
            disabled={status === "building"}
            variant="outline"
            className="w-full h-8 gap-2 border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
            title="Run cargo build (compiles dependencies, checks types)"
          >
            {status === "building" && !silent ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Check size={13} strokeWidth={1.75} />
            )}
            cargo build
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Output
          </h3>
          {/* Only show building spinner for non-silent builds */}
          {status === "building" && !silent && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Loader2 size={9} strokeWidth={2} className="animate-spin" />
              building…
            </span>
          )}
          {status === "success" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)]">
              <Check size={9} strokeWidth={2} />
              success
            </span>
          )}
          {status === "failed" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--status-error)]">
              <X size={9} strokeWidth={2} />
              failed
            </span>
          )}
        </div>
        <div
          ref={outputRef}
          className="flex-1 overflow-y-auto rounded-md bg-[var(--surface-sunken)] p-2.5 font-mono text-[11px] leading-relaxed space-y-0.5 min-h-[120px]"
        >
          {status === "idle" && lines.length === 0 && (
            <div className="text-[var(--text-muted)] italic">
              No build yet. Click Build to compile.
            </div>
          )}
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === "stderr"
                  ? "text-[var(--status-error)]"
                  : line.text.includes("✨") || line.text.includes("Built")
                  ? "text-[var(--status-success)]"
                  : line.text.startsWith("warning")
                  ? "text-[var(--status-warning)]"
                  : "text-[var(--text-secondary)]"
              }
            >
              {line.text || "\u00A0"}
            </div>
          ))}
          {status === "building" && (
            <div className="text-[var(--text-muted)] inline-block">
              <span className="animate-pulse">▋</span>
            </div>
          )}
        </div>

        {wasmInfo && (
          <div className="mt-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
              Built WASM
            </div>
            <div className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
              {wasmInfo.path}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {(wasmInfo.sizeBytes / 1024).toFixed(2)} KB
            </div>
          </div>
        )}

        {error && status === "failed" && (
          <div className="mt-2 rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2 text-[11px] text-[var(--status-error)]">
            {error}
          </div>
        )}

        {/* Function list after successful build */}
        {status === "success" && contractFunctions.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
              Contract Functions ({contractFunctions.length})
            </h4>
            <div className="space-y-1">
              {contractFunctions.map((fn) => (
                <div
                  key={fn.name}
                  className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <FileCode2 size={10} strokeWidth={1.75} className="text-[var(--accent)] shrink-0" />
                    <span className="font-mono text-[11px] font-medium text-[var(--text-primary)]">{fn.name}</span>
                    <span className="text-[9px] text-[var(--text-muted)]">→ {fn.returns}</span>
                  </div>
                  {fn.args && (
                    <div className="mt-0.5 pl-4 font-mono text-[10px] text-[var(--text-muted)]">
                      ({fn.args})
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function TestPanel() {
  const status = useTestStore((s) => s.status);
  const lines = useTestStore((s) => s.lines);
  const testResults = useTestStore((s) => s.testResults);
  const error = useTestStore((s) => s.error);
  const runTests = useTestStore((s) => s.runTests);
  const reset = useTestStore((s) => s.reset);
  const outputRef = useRef<HTMLDivElement>(null);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines.length]);

  const passed = testResults.filter((t) => t.passed).length;
  const failed = testResults.filter((t) => !t.passed && t.message !== "ignored").length;
  const ignored = testResults.filter((t) => t.message === "ignored").length;

  // No project active
  if (!activeProjectId) {
    return (
      <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Tests
          </h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <TestTube size={24} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Open a project to run tests.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Tests
        </h3>
        <div className="flex items-center gap-1.5">
          {status !== "idle" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={reset}
              className="h-7 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Clear
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => runTests()}
            disabled={status === "running"}
            className="h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
          >
            {status === "running" ? (
              <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <TestTube size={12} strokeWidth={1.75} />
            )}
            {status === "running" ? "Running…" : "Run Tests"}
          </Button>
        </div>
      </div>

      {/* Summary */}
      {testResults.length > 0 && (
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="rounded bg-[var(--surface-sunken)] py-1.5">
            <div className="text-[16px] font-mono font-semibold text-[var(--status-success)]">{passed}</div>
            <div className="text-[9px] uppercase text-[var(--text-muted)]">Passed</div>
          </div>
          <div className="rounded bg-[var(--surface-sunken)] py-1.5">
            <div className="text-[16px] font-mono font-semibold text-[var(--status-error)]">{failed}</div>
            <div className="text-[9px] uppercase text-[var(--text-muted)]">Failed</div>
          </div>
          <div className="rounded bg-[var(--surface-sunken)] py-1.5">
            <div className="text-[16px] font-mono font-semibold text-[var(--text-muted)]">{ignored}</div>
            <div className="text-[9px] uppercase text-[var(--text-muted)]">Ignored</div>
          </div>
        </div>
      )}

      {/* Test results list */}
      {testResults.length > 0 && (
        <div className="space-y-0.5 overflow-y-auto max-h-40">
          {testResults.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)]"
            >
              {t.passed ? (
                <Check size={12} className="text-[var(--status-success)] shrink-0" strokeWidth={2} />
              ) : t.message === "ignored" ? (
                <span className="text-[var(--text-muted)] shrink-0 font-mono text-[10px]">-</span>
              ) : (
                <X size={12} className="text-[var(--status-error)] shrink-0" strokeWidth={2} />
              )}
              <span className={cn("font-mono truncate", t.passed ? "text-[var(--text-secondary)]" : "text-[var(--status-error)]")}>
                {t.name}
              </span>
              {t.message && t.message !== "ignored" && (
                <span className="text-[10px] text-[var(--status-error)] truncate">{t.message}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Output console */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Output</h4>
          {status === "running" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Loader2 size={9} strokeWidth={2} className="animate-spin" />
              running…
            </span>
          )}
          {status === "success" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)]">
              <Check size={9} strokeWidth={2} />
              passed
            </span>
          )}
          {status === "failed" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--status-error)]">
              <X size={9} strokeWidth={2} />
              failed
            </span>
          )}
        </div>
        <div
          ref={outputRef}
          className="flex-1 overflow-y-auto rounded-md bg-[var(--surface-sunken)] p-2 font-mono text-[10px] leading-relaxed space-y-0.5 min-h-[80px]"
        >
          {status === "idle" && lines.length === 0 && (
            <div className="text-[var(--text-muted)] italic">
              No tests run yet. Click "Run Tests" to execute cargo test.
            </div>
          )}
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === "stderr"
                  ? "text-[var(--status-error)]"
                  : line.text.includes("test result: ok")
                  ? "text-[var(--status-success)]"
                  : line.text.includes("test result: FAILED")
                  ? "text-[var(--status-error)]"
                  : line.text.startsWith("test ")
                  ? "text-[var(--text-secondary)]"
                  : "text-[var(--text-muted)]"
              }
            >
              {line.text || "\u00A0"}
            </div>
          ))}
          {status === "running" && (
            <div className="text-[var(--text-muted)] inline-block">
              <span className="animate-pulse">▋</span>
            </div>
          )}
        </div>

        {error && status === "failed" && (
          <div className="mt-2 rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2 text-[11px] text-[var(--status-error)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function DeployPanel({ network }: { network: string }) {
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const buildStatus = useBuildStore((s) => s.status);
  const profile = useProfileStore((s) => s.profile);
  const walletConnected = useProfileStore((s) => s.walletConnected);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const projectsList = useProjectsStore((s) => s.projects);
  const activeProject = activeProjectId
    ? projectsList.find((p) => p.id === activeProjectId) ?? null
    : null;

  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    contractId: string;
    hash: string;
    isUpgrade: boolean;
  } | null>(null);
  const [existingContract, setExistingContract] = useState<{
    contractId: string;
    network: string;
    upgradeCount: number;
    wasmVersions: { version: number; wasmHash: string; isUpgrade: boolean; createdAt: string }[];
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [checkingExisting, setCheckingExisting] = useState(false);

  // Fetch existing deployed contracts when project changes
  useEffect(() => {
    if (activeProject?.serverProjectId && walletConnected) {
      checkExistingContract();
    } else {
      setExistingContract(null);
    }
  }, [activeProject?.serverProjectId, network, walletConnected]);

  async function checkExistingContract() {
    if (!activeProject?.serverProjectId) return;
    setCheckingExisting(true);
    try {
      const res = await fetch(
        `/api/contracts/list?projectId=${activeProject.serverProjectId}&network=${network}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.contracts && data.contracts.length > 0) {
          setExistingContract(data.contracts[0]);
        } else {
          setExistingContract(null);
        }
      }
    } catch {
      // ignore
    } finally {
      setCheckingExisting(false);
    }
  }

  async function handleDeploy() {
    // Check if wallet is connected — if not, open the wallet modal automatically
    if (!profile?.address || !walletConnected) {
      // Open the wallet modal so the user can connect
      const handle = (window as unknown as { __walletModal?: { open: () => void } }).__walletModal;
      if (handle) {
        setError("Wallet not connected. Opening wallet picker…");
        handle.open();
      } else {
        setError("Wallet not connected. Please connect your wallet first.");
      }
      return;
    }
    if (!activeProject?.serverProjectId) {
      setError("No active project. Open or create a project first.");
      return;
    }
    if (!wasmInfo) {
      setError("No WASM file. Build the contract first.");
      return;
    }

    setDeploying(true);
    setError(null);
    setSuccess(null);
    setStatusMsg("Building deploy transaction…");

    try {
      // Step 1: Build the unsigned deploy/upgrade transaction
      const buildTxRes = await fetch("/api/contracts/deploy-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.serverProjectId,
          walletAddress: profile.address,
          network,
          wasmPath: wasmInfo?.path,
        }),
      });

      const txData = await buildTxRes.json();
      if (!buildTxRes.ok) {
        // Show the FULL error detail (not just the generic message) so the
        // user knows exactly what went wrong without digging in the network tab
        const errMsg = txData.detail
          ? `${txData.error}: ${txData.detail}`
          : txData.error || "Failed to build deploy transaction";
        setError(errMsg);
        setDeploying(false);
        setStatusMsg("");
        return;
      }

      // Step 2: Sign the transaction with the wallet
      setStatusMsg("Please sign the transaction in your wallet…");

      // Get the appkit instance to sign the transaction
      const appkit = await getAppKitForSigning();
      if (!appkit) {
        setError(
          "Wallet signing is not available. Make sure your wallet is connected and the stellar-appkit modal is loaded. Try reconnecting your wallet."
        );
        setDeploying(false);
        setStatusMsg("");
        return;
      }

      let signedXdr: string;
      try {
        const signResult = await appkit.signTransaction(txData.unsignedXdr, {
          network: network.toUpperCase(),
          networkPassphrase: txData.networkPassphrase,
        });
        signedXdr = signResult.signedTxXdr || signResult.signedXdr || "";
        if (!signedXdr) {
          throw new Error("Wallet did not return a signed transaction");
        }
      } catch (signErr) {
        // User rejected the sign request, or wallet threw an error
        const msg = signErr instanceof Error ? signErr.message : String(signErr);
        if (msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("denied")) {
          setError("Transaction signing was rejected. Please approve the transaction in your wallet to deploy.");
        } else {
          setError(`Wallet signing failed: ${msg}`);
        }
        setDeploying(false);
        setStatusMsg("");
        return;
      }

      // Step 3: Submit the signed transaction
      setStatusMsg("Submitting to the network…");

      const submitRes = await fetch("/api/contracts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedXdr,
          walletAddress: profile.address,
          network,
          projectId: activeProject.serverProjectId,
          wasmHash: txData.wasmHash,
          wasmSizeBytes: txData.wasmSizeBytes,
          wasmPath: txData.wasmPath ?? wasmInfo?.path ?? "",
          isUpgrade: txData.isUpgrade,
          existingContractId: txData.contractId,
        }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        setError(submitData.error || "Failed to submit transaction");
        setDeploying(false);
        setStatusMsg("");
        return;
      }

      setSuccess({
        contractId: submitData.contractId,
        hash: submitData.hash,
        isUpgrade: submitData.isUpgrade,
      });
      setStatusMsg("");

      // Refresh the existing contract info
      await checkExistingContract();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
      setStatusMsg("");
    } finally {
      setDeploying(false);
    }
  }

  const isUpgrade = !!existingContract;
  // canDeploy allows clicking the button even without a wallet — handleDeploy
  // will open the wallet modal if the wallet isn't connected.
  const canDeploy = activeProject?.serverProjectId && wasmInfo && !deploying;

  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {isUpgrade ? "Upgrade Contract" : "Deploy Contract"}
      </h3>

      {/* Not logged in — deployment is impossible without a wallet */}
      {!walletConnected && (
        <div className="rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <Wallet size={12} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0" />
            <span>Wallet not connected. Deployment requires wallet signing — no secret keys needed.</span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              const handle = (window as unknown as { __walletModal?: { open: () => void } }).__walletModal;
              handle?.open();
            }}
            className="w-full h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
          >
            <Wallet size={11} strokeWidth={1.75} />
            Connect Wallet
          </Button>
        </div>
      )}

      {/* WASM info */}
      <div className="rounded-md border border-[var(--border-subtle)] p-2.5">
        <div className="text-[11px] text-[var(--text-muted)] mb-1">WASM file</div>
        {wasmInfo ? (
          <>
            <div className="text-xs font-mono text-[var(--text-primary)] truncate">
              {wasmInfo.path.split("/").pop()}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] mt-1">
              {(wasmInfo.sizeBytes / 1024).toFixed(2)} KB · wasm32v1-none
            </div>
          </>
        ) : (
          <div className="text-xs text-[var(--text-muted)] italic">
            {buildStatus === "building" ? "Building…" : "No build yet. Run Build first."}
          </div>
        )}
      </div>

      {/* Existing contract info (upgrade scenario) */}
      {existingContract && (
        <div className="rounded-md border border-[var(--status-info)]/30 bg-[color-mix(in_srgb,var(--status-info)_8%,transparent)] p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--status-info)] mb-1">
            Contract already deployed
          </div>
          <div className="font-mono text-[11px] text-[var(--text-primary)] break-all mb-1">
            {existingContract.contractId}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
            <span>Network: {existingContract.network}</span>
            <span>·</span>
            <span>Upgrades: {existingContract.upgradeCount}</span>
            <span>·</span>
            <span>WASM versions: {existingContract.wasmVersions.length}</span>
          </div>
          {existingContract.wasmVersions.length > 0 && (
            <div className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              Latest WASM: v{existingContract.wasmVersions[0].version} ({existingContract.wasmVersions[0].wasmHash.substring(0, 12)}…)
            </div>
          )}
        </div>
      )}

      {/* Network */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Network</span>
        <span className="font-medium text-[var(--text-primary)] capitalize">{network}</span>
      </div>

      {/* Deploy / Upgrade button */}
      <Button
        size="sm"
        onClick={handleDeploy}
        disabled={!canDeploy}
        className="w-full h-9 gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
      >
        {deploying ? (
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <Rocket size={13} strokeWidth={1.75} />
        )}
        {deploying
          ? "Processing…"
          : isUpgrade
          ? `Upgrade Contract${existingContract ? ` (v${existingContract.upgradeCount + 2})` : ""}`
          : `Deploy to ${network}`}
      </Button>

      {/* Status message */}
      {statusMsg && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--accent)]/30 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-2.5 text-[11px] text-[var(--text-secondary)]">
          <Loader2 size={12} strokeWidth={1.75} className="animate-spin text-[var(--accent)] shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="rounded-md border border-[var(--status-success)]/40 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-2.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <Check size={12} strokeWidth={2} className="text-[var(--status-success)]" />
            <span className="text-[11px] font-medium text-[var(--status-success)]">
              {success.isUpgrade ? "Contract upgraded!" : "Contract deployed!"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">Contract ID</div>
          <div className="font-mono text-[11px] text-[var(--text-primary)] break-all">
            {success.contractId}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">Transaction hash</div>
          <div className="font-mono text-[10px] text-[var(--text-secondary)] break-all">
            {success.hash}
          </div>
          <a
            href={network === "testnet"
              ? `https://stellar.expert/explorer/testnet/contract/${success.contractId}`
              : `https://stellar.expert/explorer/public/contract/${success.contractId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-[var(--accent)] hover:underline"
          >
            <ExternalLink size={10} strokeWidth={1.75} />
            View on explorer
          </a>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-[var(--status-error)]/40 bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)] p-2 text-[11px] text-[var(--status-error)]">
          {error}
        </div>
      )}

      {/* Contract interaction — after deploy */}
      {success?.contractId && success.contractId.startsWith("C") && (
        <ContractInteractionPanel contractId={success.contractId} />
      )}

      {/* WASM version history */}
      {existingContract && existingContract.wasmVersions.length > 0 && !deploying && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
            WASM Versions ({existingContract.wasmVersions.length})
          </h4>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {existingContract.wasmVersions.map((v) => (
              <div
                key={v.version}
                className="flex items-center gap-2 rounded px-2 py-1 text-[10px] bg-[var(--surface-sunken)]"
              >
                <span className="font-mono font-medium text-[var(--text-primary)]">v{v.version}</span>
                {v.isUpgrade && (
                  <span className="rounded bg-[var(--status-info)]/20 px-1 text-[9px] text-[var(--status-info)]">
                    upgrade
                  </span>
                )}
                <span className="font-mono text-[var(--text-muted)] truncate">
                  {v.wasmHash.substring(0, 16)}…
                </span>
                <span className="ml-auto text-[var(--text-muted)]">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to get the appkit instance for signing.
// Reads from the global window.__appkitClient (set by the provider) so
// any component can sign transactions without being inside the provider tree.
async function getAppKitForSigning(): Promise<{
  signTransaction: (xdr: string, opts?: Record<string, unknown>) => Promise<{ signedTxXdr?: string; signedXdr?: string }>;
} | null> {
  try {
    const profileState = (window as unknown as { __profileStore?: { profile: { address: string } | null } }).__profileStore;
    if (!profileState?.profile?.address) return null;

    // Try the new <stellar-appkit-modal> element first
    const modal = document.querySelector<HTMLElement & { client: unknown }>("stellar-appkit-modal");
    if (modal?.client) {
      return modal.client as {
        signTransaction: (xdr: string, opts?: Record<string, unknown>) => Promise<{ signedTxXdr?: string; signedXdr?: string }>;
      };
    }

    // Fallback: old element name (for backwards compat during migration)
    const oldModal = document.querySelector<HTMLElement & { client: unknown }>("saganta-appkit-modal");
    if (oldModal?.client) {
      return oldModal.client as {
        signTransaction: (xdr: string, opts?: Record<string, unknown>) => Promise<{ signedTxXdr?: string; signedXdr?: string }>;
      };
    }

    return null;
  } catch {
    return null;
  }
}

