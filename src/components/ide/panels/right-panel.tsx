"use client";

import { useState } from "react";
import {
  Bot,
  Wrench,
  Rocket,
  TestTube,
  GitBranch,
  Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentPanel } from "./agent-panel";

type RightPanelView = "agent" | "compile" | "test" | "deploy" | "git";

interface RightPanelProps {
  view: RightPanelView;
  onChangeView: (v: RightPanelView) => void;
  onOpenSettings?: () => void;
}

const VIEW_ITEMS: { id: RightPanelView; icon: LucideIcon; label: string }[] = [
  { id: "agent", icon: Bot, label: "AI Agent" },
  { id: "compile", icon: Wrench, label: "Compile" },
  { id: "test", icon: TestTube, label: "Tests" },
  { id: "deploy", icon: Rocket, label: "Deploy" },
  { id: "git", icon: GitBranch, label: "Git" },
];

export function RightPanel({ view, onChangeView, onOpenSettings }: RightPanelProps) {
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
        {view === "deploy" && <DeployPanel />}
        {view === "git" && <GitPanel />}
      </div>
    </div>
  );
}

function CompilePanel() {
  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Build
        </h3>
        <div className="space-y-2">
          <Button size="sm" className="w-full h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] gap-2">
            <Wrench size={13} strokeWidth={1.75} />
            soroban contract build
          </Button>
          <Button size="sm" variant="outline" className="w-full h-8 gap-2 border-[var(--border-subtle)]">
            <Wrench size={13} strokeWidth={1.75} />
            cargo build
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Output
        </h3>
        <div className="rounded-md bg-[var(--surface-sunken)] p-2.5 font-mono text-[11px] text-[var(--text-secondary)] space-y-1">
          <div>📦 Cargo building...</div>
          <div>   Compiling hello-world v0.1.0</div>
          <div>✨ Built hello_world.wasm</div>
          <div>   Path: target/wasm32v1-none/release/hello_world.wasm</div>
          <div>   Size: 4.2 KB</div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Diagnostics
        </h3>
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer">
            <Check size={12} className="text-[var(--status-success)]" strokeWidth={2} />
            <span>No errors</span>
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer">
            <Check size={12} className="text-[var(--status-warning)]" strokeWidth={2} />
            <span>No warnings</span>
          </div>
        </div>
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

function DeployPanel() {
  return (
    <div className="flex h-full flex-col p-3 gap-3 overflow-y-auto">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Deploy Contract
      </h3>
      <div className="space-y-2">
        <div className="rounded-md border border-[var(--border-subtle)] p-2.5">
          <div className="text-[11px] text-[var(--text-muted)] mb-1">WASM file</div>
          <div className="text-xs font-mono text-[var(--text-primary)]">hello_world.wasm</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">4.2 KB · wasm32v1-none</div>
        </div>
        <Button size="sm" className="w-full h-9 gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]">
          <Rocket size={13} strokeWidth={1.75} />
          Deploy to Testnet
        </Button>
      </div>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Contract Interaction
        </h4>
        <p className="text-[11px] text-[var(--text-muted)] mb-2">
          Auto-generated from contract spec after deploy.
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
