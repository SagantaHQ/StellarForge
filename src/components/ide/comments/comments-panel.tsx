"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  X,
  Trash2,
  Check,
  RotateCcw,
  GripVertical,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Pin,
} from "lucide-react";
import {
  useCommentsStore,
  COMMENT_PRIORITY_COLORS,
  COMMENT_PRIORITY_LABELS,
  type Comment,
  type CommentPriority,
} from "@/stores/comments-store";
import { useProfileStore } from "@/stores/profile-store";
import { cn } from "@/lib/utils";

const PRIORITIES: CommentPriority[] = ["urgent", "high", "normal", "low", "suggestion"];

interface CommentsPanelProps {
  /** Reference to the editor container for clamping the panel position */
  editorContainerRef: React.RefObject<HTMLDivElement>;
  /** Active file path — determines which comments are shown */
  filePath: string;
  /** Callback to scroll the editor to a specific line */
  onScrollToLine: (line: number) => void;
}

export function CommentsPanel({
  editorContainerRef,
  filePath,
  onScrollToLine,
}: CommentsPanelProps) {
  const comments = useCommentsStore((s) => s.comments);
  const panelPositions = useCommentsStore((s) => s.panelPositions);
  const panelCollapsed = useCommentsStore((s) => s.panelCollapsed);
  const setPanelPosition = useCommentsStore((s) => s.setPanelPosition);
  const setPanelCollapsed = useCommentsStore((s) => s.setPanelCollapsed);
  const resolveComment = useCommentsStore((s) => s.resolveComment);
  const unresolveComment = useCommentsStore((s) => s.unresolveComment);
  const deleteComment = useCommentsStore((s) => s.deleteComment);
  const profile = useProfileStore((s) => s.profile);
  const focusComment = useCommentsStore((s) => s.focusComment);
  const focusedCommentId = useCommentsStore((s) => s.focusedCommentId);

  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const fileComments = comments
    .filter((c) => c.filePath === filePath && c.status !== "deleted")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return a.lineNumber - b.lineNumber;
    });

  const openComments = fileComments.filter((c) => c.status === "open");
  const resolvedComments = fileComments.filter((c) => c.status === "resolved");

  const collapsed = panelCollapsed[filePath] ?? true; // collapsed by default
  const savedPos = panelPositions[filePath];
  // Default position: top-right of editor area
  const position = savedPos ?? { x: -1, y: -1 };

  function startDrag(e: React.MouseEvent) {
    if (!panelRef.current || !editorContainerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const panelRect = panelRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - panelRect.left,
      y: e.clientY - panelRect.top,
    };
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;

    function handleMove(e: MouseEvent) {
      if (!panelRef.current || !editorContainerRef.current) return;
      const containerRect = editorContainerRef.current.getBoundingClientRect();
      const newX = e.clientX - containerRect.left - dragOffset.current.x;
      const newY = e.clientY - containerRect.top - dragOffset.current.y;
      // Clamp to viewport (editor container)
      const panelW = panelRef.current.offsetWidth;
      const panelH = panelRef.current.offsetHeight;
      const clampedX = Math.max(8, Math.min(containerRect.width - panelW - 8, newX));
      const clampedY = Math.max(8, Math.min(containerRect.height - panelH - 8, newY));
      setPanelPosition(filePath, { x: clampedX, y: clampedY });
    }
    function handleUp() {
      setDragging(false);
    }
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, filePath, setPanelPosition, editorContainerRef]);

  function handleClickComment(c: Comment) {
    focusComment(c.id);
    onScrollToLine(c.lineNumber);
  }

  // Collapsed state — show a compact pill with count
  if (collapsed) {
    return (
      <div
        ref={panelRef}
        className="absolute z-30 flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-1.5 shadow-md"
        style={{
          top: position.y === -1 ? 12 : position.y,
          right: position.x === -1 ? 12 : undefined,
          left: position.x === -1 ? undefined : position.x,
        }}
      >
        <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {openComments.length}
        </span>
        <MessageSquare size={12} strokeWidth={1.75} className="text-[var(--text-muted)]" />
        <button
          onClick={() => setPanelCollapsed(filePath, false)}
          className="ml-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Expand comments panel"
        >
          <ChevronDown size={12} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  // Expanded state — full panel
  const style: React.CSSProperties =
    position.x === -1
      ? { top: 12, right: 12 }
      : { top: position.y, left: position.x };

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute z-30 flex max-h-[70%] w-80 flex-col overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] shadow-xl",
        dragging && "cursor-grabbing select-none"
      )}
      style={style}
    >
      {/* Header — draggable */}
      <div
        onMouseDown={startDrag}
        className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical size={12} strokeWidth={1.75} className="text-[var(--text-muted)] shrink-0" />
          <MessageSquare size={13} strokeWidth={1.75} className="text-[var(--text-secondary)] shrink-0" />
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            Comments
          </span>
          <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">
            {openComments.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPanelCollapsed(filePath, true)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Collapse panel"
            title="Collapse"
          >
            <ChevronRight size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* File path context */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5">
        <span className="text-[10px] font-mono text-[var(--text-muted)] truncate block">
          {filePath}
        </span>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto">
        {fileComments.length === 0 && (
          <div className="px-3 py-6 text-center">
            <MessageSquare size={20} strokeWidth={1.5} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">
              No comments yet.
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Right-click a line in the editor → <span className="text-[var(--text-secondary)]">Add Comment</span>
            </p>
          </div>
        )}

        {/* Open comments */}
        {openComments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            isFocused={focusedCommentId === c.id}
            onClick={() => handleClickComment(c)}
            onResolve={() => resolveComment(c.id, "You")}
            onDelete={() => deleteComment(c.id, profile?.address ?? "local-user")}
            canDelete={c.authorId === (profile?.address ?? "local-user")}
          />
        ))}

        {/* Resolved comments — grouped at bottom */}
        {resolvedComments.length > 0 && (
          <ResolvedSection
            comments={resolvedComments}
            focusedCommentId={focusedCommentId}
            onClickComment={handleClickComment}
            onUnresolve={(id) => unresolveComment(id)}
          />
        )}
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  isFocused,
  onClick,
  onResolve,
  onDelete,
  canDelete,
}: {
  comment: Comment;
  isFocused: boolean;
  onClick: () => void;
  onResolve: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  // Avoid hydration mismatch: Date.now() differs between server and client.
  // Only compute relative time after hydration (client-only).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <div
      onClick={onClick}
      className={cn(
        "border-b border-[var(--border-subtle)] px-3 py-2 transition-colors cursor-pointer",
        isFocused ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--surface-hover)]"
      )}
      style={{
        borderLeft: `2px solid ${COMMENT_PRIORITY_COLORS[comment.priority]}`,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-medium text-white shrink-0"
            style={{ backgroundColor: comment.authorAvatarColor }}
          >
            {comment.authorName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            {comment.authorName}
          </span>
          <span
            className="rounded px-1 py-0 text-[9px] font-medium shrink-0"
            style={{
              color: COMMENT_PRIORITY_COLORS[comment.priority],
              backgroundColor: `color-mix(in srgb, ${COMMENT_PRIORITY_COLORS[comment.priority]} 14%, transparent)`,
            }}
          >
            {COMMENT_PRIORITY_LABELS[comment.priority]}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-active)] hover:text-[var(--status-success)]"
            aria-label="Resolve comment"
            title="Resolve"
          >
            <Check size={11} strokeWidth={2} />
          </button>
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-active)] hover:text-[var(--status-error)]"
              aria-label="Delete comment"
              title="Delete (only author can delete)"
            >
              <Trash2 size={11} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Line anchor + orphan warning */}
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
        <Pin size={9} strokeWidth={1.75} />
        <span>Line {comment.lineNumber}</span>
        {comment.isOrphaned && (
          <span className="flex items-center gap-0.5 text-[var(--status-warning)]">
            <AlertTriangle size={9} strokeWidth={1.75} />
            <span>Orphaned</span>
          </span>
        )}
        <span>· {mounted ? formatRelative(comment.createdAt) : "—"}</span>
      </div>

      {/* Body */}
      <p className="text-[12px] leading-relaxed text-[var(--text-secondary)] break-words">
        {comment.body}
      </p>

      {/* Snapshot preview */}
      {expanded && (
        <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--surface-sunken)] px-1.5 py-1 text-[10px] font-mono text-[var(--text-muted)]">
          {comment.lineSnapshot.substring(0, 80)}
          {comment.lineSnapshot.length > 80 ? "…" : ""}
        </pre>
      )}
    </div>
  );
}

