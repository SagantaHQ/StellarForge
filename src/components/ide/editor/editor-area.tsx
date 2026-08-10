"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Circle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useCommentsStore, COMMENT_PRIORITY_COLORS } from "@/stores/comments-store";
import { useAttributionStore } from "@/stores/attribution-store";
import { useProfileStore } from "@/stores/profile-store";
import { findFile } from "@/lib/soroban/sample-project";
import {
  FileCode2,
  FileJson,
  FileText,
  Hash,
  FileType,
  type LucideIcon,
} from "lucide-react";
import { InlineCommentInput } from "../comments/inline-comment-input";
import { CommentsPanel } from "../comments/comments-panel";
import type * as Monaco from "monaco-editor";

const MonacoEditor = dynamic(
  () => import("./monaco-editor").then((m) => m.MonacoEditor),
  { ssr: false }
);

function getFileIcon(name: string): { icon: LucideIcon; color: string } {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
      return { icon: FileCode2, color: "var(--status-error)" };
    case "ts":
    case "tsx":
      return { icon: FileCode2, color: "var(--status-info)" };
    case "js":
    case "jsx":
      return { icon: FileCode2, color: "var(--status-warning)" };
    case "json":
      return { icon: FileJson, color: "var(--status-warning)" };
    case "toml":
      return { icon: Hash, color: "var(--priority-normal)" };
    case "md":
      return { icon: FileText, color: "var(--text-secondary)" };
    default:
      return { icon: FileType, color: "var(--text-muted)" };
  }
}

interface EditorAreaProps {
  fontSize?: number;
}

