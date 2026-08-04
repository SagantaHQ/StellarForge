"use client";

import { useState } from "react";
import {
  Bot,
  Plus,
  X,
  Send,
  Settings as SettingsIcon,
  Wrench,
  Rocket,
  TestTube,
  GitBranch,
  Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type RightPanelView = "agent" | "compile" | "test" | "deploy" | "git";

interface RightPanelProps {
  view: RightPanelView;
  onChangeView: (v: RightPanelView) => void;
}

const VIEW_ITEMS: { id: RightPanelView; icon: LucideIcon; label: string }[] = [
  { id: "agent", icon: Bot, label: "AI Agent" },
  { id: "compile", icon: Wrench, label: "Compile" },
  { id: "test", icon: TestTube, label: "Tests" },
  { id: "deploy", icon: Rocket, label: "Deploy" },
  { id: "git", icon: GitBranch, label: "Git" },
];

interface AgentTab {
  id: string;
  name: string;
  scope: "smart-contract" | "ui-frontend" | "general" | "custom";
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  unread?: boolean;
}

export function RightPanel({ view, onChangeView }: RightPanelProps) {
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
        {view === "agent" && <AgentPanel />}
        {view === "compile" && <CompilePanel />}
        {view === "test" && <TestPanel />}
        {view === "deploy" && <DeployPanel />}
        {view === "git" && <GitPanel />}
      </div>
    </div>
  );
}

function AgentPanel() {
  const [tabs, setTabs] = useState<AgentTab[]>([
    {
      id: "tab-1",
      name: "Contract Work",
      scope: "smart-contract",
      messages: [
        {
          role: "system",
          content: "Agent ready. Bring your own key (BYOK) — pick a provider in Settings.",
        },
      ],
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("tab-1");
  const [input, setInput] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;

  function sendMessage() {
    if (!input.trim()) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [...t.messages, { role: "user", content: input }] }
          : t
      )
    );
    setInput("");
    // Simulated agent response
    setTimeout(() => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    role: "assistant",
                    content:
                      "I'd help you with that — once you connect a provider in Settings, I can read your contract, propose diffs, and explain my reasoning. Try the Compile panel in the meantime to see build output.",
                  },
                ],
              }
            : t
        )
      );
    }, 600);
  }

  function addTab() {
    const id = `tab-${Date.now()}`;
    setTabs((prev) => [
      ...prev,
      {
        id,
        name: "New chat",
        scope: "general",
        messages: [{ role: "system", content: "Pick a scope for this chat to keep context tight." }],
      },
    ]);
    setActiveTabId(id);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Agent tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={cn(
              "group flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors whitespace-nowrap",
              tab.id === activeTabId
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
            )}
          >
            <span>{tab.name}</span>
            {tab.unread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
            {tab.id !== activeTabId && tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTabs((prev) => prev.filter((t) => t.id !== tab.id));
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-hover)] rounded p-0.5"
                aria-label="Close tab"
              >
                <X size={10} strokeWidth={1.75} />
              </button>
            )}
          </button>
        ))}
        <button
          onClick={addTab}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="New agent tab"
        >
          <Plus size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {activeTab.messages.map((msg, i) => (
          <MessageView key={i} role={msg.role} content={msg.content} />
        ))}
      </div>

      {/* Provider picker */}
      {showProviderPicker && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Choose provider</span>
            <button
              onClick={() => setShowProviderPicker(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {["OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "OpenRouter", "Bedrock", "Ollama"].map((p) => (
              <button
                key={p}
                onClick={() => setShowProviderPicker(false)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[var(--border-subtle)] p-2.5">
        <div className="flex items-end gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] resize-none"
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowProviderPicker((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Provider settings"
              title="Choose provider"
            >
              <SettingsIcon size={13} strokeWidth={1.75} />
            </button>
            <Button
              size="sm"
              onClick={sendMessage}
              className="h-7 w-7 p-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
              aria-label="Send message"
            >
              <Send size={13} strokeWidth={1.75} />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
          BYOK · Keys stored only in your browser · Agent diffs require approval
        </p>
      </div>
    </div>
  );
}

function MessageView({ role, content }: { role: "user" | "assistant" | "system"; content: string }) {
  if (role === "system") {
    return (
      <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[11px] italic text-[var(--text-muted)]">
        {content}
      </div>
    );
  }
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[13px] text-[var(--accent-contrast)]">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)]">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          <Bot size={10} strokeWidth={1.75} />
          <span>Agent</span>
        </div>
        {content}
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
