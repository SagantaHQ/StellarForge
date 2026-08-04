"use client";

import { useEffect } from "react";
import { X, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import { useFileSystemStore } from "@/stores/file-system-store";
import { findFile } from "@/lib/soroban/sample-project";
import { FileCode2, FileJson, FileText, Hash, FileType, type LucideIcon } from "lucide-react";

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
  const editorFontSize = useFileSystemStore.length; // placeholder to satisfy lints

  const activeFile = activeTabPath ? findFile(tree, activeTabPath) : null;

  // Sync file system active path with editor tab
  useEffect(() => {
    if (activeTabPath) {
      useFileSystemStore.getState().setActiveFile(activeTabPath);
    }
  }, [activeTabPath]);

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
              style={
                isActive
                  ? { borderTop: "1px solid var(--accent)" }
                  : undefined
              }
            >
              <Icon size={13} strokeWidth={1.75} style={{ color }} />
              <span className={cn(tab.dirty && "italic")}>{tab.name}</span>
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
      </div>

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        {activeFile ? (
          <MonacoEditor
            path={activeFile.path}
            language={activeFile.language}
            value={activeFile.content}
            fontSize={fontSize}
            onChange={(value) => {
              updateFileContent(activeFile.path, value);
              markDirty(activeFile.path, true);
            }}
          />
        ) : (
          <EmptyEditorState />
        )}
      </div>
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
