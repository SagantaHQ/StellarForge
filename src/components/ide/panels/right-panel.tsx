"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Bot,
  Wrench,
  Rocket,
  TestTube,
  GitBranch,
  GitCommit,
  Github,
  Check,
  Loader2,
  X,
  FileCode2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentPanel } from "./agent-panel";
import { ContractInteractionPanel } from "./contract-interaction";
import { CommitToGithubModal } from "../projects/commit-to-github-modal";
import { LoadingOverlay } from "../ui/loading-overlay";
import { useBuildStore } from "@/stores/build-store";
import { useDeployStore } from "@/stores/deploy-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useProfileStore } from "@/stores/profile-store";
import { useProjectsStore } from "@/stores/projects-store";
import { useGithubOAuth } from "@/hooks/use-github-oauth";
import { flattenFiles } from "@/lib/soroban/sample-project";

type RightPanelView = "agent" | "compile" | "test" | "deploy" | "git";

interface RightPanelProps {
  view: RightPanelView;
  onChangeView: (v: RightPanelView) => void;
  onOpenSettings?: () => void;
  network?: string;
}

const VIEW_ITEMS: { id: RightPanelView; icon: LucideIcon; label: string }[] = [
  { id: "agent", icon: Bot, label: "AI Agent" },
  { id: "compile", icon: Wrench, label: "Compile" },
  { id: "test", icon: TestTube, label: "Tests" },
  { id: "deploy", icon: Rocket, label: "Deploy" },
  { id: "git", icon: GitBranch, label: "Git" },
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
        {view === "test" && <TestPanel />}
        {view === "deploy" && <DeployPanel network={network} />}
        {view === "git" && <GitPanel />}
      </div>
    </div>
  );
}

function CompilePanel() {
  const status = useBuildStore((s) => s.status);
  const lines = useBuildStore((s) => s.lines);
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const error = useBuildStore((s) => s.error);
  const startBuild = useBuildStore((s) => s.startBuild);
  const outputRef = useRef<HTMLDivElement>(null);
  const tree = useFileSystemStore((s) => s.tree);

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
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Build
        </h3>
        <div className="space-y-2">
          <Button
            size="sm"
            onClick={() => startBuild()}
            disabled={status === "building"}
            className="w-full h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] gap-2 disabled:opacity-60"
          >
            {status === "building" ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Wrench size={13} strokeWidth={1.75} />
            )}
            stellar contract build
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Output
          </h3>
          {status === "building" && (
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
    </div>
  );
}

function TestPanel() {
  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Test Results
        </h3>
        <Button size="sm" className="h-7 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]">
          <TestTube size={12} strokeWidth={1.75} />
          Run
        </Button>
      </div>
      <div className="rounded-md bg-[var(--surface-sunken)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
        running 3 tests
      </div>
      <div className="space-y-1">
        {[
          { name: "test::test_default_greeting", status: "pass" },
          { name: "test::test_personalized_greet", status: "pass" },
          { name: "test::test_set_greeting_persists", status: "pass" },
        ].map((t) => (
          <div
            key={t.name}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[var(--surface-hover)] cursor-pointer"
          >
            <Check size={12} className="text-[var(--status-success)]" strokeWidth={2} />
            <span className="text-[var(--text-secondary)]">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeployPanel({ network }: { network: string }) {
  const status = useDeployStore((s) => s.status);
  const lines = useDeployStore((s) => s.lines);
  const contractId = useDeployStore((s) => s.contractId);
  const error = useDeployStore((s) => s.error);
  const deploy = useDeployStore((s) => s.deploy);
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const [sourceAccountSecret, setSourceAccountSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Deploy Contract
      </h3>

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
            No build yet. Run Build first.
          </div>
        )}
      </div>

      {/* Source account */}
      <div>
        <label className="text-[11px] font-medium text-[var(--text-secondary)] mb-1 block">
          Source account secret
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type={showSecret ? "text" : "password"}
            value={sourceAccountSecret}
            onChange={(e) => setSourceAccountSecret(e.target.value)}
            placeholder="S..."
            className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => setShowSecret((v) => !v)}
            className="rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          Secret travels with the deploy request, never stored. In production, sign via wallet instead.
        </p>
      </div>

      {/* Network */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Network</span>
        <span className="font-medium text-[var(--text-primary)] capitalize">{network}</span>
      </div>

      {/* Deploy button */}
      <Button
        size="sm"
        onClick={() => deploy({ network, sourceAccountSecret })}
        disabled={status === "deploying" || !sourceAccountSecret}
        className="w-full h-9 gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
      >
        {status === "deploying" ? (
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <Rocket size={13} strokeWidth={1.75} />
        )}
        Deploy to {network}
      </Button>

      {/* Deploy output */}
      {lines.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Output
            </h4>
            {status === "success" && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--status-success)]">
                <Check size={9} strokeWidth={2} />
                deployed
              </span>
            )}
            {status === "failed" && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--status-error)]">
                <X size={9} strokeWidth={2} />
                failed
              </span>
            )}
          </div>
          <div className="rounded-md bg-[var(--surface-sunken)] p-2 font-mono text-[10px] space-y-0.5 max-h-32 overflow-y-auto">
            {lines.map((line, i) => (
              <div
                key={i}
                className={line.type === "stderr" ? "text-[var(--status-error)]" : "text-[var(--text-secondary)]"}
              >
                {line.text || "\u00A0"}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contract ID on success */}
      {contractId && (
        <div className="rounded-md border border-[var(--status-success)] bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)] p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--status-success)] mb-0.5">
            Contract deployed
          </div>
          <div className="font-mono text-[11px] text-[var(--text-primary)] break-all">
            {contractId}
          </div>
        </div>
      )}

      {/* Error */}
      {error && status === "failed" && (
        <div className="rounded-md border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2 text-[11px] text-[var(--status-error)]">
          {error}
        </div>
      )}

      {/* Contract interaction — auto-generated from contract spec */}
      {contractId && (
        <ContractInteractionPanel contractId={contractId} />
      )}
    </div>
  );
}

