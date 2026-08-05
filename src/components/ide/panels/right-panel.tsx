"use client";

import { useState, useEffect, useRef } from "react";
import {
  Bot,
  Wrench,
  Rocket,
  TestTube,
  GitBranch,
  Check,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentPanel } from "./agent-panel";
import { useBuildStore } from "@/stores/build-store";
import { useDeployStore } from "@/stores/deploy-store";

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
            soroban contract build
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => startBuild({ command: "cargo" })}
            disabled={status === "building"}
            className="w-full h-8 gap-2 border-[var(--border-subtle)] disabled:opacity-60"
          >
            <Wrench size={13} strokeWidth={1.75} />
            cargo build
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

      {/* Contract interaction (placeholder until deployed) */}
      {contractId && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
            Contract Interaction
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            Auto-generated from contract spec.
          </p>
          <div className="space-y-1.5">
            {["get_greeting() → String", "set_greeting(greeting: String) → String", "greet(name: String) → String"].map((fn) => (
              <div
                key={fn}
                className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]"
              >
                {fn}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GitPanel() {
  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Source Control
        </h3>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
          <GitBranch size={12} strokeWidth={1.75} />
          Commit
        </Button>
      </div>
      <div>
        <h4 className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
          Changes (2)
        </h4>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)] cursor-pointer">
            <span className="font-mono text-[var(--status-warning)] text-[10px]">M</span>
            <span className="text-[var(--text-secondary)]">src/lib.rs</span>
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)] cursor-pointer">
            <span className="font-mono text-[var(--status-info)] text-[10px]">U</span>
            <span className="text-[var(--text-secondary)]">src/test.rs</span>
          </div>
        </div>
      </div>
      <div>
        <textarea
          placeholder="Commit message"
          rows={3}
          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none"
        />
      </div>
    </div>
  );
}