function ResolvedSection({
  comments,
  focusedCommentId,
  onClickComment,
  onUnresolve,
}: {
  comments: Comment[];
  focusedCommentId: string | null;
  onClickComment: (c: Comment) => void;
  onUnresolve: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Avoid hydration mismatch for formatRelative
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <div className="border-t-2 border-[var(--border-subtle)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        {expanded ? <ChevronDown size={11} strokeWidth={1.75} /> : <ChevronRight size={11} strokeWidth={1.75} />}
        <span>Resolved ({comments.length})</span>
      </button>
      {expanded && (
        <div>
          {comments.map((c) => (
            <div
              key={c.id}
              onClick={() => onClickComment(c)}
              className={cn(
                "px-3 py-1.5 cursor-pointer hover:bg-[var(--surface-hover)] transition-colors",
                focusedCommentId === c.id && "bg-[var(--accent-subtle)]"
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-[var(--text-muted)] line-clamp-1">
                    <s className="text-[var(--text-muted)]">{c.body.substring(0, 60)}{c.body.length > 60 ? "…" : ""}</s>
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnresolve(c.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label="Reopen comment"
                  title="Reopen"
                >
                  <RotateCcw size={9} strokeWidth={1.75} />
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                Resolved by {c.resolvedByName ?? "unknown"} · {mounted && c.resolvedAt ? formatRelative(c.resolvedAt) : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
