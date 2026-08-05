"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, Terminal as TerminalIcon, X, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface TerminalLine {
  type: "input" | "output" | "error" | "system";
  text: string;
}

interface TerminalTab {
  id: string;
  name: string;
  lines: TerminalLine[];
  history: string[];
  historyIdx: number;
}

const INITIAL_TABS: TerminalTab[] = [
  {
    id: "tab-1",
    name: "bash",
    lines: [
      { type: "system", text: "Soroban.Build terminal — sandboxed session" },
      { type: "system", text: "Toolchain: rustc 1.81.0 · stellar-cli 22.0.0" },
      { type: "system", text: "Network: testnet (rpc.testnet.stellar.gateway.io)" },
      { type: "output", text: "" },
      { type: "output", text: "$ Type a command and press Enter. Try: cargo build, stellar contract build, stellar account balance" },
    ],
    history: [],
    historyIdx: -1,
  },
];

interface TerminalPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  height?: number;
  /** §9.7 — Called when user clicks 'Fix with AI' on a build error.
   *  Receives the error output + the last command that was run. */
  onFixWithAI?: (errorOutput: string, command: string) => void;
}

export function TerminalPanel({ collapsed, onToggleCollapse, onFixWithAI }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_TABS[0].id);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTab.lines.length, collapsed]);

  function addLine(tabId: string, line: TerminalLine) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, lines: [...t.lines, line] } : t
      )
    );
  }

  function executeCommand(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addLine(activeTabId, { type: "input", text: `$ ${trimmed}` });
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, history: [...t.history, trimmed], historyIdx: t.history.length }
          : t
      )
    );

    // Simulated command responses (real PTY would be wired in production)
    setTimeout(() => {
      const response = simulateCommand(trimmed);
      response.forEach((line) => addLine(activeTabId, line));
    }, 200);

    setInput("");
  }

  function simulateCommand(cmd: string): TerminalLine[] {
    const [bin, ...args] = cmd.split(/\s+/);
    switch (bin) {
      case "cargo":
        if (args[0] === "build") {
          return [
            { type: "output", text: "   Compiling hello-world v0.1.0 (/workspace)" },
            { type: "output", text: "    Finished dev [unoptimized + debuginfo] target(s) in 0.42s" },
          ];
        }
        if (args[0] === "test") {
          return [
            { type: "output", text: "   Compiling hello-world v0.1.0" },
            { type: "output", text: "    Finished test [unoptimized + debuginfo] target(s) in 0.61s" },
            { type: "output", text: "     Running unittests src/lib.rs" },
            { type: "output", text: "" },
            { type: "output", text: "running 3 tests" },
            { type: "output", text: "test test::test_default_greeting ... ok" },
            { type: "output", text: "test test::test_personalized_greet ... ok" },
            { type: "output", text: "test test::test_set_greeting_persists ... ok" },
            { type: "output", text: "" },
            { type: "output", text: "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out" },
          ];
        }
        return [{ type: "error", text: `cargo: unknown subcommand '${args[0] ?? ""}'` }];

      case "stellar":
        if (args[0] === "contract" && args[1] === "build") {
          return [
            { type: "output", text: "📦 Cargo building..." },
            { type: "output", text: "   Compiling hello-world v0.1.0" },
            { type: "output", text: "✨ Built hello_world.wasm" },
            { type: "output", text: "   Path: target/wasm32v1-none/release/hello_world.wasm" },
            { type: "output", text: "   Size: 4.2 KB" },
          ];
        }
        if (args[0] === "account" && args[1] === "balance") {
          return [
            { type: "output", text: "Account: GDF...XQPK" },
            { type: "output", text: "Balance: 1,250.00000 XLM" },
          ];
        }
        return [{ type: "error", text: `stellar: unknown command '${args.join(" ")}'` }];

      case "ls":
        return [{ type: "output", text: "Cargo.toml  README.md  src/  target/  ui/" }];

      case "pwd":
        return [{ type: "output", text: "/workspace/hello-world" }];

      case "clear":
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTabId ? { ...t, lines: [] } : t))
        );
        return [];

      case "help":
        return [
          { type: "output", text: "Available commands (simulated in this preview):" },
          { type: "output", text: "  cargo build | test      Build or test the contract" },
          { type: "output", text: "  stellar contract build  Build the .wasm" },
          { type: "output", text: "  stellar account balance Check balance" },
          { type: "output", text: "  ls, pwd, clear, help    Standard shell utilities" },
        ];

      default:
        return [{ type: "error", text: `command not found: ${bin}` }];
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const hist = activeTab.history;
      if (hist.length === 0) return;
      const newIdx = Math.max(0, activeTab.historyIdx - 1);
      setInput(hist[newIdx] ?? "");
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, historyIdx: newIdx } : t
        )
      );
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const hist = activeTab.history;
      if (hist.length === 0) return;
      const newIdx = Math.min(hist.length, activeTab.historyIdx + 1);
      setInput(hist[newIdx] ?? "");
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, historyIdx: newIdx } : t
        )
      );
    } else if (e.ctrlKey && e.key === "l") {
      e.preventDefault();
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, lines: [] } : t))
      );
    }
  }

  function addTab() {
    const id = `tab-${Date.now()}`;
    const newTab: TerminalTab = {
      id,
      name: "bash",
      lines: [
        { type: "system", text: "Soroban.Build terminal — sandboxed session" },
        { type: "output", text: "" },
      ],
      history: [],
      historyIdx: -1,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      if (prev.length === 1) {
        onToggleCollapse();
        return prev;
      }
      const filtered = prev.filter((t) => t.id !== id);
      if (id === activeTabId) setActiveTabId(filtered[0].id);
      return filtered;
    });
  }

  if (collapsed) {
    return (
      <div className="flex h-9 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <TerminalIcon size={13} strokeWidth={1.75} />
          <span>Terminal</span>
          <ChevronUp size={12} strokeWidth={1.75} />
        </button>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <span
              key={t.id}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                t.id === activeTabId ? "bg-[var(--accent)]" : "bg-[var(--text-muted)]"
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-t border-[var(--border-subtle)] bg-[var(--surface-panel)]">
      {/* Tab bar */}
      <div className="flex h-9 items-center justify-between border-b border-[var(--border-subtle)] px-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-t px-3 py-1.5 text-xs transition-colors",
                tab.id === activeTabId
                  ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              )}
            >
              <TerminalIcon size={12} strokeWidth={1.75} />
              <span>{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-hover)] rounded p-0.5"
                aria-label={`Close ${tab.name}`}
              >
                <X size={10} strokeWidth={1.75} />
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="New terminal"
          >
            <Plus size={13} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Clear"
            onClick={() =>
              setTabs((prev) =>
                prev.map((t) => (t.id === activeTabId ? { ...t, lines: [] } : t))
              )
            }
          >
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Collapse terminal"
          >
            <ChevronDown size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Lines */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed"
        style={{
          background: "var(--mono-bg)",
          color: "var(--mono-fg)",
        }}
        onClick={() => {
          document.getElementById("terminal-input")?.focus();
        }}
      >
        {activeTab.lines.map((line, i) => (
          <TerminalLineView key={i} line={line} />
        ))}
        {/* Input line */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: "var(--accent)" }}>$</span>
          <input
            id="terminal-input"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none"
            style={{ color: "var(--mono-fg)" }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      {/* "Fix with AI" hint on errors */}
      {activeTab.lines.some((l) => l.type === "error") && (
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
          <span className="text-xs text-[var(--text-muted)]">
            Build failed. Let the AI agent diagnose the error.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!onFixWithAI) return;
              // Collect error lines + surrounding context
              const errorLines = activeTab.lines
                .filter((l) => l.type === "error" || l.type === "output")
                .map((l) => l.text)
                .join("\n");
              // Find the last input command
              const lastInput = activeTab.lines
                .filter((l) => l.type === "input")
                .map((l) => l.text.replace(/^\$\s*/, ""))
                .pop() ?? "";
              onFixWithAI(errorLines, lastInput);
            }}
            className="h-7 gap-1.5 text-xs text-[var(--accent)] hover:bg-[var(--surface-hover)]"
          >
            <Bot size={13} strokeWidth={1.75} />
            Fix with AI
          </Button>
        </div>
      )}
    </div>
  );
}

function TerminalLineView({ line }: { line: TerminalLine }) {
  switch (line.type) {
    case "input":
      return <div style={{ color: "var(--text-primary)" }}>{line.text}</div>;
    case "output":
      return (
        <div style={{ color: "var(--text-secondary)" }} className="whitespace-pre-wrap">
          {line.text || "\u00A0"}
        </div>
      );
    case "error":
      return (
        <div style={{ color: "var(--status-error)" }} className="whitespace-pre-wrap">
          {line.text}
        </div>
      );
    case "system":
      return (
        <div style={{ color: "var(--text-muted)" }} className="italic">
          {line.text}
        </div>
      );
  }
}