export function EditorArea({ fontSize = 13 }: EditorAreaProps) {
  const tabs = useEditorTabsStore((s) => s.tabs);
  const activeTabPath = useEditorTabsStore((s) => s.activeTabPath);
  const setActiveTab = useEditorTabsStore((s) => s.setActiveTab);
  const closeTab = useEditorTabsStore((s) => s.closeTab);
  const markDirty = useEditorTabsStore((s) => s.markDirty);
  const tree = useFileSystemStore((s) => s.tree);
  const updateFileContent = useFileSystemStore((s) => s.updateFileContent);

  // Attribution integration (§5.2)
  const recordEdit = useAttributionStore((s) => s.recordEdit);
  const profile = useProfileStore((s) => s.profile);
  const isLoggedIn = useProfileStore((s) => s.isLoggedIn());

  // Comments integration
  const comments = useCommentsStore((s) => s.comments);
  const activeFilePath = useCommentsStore((s) => s.activeFilePath);
  const setActiveFile = useCommentsStore((s) => s.setActiveFile);
  const addingAt = useCommentsStore((s) => s.addingAt);
  const startAdding = useCommentsStore((s) => s.startAdding);
  const cancelAdding = useCommentsStore((s) => s.cancelAdding);
  const focusedCommentId = useCommentsStore((s) => s.focusedCommentId);
  const focusComment = useCommentsStore((s) => s.focusComment);
  const getHighestPriorityForLine = useCommentsStore((s) => s.getHighestPriorityForLine);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [showCommentsPanel, setShowCommentsPanel] = useState(true);

  const activeFile = activeTabPath ? findFile(tree, activeTabPath) : null;

  // Sync file system active path with editor tab + comments active file
  useEffect(() => {
    if (activeTabPath) {
      useFileSystemStore.getState().setActiveFile(activeTabPath);
      setActiveFile(activeTabPath);
    }
  }, [activeTabPath, setActiveFile]);

  // Build glyph decorations for the active file — show a colored dot per line with comments
  const glyphDecorations = useMemo(() => {
    if (!activeTabPath) return [];
    const fileComments = comments.filter(
      (c) => c.filePath === activeTabPath && c.status === "open"
    );
    // Group by line — show highest priority per line
    const byLine = new Map<number, ReturnType<typeof getHighestPriorityForLine>>();
    for (const c of fileComments) {
      if (byLine.has(c.lineNumber)) continue;
      byLine.set(c.lineNumber, getHighestPriorityForLine(activeTabPath, c.lineNumber));
    }
    return Array.from(byLine.entries()).map(([line, priority]) => ({
      lineNumber: line,
      color: priority ? COMMENT_PRIORITY_COLORS[priority] : "var(--accent)",
      tooltip: priority ? `${priority} priority comment` : "Comment",
    }));
  }, [comments, activeTabPath, getHighestPriorityForLine]);

  // Compute highlighted line for focused comment
  const highlightedLines = useMemo(() => {
    if (!focusedCommentId || !activeTabPath) return [];
    const fc = comments.find((c) => c.id === focusedCommentId && c.filePath === activeTabPath);
    return fc ? [fc.lineNumber] : [];
  }, [focusedCommentId, comments, activeTabPath]);

  function handleAddComment(lineNumber: number, lineContent: string) {
    if (!activeTabPath) return;
    startAdding(activeTabPath, lineNumber);
  }

  function handleGlyphClick(lineNumber: number) {
    if (!activeTabPath) return;
    const lineComments = comments.filter(
      (c) => c.filePath === activeTabPath && c.lineNumber === lineNumber && c.status === "open"
    );
    if (lineComments.length > 0) {
      focusComment(lineComments[0].id);
      // Also scroll editor to that line
      editorRef.current?.revealLineInCenter(lineNumber);
    }
  }

  function handleScrollToLine(line: number) {
    editorRef.current?.revealLineInCenter(line);
    editorRef.current?.setPosition({ lineNumber: line, column: 1 });
  }

  // Auto-scroll to focused comment line
  useEffect(() => {
    if (focusedCommentId && activeTabPath) {
      const fc = comments.find((c) => c.id === focusedCommentId);
      if (fc) {
        editorRef.current?.revealLineInCenter(fc.lineNumber);
      }
    }
  }, [focusedCommentId, comments, activeTabPath]);

  // Re-anchor comments when file content changes (basic implementation)
  useEffect(() => {
    if (!activeFile) return;
    const lines = activeFile.content.split("\n");
    useCommentsStore.getState().reanchorComments(activeFile.path, lines);
  }, [activeFile?.content, activeFile?.path]);

  return (
    <div className="flex h-full flex-col bg-[var(--surface-app)]">
      {/* Tab bar */}
      <div className="flex h-9 items-stretch border-b border-[var(--border-subtle)] bg-[var(--surface-panel)] overflow-x-auto">
        {tabs.length === 0 && (
          <div className="flex items-center px-4 text-xs text-[var(--text-muted)]">
            No file open
          </div>
        )}
        {tabs.map((tab) => {
          const { icon: Icon, color } = getFileIcon(tab.name);
          const isActive = activeTabPath === tab.path;
          const tabCommentCount = comments.filter(
            (c) => c.filePath === tab.path && c.status === "open"
          ).length;
          return (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={cn(
                "group relative flex cursor-pointer items-center gap-2 border-r border-[var(--border-subtle)] px-3 text-[13px] transition-colors",
                isActive
                  ? "bg-[var(--surface-app)] text-[var(--text-primary)]"
                  : "bg-[var(--surface-panel)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              )}
            >
              <Icon size={13} strokeWidth={1.75} style={{ color }} />
              <span className={cn(tab.dirty && "italic")}>{tab.name}</span>
              {tabCommentCount > 0 && (
                <span className="flex items-center gap-0.5 rounded-full bg-[var(--accent-subtle)] px-1.5 text-[10px] font-medium text-[var(--accent)]">
                  <MessageSquare size={8} strokeWidth={2} />
                  {tabCommentCount}
                </span>
              )}
              {tab.dirty ? (
                <Circle
                  size={8}
                  fill="currentColor"
                  className="text-[var(--text-secondary)] group-hover:hidden"
                />
              ) : null}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.path);
                }}
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded hover:bg-[var(--surface-active)]",
                  tab.dirty ? "hidden group-hover:flex" : "opacity-0 group-hover:opacity-100"
                )}
                aria-label={`Close ${tab.name}`}
              >
                <X size={12} strokeWidth={1.75} />
              </button>
              {isActive && (
                <span
                  className="absolute -bottom-px left-0 right-0 h-[1px] bg-[var(--accent)]"
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}

        {/* Right-side: toggle comments panel */}
        {activeFile && (
          <div className="ml-auto flex items-center pr-2">
            <button
              onClick={() => setShowCommentsPanel((v) => !v)}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                showCommentsPanel
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              )}
              title="Toggle comments panel"
            >
              <MessageSquare size={12} strokeWidth={1.75} />
              <span className="hidden lg:inline">Comments</span>
            </button>
          </div>
        )}
      </div>

      {/* Editor + floating comments panel + inline input */}
      <div className="relative flex-1 overflow-hidden" ref={editorContainerRef}>
        {activeFile ? (
          <>
            <MonacoEditor
              path={activeFile.path}
              language={activeFile.language}
              value={activeFile.content}
              fontSize={fontSize}
              glyphMargin
              readOnly={!isLoggedIn}
              highlightedLines={highlightedLines}
              glyphDecorations={glyphDecorations}
              onAddComment={handleAddComment}
              onGlyphClick={handleGlyphClick}
              onMount={(editor) => {
                editorRef.current = editor;
                // §9.9 — Expose editor instance for AI diff single-step undo
                (window as unknown as { __monacoEditor?: unknown }).__monacoEditor = editor;
              }}
              onChange={(value) => {
                updateFileContent(activeFile.path, value);
                markDirty(activeFile.path, true);
                // §5.2 — Record attribution for edited lines
                // Track the cursor position as the edited line
                const editor = editorRef.current;
                if (editor) {
                  const pos = editor.getPosition();
                  if (pos) {
                    recordEdit(
                      activeFile.path,
                      pos.lineNumber,
                      pos.lineNumber,
                      profile
                        ? { id: profile.address, name: profile.username, color: useProfileStore.getState().accentColor }
                        : { id: "local-user", name: "You", color: "#4F8C8C" }
                    );
                  }
                }
              }}
            />

            {/* Floating comments panel (§6.3 — draggable, collapsible) */}
            {showCommentsPanel && (
              <CommentsPanel
                editorContainerRef={editorContainerRef}
                filePath={activeFile.path}
                onScrollToLine={handleScrollToLine}
              />
            )}

            {/* Inline comment input — appears under the line being commented on */}
            {addingAt && addingAt.filePath === activeFile.path && (
              <InlineCommentInputLayer
                lineNumber={addingAt.lineNumber}
                editorRef={editorRef}
                onDone={() => cancelAdding()}
              />
            )}
          </>
        ) : (
          <EmptyEditorState />
        )}
      </div>
    </div>
  );
}

