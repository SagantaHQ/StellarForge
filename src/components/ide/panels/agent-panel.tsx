"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Plus,
  X,
  Send,
  Settings as SettingsIcon,
  Check,
  XCircle,
  AlertCircle,
  FileCode2,
  Loader2,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAIKeysStore } from "@/stores/ai-keys-store";
import { useAIChat } from "@/hooks/use-ai-chat";
import { PROVIDERS, PROVIDER_LIST, type ProviderId, type ChatMessage } from "@/lib/ai/providers";
import type { ParsedDiff } from "@/lib/ai/context-assembler";
import { useFileSystemStore } from "@/stores/file-system-store";

type AgentScope = "smart-contract" | "ui-frontend" | "general" | "custom";

interface AgentTab {
  id: string;
  name: string;
  scope: AgentScope;
  messages: { role: "user" | "assistant" | "system"; content: string; timestamp: number }[];
  pendingDiffs: ParsedDiff[];
  unread?: boolean;
}

export function AgentPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [tabs, setTabs] = useState<AgentTab[]>([
    {
      id: "tab-1",
      name: "Contract Work",
      scope: "smart-contract",
      messages: [],
      pendingDiffs: [],
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("tab-1");
  const [input, setInput] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeProviderId = useAIKeysStore((s) => s.activeProviderId);
  const providers = useAIKeysStore((s) => s.providers);
  const setActiveProvider = useAIKeysStore((s) => s.setActiveProvider);
  const allowAlways = useAIKeysStore((s) => s.allowAlways);
  const setAllowAlways = useAIKeysStore((s) => s.setAllowAlways);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;
  const scope = activeTab.scope;

  const { sendMessage, loading, error, lastTokenUsage, lastContextFiles, clearError } = useAIChat({
    scope,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTab.messages.length, loading]);

  function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg = {
      role: "user" as const,
      content: input,
      timestamp: Date.now(),
    };
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [...t.messages, userMsg] }
          : t
      )
    );
    const userInput = input;
    setInput("");

    // Build history for context (last 10 messages)
    const history: ChatMessage[] = activeTab.messages.slice(-10).map((m) => ({
      role: m.role === "system" ? "system" : m.role,
      content: m.content,
    }));

    sendMessage(userInput, history).then(({ response, diffs }) => {
      if (response) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  messages: [
                    ...t.messages,
                    {
                      role: "assistant" as const,
                      content: response.content,
                      timestamp: Date.now(),
                    },
                  ],
                  pendingDiffs: diffs,
                }
              : t
          )
        );
      }
    });
  }

  function handleAcceptDiff(diff: ParsedDiff) {
    // Apply the diff to the file system
    const file = useFileSystemStore.getState().tree;
    const updateFileContent = useFileSystemStore.getState().updateFileContent;
    // For now, just append a comment showing the diff was accepted
    // (Real implementation would apply the hunk lines to the file)
    void file;
    void updateFileContent;
    void diff;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, pendingDiffs: t.pendingDiffs.filter((d) => d !== diff) }
          : t
      )
    );
  }

  function handleRejectDiff(diff: ParsedDiff) {
    void diff;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, pendingDiffs: t.pendingDiffs.filter((d) => d !== diff) }
          : t
      )
    );
  }

  function addTab() {
    const id = `tab-${Date.now()}`;
    setTabs((prev) => [
      ...prev,
      {
        id,
        name: "New chat",
        scope: "general",
        messages: [],
        pendingDiffs: [],
      },
    ]);
    setActiveTabId(id);
  }

  const activeConfig = activeProviderId ? providers[activeProviderId] : null;
  // Ollama doesn't need an API key — it's "configured" if the entry exists
  const hasProvider =
    !!activeConfig &&
    (activeProviderId === "ollama" ? true : !!activeConfig.apiKey);

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
            {tab.pendingDiffs.length > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-[var(--accent-subtle)] px-1.5 text-[10px] font-medium text-[var(--accent)]">
                <FileCode2 size={8} strokeWidth={2} />
                {tab.pendingDiffs.length}
              </span>
            )}
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

      {/* Scope badge */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[var(--text-muted)]">Scope:</span>
          <span className="font-medium text-[var(--text-secondary)] capitalize">
            {scope.replace("-", " ")}
          </span>
        </div>
        {hasProvider && activeProviderId && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[var(--text-muted)]">{PROVIDERS[activeProviderId].name}</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="font-mono text-[var(--text-secondary)]">
              {activeConfig?.model === "__custom__" ? activeConfig?.customModel : activeConfig?.model}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {activeTab.messages.length === 0 && !loading && (
          <EmptyAgentState hasProvider={hasProvider} onOpenSettings={onOpenSettings} />
        )}

        {activeTab.messages.map((msg, i) => (
          <MessageView key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}

        {/* Pending diffs */}
        {activeTab.pendingDiffs.map((diff, i) => (
          <DiffApprovalCard
            key={`diff-${i}`}
            diff={diff}
            onAccept={() => handleAcceptDiff(diff)}
            onReject={() => handleRejectDiff(diff)}
            allowAlways={allowAlways}
            onToggleAllowAlways={setAllowAlways}
          />
        ))}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            <span>Thinking…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded border border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] px-2.5 py-1.5 text-xs text-[var(--status-error)]">
            <div className="flex items-start gap-2">
              <AlertCircle size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Request failed</div>
                <div className="mt-0.5 text-[11px] opacity-90">{error}</div>
              </div>
              <button
                onClick={clearError}
                className="shrink-0 hover:opacity-70"
                aria-label="Dismiss error"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {/* Token usage */}
        {lastTokenUsage && (lastTokenUsage.inputTokens || lastTokenUsage.outputTokens) && (
          <div className="flex items-center justify-end gap-2 text-[10px] text-[var(--text-muted)]">
            <span>
              ↑ {lastTokenUsage.inputTokens ?? "?"} in
              {lastTokenUsage.cacheReadTokens ? ` (${lastTokenUsage.cacheReadTokens} cached)` : ""}
            </span>
            <span>·</span>
            <span>↓ {lastTokenUsage.outputTokens ?? "?"} out</span>
            {lastContextFiles.length > 0 && (
              <>
                <span>·</span>
                <span>{lastContextFiles.length} files in context</span>
              </>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Provider picker dropdown */}
      {showProviderPicker && (
        <ProviderPicker
          onClose={() => setShowProviderPicker(false)}
          onOpenSettings={onOpenSettings}
        />
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
                handleSend();
              }
            }}
            placeholder={
              hasProvider
                ? "Ask the agent… (Enter to send, Shift+Enter for newline)"
                : "Configure an AI provider in Settings to start chatting…"
            }
            rows={2}
            disabled={loading}
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] resize-none disabled:opacity-50"
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowProviderPicker((v) => !v)}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                activeProviderId
                  ? "text-[var(--accent)] hover:bg-[var(--surface-hover)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              )}
              aria-label="Switch provider"
              title="Switch provider"
            >
              <span className="max-w-[80px] truncate">
                {activeProviderId ? PROVIDERS[activeProviderId].name : "Pick provider"}
              </span>
              <ChevronDown size={10} strokeWidth={1.75} />
            </button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!input.trim() || loading || !hasProvider}
              className="h-7 w-7 p-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] disabled:opacity-50"
              aria-label="Send message"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.75} />}
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
          BYOK · Keys stored only in your browser · Diffs require approval
          {allowAlways && <span className="text-[var(--status-warning)]"> · Auto-approve ON</span>}
        </p>
      </div>
    </div>
  );
}

