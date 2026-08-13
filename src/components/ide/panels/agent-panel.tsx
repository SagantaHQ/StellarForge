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
  Search,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAIKeysStore } from "@/stores/ai-keys-store";
import { useAIChat } from "@/hooks/use-ai-chat";
import { PROVIDERS, PROVIDER_LIST, type ProviderId, type ChatMessage } from "@/lib/ai/providers";
import { parseDiffFromResponse, type ParsedDiff } from "@/lib/ai/context-assembler";
import { useFileSystemStore } from "@/stores/file-system-store";
import { flattenFiles } from "@/lib/soroban/sample-project";
import { useFixWithAIStore } from "@/stores/fix-with-ai-store";
import { useAttributionStore } from "@/stores/attribution-store";
import { useProfileStore } from "@/stores/profile-store";
import { useAgentTabsStore } from "@/stores/agent-tabs-store";
import { useBuildStore } from "@/stores/build-store";
import { findFile } from "@/lib/soroban/sample-project";

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
  // Chat tabs are now persisted in the agent-tabs-store (localStorage) so
  // chat history survives page reloads. We use the store's updateTab helper
  // via a setTabs wrapper to minimize changes to the existing setTabs calls.
  const storeTabs = useAgentTabsStore((s) => s.tabs);
  const storeActiveTabId = useAgentTabsStore((s) => s.activeTabId);
  const storeSetTabs = useAgentTabsStore((s) => s.setTabs);
  const storeSetActiveTabId = useAgentTabsStore((s) => s.setActiveTabId);
  const storeRemoveTab = useAgentTabsStore((s) => s.removeTab);

  // Cast to local AgentTab type (pendingDiffs is unknown[] in the store,
  // ParsedDiff[] here — same shape, just typed differently to avoid import cycle)
  const tabs = storeTabs as AgentTab[];
  const activeTabId = storeActiveTabId;

  // Wrapper: accepts either an array or an updater function, matches the
  // old useState pattern so existing setTabs((prev) => ...) calls work.
  const setTabs = (updater: AgentTab[] | ((prev: AgentTab[]) => AgentTab[])) => {
    const newTabs = typeof updater === "function" ? (updater as (prev: AgentTab[]) => AgentTab[])(storeTabs as AgentTab[]) : updater;
    storeSetTabs(newTabs);
  };

  const setActiveTabId = (id: string) => storeSetActiveTabId(id);
  const [input, setInput] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeProviderId = useAIKeysStore((s) => s.activeProviderId);
  const providers = useAIKeysStore((s) => s.providers);
  const setActiveProvider = useAIKeysStore((s) => s.setActiveProvider);
  const profile = useProfileStore((s) => s.profile);
  const allowAlways = useAIKeysStore((s) => s.allowAlways);
  const setAllowAlways = useAIKeysStore((s) => s.setAllowAlways);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;
  const scope = activeTab.scope;

  const { sendMessage, loading, error, lastTokenUsage, lastContextFiles, clearError } = useAIChat({
    scope,
  });

  const pendingFix = useFixWithAIStore((s) => s.pendingFix);
  const recordEdit = useAttributionStore((s) => s.recordEdit);
  const consumeFix = useFixWithAIStore((s) => s.consumeFix);
  const hasProvider = useAIKeysStore((s) => {
    const cfg = s.providers[s.activeProviderId ?? "" as ProviderId];
    return !!cfg && (s.activeProviderId === "ollama" ? true : !!cfg.apiKey);
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTab.messages.length, loading]);

  // Listen for AI prompt events from the editor (Refactor / Explain / Fix with AI)
  // These are dispatched by monaco-editor.tsx when the user right-clicks and
  // picks one of the AI actions. We pre-fill the input with the prompt so the
  // user can review it before sending (or just press Enter to send).
  useEffect(() => {
    function handleAgentPrompt(e: Event) {
      const detail = (e as CustomEvent<{ prompt: string }>).detail;
      if (detail?.prompt) {
        setInput(detail.prompt);
        // Focus the input so the user can immediately press Enter to send
        const inputEl = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
          "[data-agent-input]"
        );
        inputEl?.focus();
      }
    }
    window.addEventListener("soroban-agent-prompt", handleAgentPrompt);
    return () => window.removeEventListener("soroban-agent-prompt", handleAgentPrompt);
  }, []);

  // §9.7 — Auto-consume pending fix requests from the terminal/build 'Fix with AI' button
  useEffect(() => {
    if (!pendingFix || loading || !hasProvider) return;
    const fixMessage = `The following build command failed:

\`\`\`
$ ${pendingFix.command}
\`\`\`

Error output:
\`\`\`
${pendingFix.errorOutput}
\`\`\`

Fix the error. You MUST output a diff block with the corrected code so it can be applied directly. Format:

\`\`\`diff
--- a/<file_path>
+++ b/<file_path>
@@ -<line>,<count> +<line>,<count> @@
 context line
-removed line
+added line
 context line
\`\`\`

Steps:
1. Identify which file caused the error (the error output usually contains the file path + line number, e.g. \`src/lib.rs:10:5\`)
2. Explain briefly why the error occurred (1-2 sentences)
3. Output the fix as a diff block with the EXACT file path from the project file list
4. The diff must use proper --- / +++ / @@ markers so it can be parsed + applied

Do NOT just explain the error — output the actual fix as a diff.`;
    // Add the user message visibly
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { role: "user" as const, content: fixMessage, timestamp: Date.now() },
              ],
            }
          : t
      )
    );
    // Send to the provider with the error as context.
    // assembleContext (called inside sendMessage) automatically includes:
    //   - all project file contents (behind the scenes)
    //   - Cargo.toml (behind the scenes)
    //   - the errorContext (prepended to the user message)
    // So the AI sees: error + file contents + Cargo.toml + user request.
    sendMessage(fixMessage, [], undefined, { errorContext: pendingFix.errorOutput }).then(({ response }) => {
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
                  pendingDiffs: parseDiffFromResponse(
                    response.content,
                    flattenFiles(useFileSystemStore.getState().tree).map((f) => f.path)
                  ),
                }
              : t
          )
        );
      }
    });
    consumeFix();
  }, [pendingFix, loading, hasProvider, activeTabId, sendMessage, consumeFix]);

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
    // §9.5 — Apply the diff to the file system
    const fs = useFileSystemStore.getState();
    const file = findFile(fs.tree, diff.filePath);

    if (!file) {
      // File not found in the project tree — show a visible error instead of
      // silently doing nothing. This happens when the AI hallucinates a path
      // or when the file was deleted after the AI generated the diff.
      console.error("[agent] cannot apply diff — file not found:", diff.filePath, {
        knownFiles: flattenFiles(fs.tree).map((f) => f.path),
        diffRaw: diff.raw.substring(0, 200),
      });
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    role: "assistant" as const,
                    content: `⚠️ Could not apply the proposed change — the file \`${diff.filePath}\` was not found in the project.\n\nThis usually means I guessed the file path wrong. Please tell me which file to edit (e.g. "edit src/lib.rs") and I'll try again.\n\nAvailable files:\n${flattenFiles(fs.tree).map((f) => `- \`${f.path}\``).join("\n")}`,
                    timestamp: Date.now(),
                  },
                ],
              }
            : t
        )
      );
      // Remove the un-applicable diff from pending
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, pendingDiffs: t.pendingDiffs.filter((d) => d !== diff) }
            : t
        )
      );
      return;
    }

    const newContent = applyDiffToFile(file.content, diff);

    // §9.9 — Single-step undo: use Monaco's pushUndoStop + executeEdits
    // so the entire AI diff is ONE undo step (not dozens of individual edits).
    const monacoEditor = (window as unknown as { __monacoEditor?: { pushUndoStop: () => void; executeEdits: (source: string, edits: unknown[]) => void } }).__monacoEditor;
    if (monacoEditor) {
      monacoEditor.pushUndoStop();
    }

    // Apply the new content to the file system (triggers Monaco model update)
    fs.updateFileContent(diff.filePath, newContent);

    if (monacoEditor) {
      setTimeout(() => monacoEditor.pushUndoStop(), 0);
    }

    // §9.9 — Record AI attribution for the edited lines
    const provider = activeProviderId ? PROVIDERS[activeProviderId as ProviderId] : null;
    const model = activeConfig?.model === "__custom__"
      ? activeConfig?.customModel
      : activeConfig?.model;

    if (provider && model) {
      for (const hunk of diff.hunks) {
        recordEdit(
          diff.filePath,
          hunk.newStart,
          hunk.newStart + hunk.lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length - 1,
          profile
            ? { id: profile.address, name: profile.username, color: useProfileStore.getState().accentColor }
            : { id: "local-user", name: "You", color: "#4F8C8C" },
          { provider: provider.name, model }
        );
      }
    }

    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, pendingDiffs: t.pendingDiffs.filter((d) => d !== diff) }
          : t
      )
    );

    // Auto-build after the AI edit is applied — the user just accepted a fix,
    // so they likely want to see if it compiles now. Small delay to let the
    // file system store + Monaco model settle before building.
    setTimeout(() => {
      useBuildStore.getState().startBuild({ silent: false });
    }, 500);
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
  // hasProvider is computed above (needed for the §9.7 fix-with-AI effect)

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
                  storeRemoveTab(tab.id);
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

      {/* Scope badge + provider/model selector — responsive */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[var(--text-muted)]">Scope:</span>
          <span className="font-medium text-[var(--text-secondary)] capitalize">
            {scope.replace("-", " ")}
          </span>
        </div>
        {/* Provider + model selector — moved here from the input row to free
            up horizontal space in the chat input. Click opens the picker.
            Responsive: truncates on small screens, wraps to new line if needed. */}
        <button
          onClick={() => setShowProviderPicker((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors min-w-0",
            activeProviderId
              ? "text-[var(--accent)] hover:bg-[var(--surface-hover)]"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          )}
          aria-label="Switch provider"
          title="Switch provider / model"
        >
          {hasProvider && activeProviderId ? (
            <>
              <span className="max-w-[80px] sm:max-w-[120px] truncate shrink-0">
                {PROVIDERS[activeProviderId].name}
              </span>
              <span className="text-[var(--text-muted)] shrink-0">·</span>
              <span className="max-w-[100px] sm:max-w-[180px] truncate font-mono text-[10px] min-w-0">
                {activeConfig?.model === "__custom__" ? activeConfig?.customModel : activeConfig?.model}
              </span>
            </>
          ) : (
            <span>Pick provider</span>
          )}
          <ChevronDown size={10} strokeWidth={1.75} className="shrink-0" />
        </button>
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
            data-agent-input
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
            {/* Provider/model selector moved to the header bar above to free
                up horizontal space in the input row. */}
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
  const setProvider = useAIKeysStore((s) => s.setProvider);

  // Track which provider row is expanded to show its model list.
  // Clicking a provider expands it (instead of immediately closing the picker).
  const [expandedProvider, setExpandedProvider] = useState<ProviderId | null>(activeProviderId);

  // Only show CONFIGURED providers in the chat picker.
  const configured = PROVIDER_LIST.filter((p) => {
    const cfg = providers[p.id];
    if (!cfg) return false;
    if (p.id === "ollama") return true;
    return !!cfg.apiKey;
  });

  // Fetch models for the expanded provider (cached in local state)
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");

  async function fetchModels(providerId: ProviderId) {
    const cfg = providers[providerId];
    if (!cfg || (!cfg.apiKey && providerId !== "ollama")) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const provider = PROVIDERS[providerId];
      const list = await provider.listModels(cfg.apiKey, cfg.baseUrl);
      setModels(list);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  }

  // When the expanded provider changes, fetch its models
  useEffect(() => {
    if (expandedProvider) {
      setModels([]);
      setModelSearch("");
      fetchModels(expandedProvider);
    }
  }, [expandedProvider]);

  const filteredModels = modelSearch.trim()
    ? models.filter((m) => m.toLowerCase().includes(modelSearch.trim().toLowerCase()))
    : models;

  function handleSelectProvider(providerId: ProviderId) {
    setActiveProvider(providerId);
    // Don't close the picker — let the user pick a model.
    // They can close manually via the X button or by clicking elsewhere.
    setExpandedProvider(providerId);
  }

  function handleSelectModel(providerId: ProviderId, model: string) {
    setProvider(providerId, { model });
    setActiveProvider(providerId);
    onClose();
  }

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 space-y-2 max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between sticky top-0 bg-[var(--surface-raised)] -mx-3 px-3 py-1 z-10">
        <span className="text-xs font-medium text-[var(--text-secondary)]">Switch provider</span>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </div>
      {configured.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] px-1">
            Configured
          </div>
          {configured.map((p) => {
            const isExpanded = expandedProvider === p.id;
            const isActive = activeProviderId === p.id;
            const cfg = providers[p.id];
            return (
              <div key={p.id} className="space-y-1">
                <button
                  onClick={() => handleSelectProvider(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                    isActive
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {isActive && <Check size={10} strokeWidth={2} />}
                    {p.name}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-[10px] text-[var(--text-muted)] max-w-[140px] truncate">
                      {cfg?.model === "__custom__" ? cfg?.customModel : cfg?.model}
                    </span>
                    <ChevronDown
                      size={10}
                      strokeWidth={1.75}
                      className={cn("transition-transform", isExpanded && "rotate-180")}
                    />
                  </span>
                </button>

                {/* Expanded: show model picker for this provider */}
                {isExpanded && (
                  <div className="ml-3 rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-2 space-y-2">
                    {/* Search box */}
                    <div className="flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-1.5 py-1">
                      <Search size={10} strokeWidth={2} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models…"
                        autoFocus
                        className="flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                      />
                      {modelSearch && (
                        <button onClick={() => setModelSearch("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          <X size={10} strokeWidth={2} />
                        </button>
                      )}
                      <button
                        onClick={() => fetchModels(p.id)}
                        disabled={loadingModels}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
                        title="Refresh models"
                      >
                        {loadingModels ? <Loader2 size={10} strokeWidth={2} className="animate-spin" /> : <RefreshCw size={10} strokeWidth={2} />}
                      </button>
                    </div>

                    {/* Model list */}
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {loadingModels && (
                        <div className="flex items-center justify-center py-2 text-[10px] text-[var(--text-muted)]">
                          <Loader2 size={10} strokeWidth={2} className="animate-spin mr-1.5" />
                          Loading models…
                        </div>
                      )}
                      {!loadingModels && modelError && (
                        <div className="px-2 py-1 text-[10px] text-[var(--status-error)]">{modelError}</div>
                      )}
                      {!loadingModels && !modelError && filteredModels.length === 0 && (
                        <div className="px-2 py-2 text-center text-[10px] text-[var(--text-muted)]">
                          {models.length === 0 ? "No models fetched" : "No matches"}
                        </div>
                      )}
                      {!loadingModels && filteredModels.map((m) => (
                        <button
                          key={m}
                          onClick={() => handleSelectModel(p.id, m)}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] font-mono transition-colors",
                            cfg?.model === m
                              ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                              : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                          )}
                        >
                          <span className="truncate">{m}</span>
                          {cfg?.model === m && <Check size={9} strokeWidth={2} className="shrink-0 ml-1" />}
                        </button>
                      ))}
                    </div>

                    {/* Custom model option */}
                    <button
                      onClick={() => {
                        setProvider(p.id, { model: "__custom__" });
                        setActiveProvider(p.id);
                        onClose();
                      }}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors",
                        cfg?.model === "__custom__"
                          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                      )}
                    >
                      <Plus size={10} strokeWidth={2} />
                      Custom model name…
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // No providers configured — prompt user to add one in Settings
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--text-muted)]">
            No AI providers configured yet.
          </p>
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border-subtle)] py-1.5 text-[11px] text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
          >
            <Plus size={11} strokeWidth={2} />
            Add a provider in Settings
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Apply a parsed diff to file content.
 * Handles unified diff hunks with +/- line markers.
 */
function applyDiffToFile(content: string, diff: ParsedDiff): string {
  const lines = content.split("\n");
  // Process hunks in reverse order so line numbers don't shift
  const sortedHunks = [...diff.hunks].sort((a, b) => b.newStart - a.newStart);

  for (const hunk of sortedHunks) {
    let insertIdx = hunk.newStart - 1; // 0-indexed
    // Find the position in the current lines array
    // Remove old lines (starting at oldStart) and insert new ones
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(" ")) {
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      }
    }

    // Find the old lines in the array and replace with new lines
    const oldStartIdx = lines.indexOf(oldLines[0], Math.max(0, insertIdx - oldLines.length - 5));
    if (oldStartIdx >= 0) {
      lines.splice(oldStartIdx, oldLines.length, ...newLines);
    } else {
      // Fallback: just insert at the hunk position
      lines.splice(insertIdx, 0, ...newLines);
    }
  }

  return lines.join("\n");
}