/**
 * Renders the InlineCommentInput positioned below the given line number.
 * Uses the editor's API to compute the screen position of the line.
 */
function InlineCommentInputLayer({
  lineNumber,
  editorRef,
  onDone,
}: {
  lineNumber: number;
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  onDone: () => void;
}) {
  const [top, setTop] = useState<number | null>(null);
  const [lineContent, setLineContent] = useState<string>("");
  const activeFilePath = useCommentsStore((s) => s.activeFilePath);
  const cancelAdding = useCommentsStore((s) => s.cancelAdding);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    function updatePosition() {
      const ed = editorRef.current;
      if (!ed) return;
      const editorTop = ed.getTopForLineNumber(lineNumber);
      const scrollTop = ed.getScrollTop();
      const relativeTop = editorTop - scrollTop;
      setTop(relativeTop);
      const model = ed.getModel();
      if (model) {
        setLineContent(model.getLineContent(lineNumber));
      }
    }
    updatePosition();
    const disposable = editor.onDidScrollChange(updatePosition);
    return () => disposable.dispose();
  }, [editorRef, lineNumber]);

  if (top === null || !activeFilePath) return null;

  return (
    <div className="absolute left-0 right-0 z-20" style={{ top: top + 19 }}>
      <InlineCommentInput
        filePath={activeFilePath}
        lineNumber={lineNumber}
        lineSnapshot={lineContent}
        onSubmit={onDone}
        onCancel={cancelAdding}
      />
    </div>
  );
}

function EmptyEditorState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-raised)]">
        <svg viewBox="0 0 256 256" className="h-10 w-10 opacity-60">
          <path
            d="M 168 80 Q 168 56 128 56 Q 88 56 88 88 Q 88 120 128 128 Q 168 136 168 168 Q 168 200 128 200 Q 88 200 88 176"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          Soroban.Build
        </h3>
        <p className="text-xs text-[var(--text-muted)] max-w-sm">
          Select a file from the explorer to start editing, or press{" "}
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono">
            ⌘K
          </kbd>{" "}
          to open the command palette.
        </p>
      </div>
    </div>
  );
}
