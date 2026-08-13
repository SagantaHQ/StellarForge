"use client";

import { useEffect, useRef, useState } from "react";
import { Wrench, Check, X, Loader2, FileCode2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildStore } from "@/stores/build-store";
import { useFixWithAIStore } from "@/stores/fix-with-ai-store";

/**
 * Build output panel — replaces the terminal panel.
 *
 * Shows real-time output from `stellar contract build`:
 *   - Build status (idle / building / success / failed)
 *   - Streaming stdout/stderr lines
 *   - WASM file info on success (path, size)
 *   - Function list parsed from the contract source after successful build
 *
 * The build is triggered from the TopBar Build button.
 */

interface BuildOutputPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function BuildOutputPanel({ collapsed, onToggleCollapse }: BuildOutputPanelProps) {
  const status = useBuildStore((s) => s.status);
  const lines = useBuildStore((s) => s.lines);
  const wasmInfo = useBuildStore((s) => s.wasmInfo);
  const error = useBuildStore((s) => s.error);
  const outputRef = useRef<HTMLDivElement>(null);
  const requestFix = useFixWithAIStore((s) => s.requestFix);

  // Track whether "Fix with AI" has been clicked for the current build error.
  // Once clicked, hide the button until a new build starts (status === "building"
  // resets this). This prevents the user from clicking it multiple times + keeps
  // the UI clean after the fix request is sent.
  const [fixRequested, setFixRequested] = useState(false);

  // Reset fixRequested when a new build starts
  useEffect(() => {
    if (status === "building") {
      setFixRequested(false);
    }
  }, [status]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (collapsed) {
    return (
      <div className="flex h-9 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Wrench size={13} strokeWidth={1.75} />
          <span>Build Output</span>
          {status === "building" && <Loader2 size={10} className="animate-spin text-[var(--accent)]" />}
          {status === "success" && <Check size={10} className="text-[var(--status-success)]" />}
          {status === "failed" && <X size={10} className="text-[var(--status-error)]" />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-t border-[var(--border-subtle)] bg-[var(--surface-panel)]">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <div className="flex items-center gap-2">
          <Wrench size={13} strokeWidth={1.75} className="text-[var(--text-muted)]" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Build Output
          </span>
          {status === "building" && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--accent)]">
              <Loader2 size={9} className="animate-spin" />
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
        <button
          onClick={onToggleCollapse}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Collapse"
        >
          <ChevronDown size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Output lines */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
        style={{ background: "var(--mono-bg)", color: "var(--mono-fg)" }}
      >
        {status === "idle" && lines.length === 0 && (
          <div className="text-[var(--text-muted)] italic">
            No build yet. Click Build to compile with stellar contract build.
          </div>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              line.type === "stderr" && "text-[var(--status-error)]",
              line.type === "stdout" && (line.text.includes("✅") || line.text.includes("Built"))
                ? "text-[var(--status-success)]"
                : line.text.startsWith("warning")
                ? "text-[var(--status-warning)]"
                : "text-[var(--text-secondary)]"
            )}
          >
            {line.text || "\u00A0"}
          </div>
        ))}
        {status === "building" && (
          <span className="animate-pulse text-[var(--accent)]">▋</span>
        )}
      </div>

      {/* WASM info on success */}
      {wasmInfo && status === "success" && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2 bg-[var(--surface-raised)]">
          <div className="flex items-center gap-2 mb-1">
            <FileCode2 size={12} strokeWidth={1.75} className="text-[var(--accent)]" />
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Build Output
            </span>
          </div>
          <div className="font-mono text-[11px] text-[var(--text-secondary)]">
            {wasmInfo.path.split("/").pop()} · {(wasmInfo.sizeBytes / 1024).toFixed(2)} KB
          </div>
        </div>
      )}

      {/* Error + Fix with AI button */}
      {error && status === "failed" && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2 bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] space-y-2">
          <div className="text-[11px] text-[var(--status-error)]">{error}</div>
          {!fixRequested ? (
            <button
              onClick={() => {
                // Collect all stderr lines + the error message as the error context.
                const errorLines = lines
                  .filter((l) => l.type === "stderr" || l.text.startsWith("error") || l.text.startsWith("warning"))
                  .map((l) => l.text)
                  .join("\n");
                const fullError = errorLines || error;
                requestFix(fullError, "stellar contract build");
                // Hide the button — fix request has been sent to the AI agent
                setFixRequested(true);
                // Switch to the agent panel so the user sees the fix request
                const switchEvent = new CustomEvent("soroban-switch-right-panel", { detail: "agent" });
                window.dispatchEvent(switchEvent);
              }}
              className="flex items-center gap-1.5 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              <Sparkles size={11} strokeWidth={1.75} />
              Fix with AI
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2.5 py-1.5 text-[11px] text-[var(--accent)]">
              <Check size={11} strokeWidth={2} />
              Fix sent to AI agent — check the Agent panel for the proposed fix
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { ChevronDown } from "lucide-react";
