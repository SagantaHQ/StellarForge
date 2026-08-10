"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, AlertCircle, Lock } from "lucide-react";
import {
  useCommentsStore,
  COMMENT_PRIORITY_COLORS,
  COMMENT_PRIORITY_LABELS,
  type CommentPriority,
} from "@/stores/comments-store";
import { useProfileStore } from "@/stores/profile-store";
import { cn } from "@/lib/utils";

const PRIORITIES: CommentPriority[] = ["urgent", "high", "normal", "low", "suggestion"];

interface InlineCommentInputProps {
  filePath: string;
  lineNumber: number;
  lineSnapshot: string;
  onSubmit: () => void;
  onCancel: () => void;
}

export function InlineCommentInput({
  filePath,
  lineNumber,
  lineSnapshot,
  onSubmit,
  onCancel,
}: InlineCommentInputProps) {
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<CommentPriority>("normal");
  const [authorName] = useState("You");
  const [authorAvatarColor] = useState("#4F8C8C");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addComment = useCommentsStore((s) => s.addComment);
  const isLoggedIn = useProfileStore((s) => s.isLoggedIn());

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit() {
    if (!body.trim()) return;
    if (!isLoggedIn) return; // only logged-in users can comment
    addComment({
      filePath,
      lineNumber,
      lineSnapshot,
      body: body.trim(),
      priority,
      authorName,
      authorAvatarColor,
    });
    onSubmit();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      className="absolute left-0 right-0 z-20 border-l-2 bg-[var(--surface-panel)] px-4 py-2.5 shadow-md"
      style={{ borderLeftColor: COMMENT_PRIORITY_COLORS[priority] }}
    >
      {/* Header — anchored line context */}
      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>
          Line {lineNumber} ·{" "}
          <code className="font-mono text-[var(--text-secondary)]">
            {lineSnapshot.substring(0, 60)}
            {lineSnapshot.length > 60 ? "…" : ""}
          </code>
        </span>
        <button
          onClick={onCancel}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          aria-label="Cancel comment"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </div>

      {/* Priority picker */}
      <div className="mb-2 flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mr-1">
          Priority
        </span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            onClick={() => setPriority(p)}
            className={cn(
              "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] transition-colors",
              priority === p
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
            )}
            title={COMMENT_PRIORITY_LABELS[p]}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: COMMENT_PRIORITY_COLORS[p] }}
            />
            <span>{COMMENT_PRIORITY_LABELS[p]}</span>
          </button>
        ))}
      </div>

      {/* Body input */}
      {!isLoggedIn ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-3 text-center">
          <Lock size={14} strokeWidth={1.75} className="mx-auto mb-1.5 text-[var(--text-muted)]" />
          <p className="text-[11px] text-[var(--text-muted)]">
            Connect your wallet to add comments
          </p>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a comment… (⌘+Enter to post, Esc to cancel)"
          rows={2}
          className="w-full resize-none rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)]">
          {isLoggedIn ? (
            <>Posting as <span style={{ color: authorAvatarColor }}>{authorName}</span></>
          ) : (
            <span className="text-[var(--status-warning)]">Login required</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!body.trim() || !isLoggedIn}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
              body.trim() && isLoggedIn
                ? "bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                : "bg-[var(--surface-sunken)] text-[var(--text-muted)] cursor-not-allowed"
            )}
          >
            <Send size={11} strokeWidth={1.75} />
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