function GitPanel() {
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<{
    hasConflicts: boolean;
    hasChanges: boolean;
    summary: { added: number; modified: number; deleted: number; unchanged: number };
    files: { added: string[]; modified: { path: string }[]; deleted: string[]; unchanged: string[] };
    branch: string;
  } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const tree = useFileSystemStore((s) => s.tree);
  const githubConnected = useProfileStore((s) => s.githubConnected);
  const githubUsername = useProfileStore((s) => s.githubUsername);
  const profile = useProfileStore((s) => s.profile);
  const { connectGithub: connectGithubPopup, connecting: oauthConnecting } = useGithubOAuth();
  const activeProject = useProjectsStore((s) => {
    const id = s.activeProjectId;
    return id ? s.projects.find((p) => p.id === id) ?? null : null;
  });

  const files = flattenFiles(tree);

  // Determine the GitHub repo link for the active project.
  // For now, we derive it from the project's serverProjectId metadata.
  // If the project isn't linked to a repo, the user needs to select one
  // in the commit modal (which handles auto-import).
  const linkedRepo = activeProject?.serverProjectId ? null : null; // TODO: store githubRepo on project meta
  const [repoOwner, repoName] = (() => {
    // Parse from project description if it contains "Imported from https://github.com/owner/repo"
    const desc = activeProject?.description ?? "";
    const match = desc.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/);
    if (match) return [match[1], match[2].replace(/\.git$/, "")];
    return [null, null];
  })();

  async function handleCompare() {
    if (!profile?.address || !repoOwner || !repoName) {
      setCompareError("No GitHub repo linked to this project. Use 'Commit to GitHub' to select a repo.");
      return;
    }

    setComparing(true);
    setCompareError(null);
    try {
      const localFiles = files.map((f) => ({ path: f.path, content: f.content }));
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: profile.address,
          owner: repoOwner,
          repo: repoName,
          branch: "main",
          localFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompareError(data.error || "Failed to compare files");
        setCompareResult(null);
      } else {
        setCompareResult(data);
      }
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Failed to compare");
    } finally {
      setComparing(false);
    }
  }

  function handleConnectGithub() {
    if (!profile?.address) return;
    connectGithubPopup();
  }

  // Not connected state — show CTA
  if (!githubConnected) {
    return (
      <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Source Control
          </h3>
        </div>

        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] py-8 px-4 text-center">
          <Github size={28} strokeWidth={1.5} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <h4 className="text-[12px] font-medium text-[var(--text-primary)] mb-1">
            Connect GitHub to enable version control
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mb-4 max-w-xs leading-relaxed">
            Commit your project changes, import repositories, and sync across
            devices. Requires a one-time GitHub authorization.
          </p>
          <Button
            size="sm"
            onClick={handleConnectGithub}
            disabled={!profile || oauthConnecting}
            className="gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
          >
            {oauthConnecting ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Github size={13} strokeWidth={1.75} />
            )}
            {oauthConnecting ? "Connecting…" : "Connect GitHub"}
          </Button>
          {!profile && (
            <p className="mt-2 text-[10px] text-[var(--status-warning)]">
              You must be logged in first.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Connected state — show sync status + commit button
  return (
    <div className="relative flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <LoadingOverlay
        visible={comparing}
        message="Comparing files…"
        submessage="Checking for conflicts with the GitHub repo"
      />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Source Control
        </h3>
        <Button
          size="sm"
          onClick={() => setCommitModalOpen(true)}
          disabled={!profile || files.length === 0}
          className="h-7 gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
        >
          <GitCommit size={12} strokeWidth={1.75} />
          Commit
        </Button>
      </div>

      {/* GitHub connection status */}
      <div className="flex items-center gap-2 rounded-md border border-[var(--status-success)]/30 bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
        <Github size={12} strokeWidth={1.75} className="shrink-0 text-[var(--status-success)]" />
        <span>
          Connected as <span className="font-medium text-[var(--text-primary)]">{githubUsername}</span>
        </span>
      </div>

      {/* Linked repo info */}
      {repoOwner && repoName ? (
        <div className="rounded-md bg-[var(--surface-sunken)] px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
            Linked repo
          </div>
          <div className="text-[12px] font-mono text-[var(--text-primary)] truncate">
            {repoOwner}/{repoName}
          </div>
          <button
            onClick={handleCompare}
            disabled={comparing}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {comparing ? (
              <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <GitCommit size={10} strokeWidth={1.75} />
            )}
            {comparing ? "Comparing…" : "Check sync status"}
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">
            No repo linked
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mb-1">
            This project isn&apos;t connected to a GitHub repo yet.
          </div>
          <button
            onClick={() => setCommitModalOpen(true)}
            className="text-[10px] text-[var(--accent)] hover:underline"
          >
            Select a repo to commit to →
          </button>
        </div>
      )}

      {/* Compare result */}
      {compareError && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--status-warning)]/40 bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] p-2 text-[11px] text-[var(--text-secondary)]">
          <AlertCircle size={12} strokeWidth={1.75} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
          <span>{compareError}</span>
        </div>
      )}

      {compareResult && (
        <div className="space-y-2">
          {/* Summary */}
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2.5">
            <div className="flex items-center gap-2 mb-2">
              {compareResult.hasConflicts ? (
                <AlertCircle size={12} strokeWidth={1.75} className="text-[var(--status-warning)]" />
              ) : compareResult.hasChanges ? (
                <Check size={12} strokeWidth={2} className="text-[var(--status-success)]" />
              ) : (
                <Check size={12} strokeWidth={2} className="text-[var(--text-muted)]" />
              )}
              <span className="text-[11px] font-medium text-[var(--text-primary)]">
                {compareResult.hasConflicts
                  ? "Conflicts detected"
                  : compareResult.hasChanges
                  ? "Changes ready to commit"
                  : "In sync — no changes"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[14px] font-mono font-semibold text-[var(--status-success)]">
                  {compareResult.summary.added}
                </div>
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Added</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[14px] font-mono font-semibold text-[var(--status-warning)]">
                  {compareResult.summary.modified}
                </div>
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Modified</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[14px] font-mono font-semibold text-[var(--status-error)]">
                  {compareResult.summary.deleted}
                </div>
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Deleted</div>
              </div>
              <div className="rounded bg-[var(--surface-raised)] py-1">
                <div className="text-[14px] font-mono font-semibold text-[var(--text-muted)]">
                  {compareResult.summary.unchanged}
                </div>
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Same</div>
              </div>
            </div>
          </div>

          {/* File lists */}
          {compareResult.files.added.length > 0 && (
            <FileList label="Added" files={compareResult.files.added} color="var(--status-success)" letter="A" />
          )}
          {compareResult.files.modified.length > 0 && (
            <FileList label="Modified" files={compareResult.files.modified.map((f) => f.path)} color="var(--status-warning)" letter="M" />
          )}
          {compareResult.files.deleted.length > 0 && (
            <FileList label="Deleted (on GitHub, not local)" files={compareResult.files.deleted} color="var(--status-error)" letter="D" />
          )}
        </div>
      )}

      {/* Project files count (when not comparing) */}
      {!compareResult && !comparing && files.length > 0 && (
        <div className="text-[10px] text-[var(--text-muted)]">
          {files.length} files in project
        </div>
      )}

      <CommitToGithubModal open={commitModalOpen} onClose={() => setCommitModalOpen(false)} />
    </div>
  );
}

function FileList({
  label,
  files,
  color,
  letter,
}: {
  label: string;
  files: string[];
  color: string;
  letter: string;
}) {
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
        {label} ({files.length})
      </h4>
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {files.map((path) => (
          <div
            key={path}
            className="flex items-center gap-2 rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
          >
            <span className="font-mono text-[10px] w-3 shrink-0" style={{ color }}>
              {letter}
            </span>
            <span className="truncate">{path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