function EmptyAgentState({ hasProvider, onOpenSettings }: { hasProvider: boolean; onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-raised)]">
        <Sparkles size={20} strokeWidth={1.5} className="text-[var(--accent)]" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Soroban AI Agent</h3>
        <p className="text-xs text-[var(--text-muted)] max-w-[260px]">
          {hasProvider
            ? "Ask me to write, refactor, or fix Soroban contract code. I'll propose diffs you can review."
            : "Bring your own API key (OpenAI, Claude, Gemini, and 9 others). Keys are stored only in your browser."}
        </p>
      </div>
      {!hasProvider && (
        <Button
          size="sm"
          onClick={onOpenSettings}
          className="h-8 gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
        >
          <SettingsIcon size={13} strokeWidth={1.75} />
          Configure provider
        </Button>
      )}
    </div>
  );
}

function MessageView({ role, content, timestamp }: { role: string; content: string; timestamp: number }) {
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
        <div className="max-w-[85%]">
          <div className="rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[13px] text-[var(--accent-contrast)]">
            {content}
          </div>
          <div className="mt-0.5 text-right text-[10px] text-[var(--text-muted)]">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)]">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            <Bot size={10} strokeWidth={1.75} />
            <span>Agent</span>
          </div>
          <div className="whitespace-pre-wrap break-words">{content}</div>
        </div>
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function DiffApprovalCard({
  diff,
  onAccept,
  onReject,
  allowAlways,
  onToggleAllowAlways,
}: {
  diff: ParsedDiff;
  onAccept: () => void;
  onReject: () => void;
  allowAlways: boolean;
  onToggleAllowAlways: (v: boolean) => void;
}) {
  const [showFull, setShowFull] = useState(false);
  return (
    <div className="rounded-md border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface-panel))]">
      <div className="flex items-center justify-between border-b border-[var(--accent)] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)]">
          <FileCode2 size={11} strokeWidth={1.75} />
          <span>Proposed change · {diff.filePath}</span>
        </div>
        <button
          onClick={() => setShowFull((v) => !v)}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          {showFull ? "Collapse" : "Expand"}
        </button>
      </div>
      {showFull && (
        <pre className="max-h-48 overflow-y-auto px-2.5 py-1.5 text-[11px] font-mono leading-relaxed">
          {diff.raw.split("\n").map((line, i) => (
            <div
              key={i}
              className={cn(
                line.startsWith("+") && "text-[var(--status-success)] bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)]",
                line.startsWith("-") && "text-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_8%,transparent)]",
                line.startsWith("@@") && "text-[var(--accent)]"
              )}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--accent)] px-2.5 py-1.5">
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={allowAlways}
            onChange={(e) => onToggleAllowAlways(e.target.checked)}
            className="h-3 w-3 rounded border-[var(--border-strong)]"
          />
          <span>Allow always</span>
        </label>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onReject}
            className="h-6 gap-1 px-2 text-[11px] text-[var(--text-muted)] hover:text-[var(--status-error)]"
          >
            <XCircle size={11} strokeWidth={1.75} />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            className="h-6 gap-1 px-2 text-[11px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)]"
          >
            <Check size={11} strokeWidth={2} />
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProviderPicker({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const providers = useAIKeysStore((s) => s.providers);
  const activeProviderId = useAIKeysStore((s) => s.activeProviderId);
  const setActiveProvider = useAIKeysStore((s) => s.setActiveProvider);

  const configured = PROVIDER_LIST.filter((p) => providers[p.id]?.apiKey);
  const unconfigured = PROVIDER_LIST.filter((p) => !providers[p.id]?.apiKey);

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">Switch provider</span>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </div>
      {configured.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Configured</div>
          {configured.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActiveProvider(p.id);
                onClose();
              }}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                activeProviderId === p.id
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              )}
            >
              <span>{p.name}</span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {providers[p.id]?.model === "__custom__"
                  ? providers[p.id]?.customModel
                  : providers[p.id]?.model}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Available</div>
        <div className="grid grid-cols-2 gap-1">
          {unconfigured.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
