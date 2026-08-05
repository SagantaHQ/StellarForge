"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  RefreshCw,
  MoreHorizontal,
  FileText,
  FileCode2,
  FileJson,
  FileType,
  Hash,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileSystemStore } from "@/stores/file-system-store";
import { useEditorTabsStore } from "@/stores/editor-tabs-store";
import type { TreeNode, FileNode } from "@/lib/soroban/sample-project";

interface FileExplorerProps {
  onOpenSettings?: () => void;
}

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

function gitStatusBadge(status: string | null | undefined) {
  if (!status) return null;
  const color =
    status === "modified" ? "var(--status-warning)" :
    status === "added" ? "var(--status-success)" :
    status === "untracked" ? "var(--status-info)" :
    "var(--text-muted)";
  const letter =
    status === "modified" ? "M" :
    status === "added" ? "A" :
    status === "untracked" ? "U" :
    "?";
  return (
    <span
      className="text-[10px] font-mono font-medium"
      style={{ color }}
    >
      {letter}
    </span>
  );
}

export function FileExplorer({ onOpenSettings }: FileExplorerProps) {
  const tree = useFileSystemStore((s) => s.tree);
  const activeFilePath = useFileSystemStore((s) => s.activeFilePath);
  const setActiveFile = useFileSystemStore((s) => s.setActiveFile);
  const toggleFolder = useFileSystemStore((s) => s.toggleFolder);
  const createFile = useFileSystemStore((s) => s.createFile);
  const createFolder = useFileSystemStore((s) => s.createFolder);
  const deleteNode = useFileSystemStore((s) => s.deleteNode);
  const renameNode = useFileSystemStore((s) => s.renameNode);
  const openTab = useEditorTabsStore((s) => s.openTab);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string | null;
    type: "file" | "folder" | "root";
  } | null>(null);

  const [creating, setCreating] = useState<{
    parentPath: string | null;
    type: "file" | "folder";
    name: string;
  } | null>(null);

  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);

  function handleFileClick(file: FileNode) {
    setActiveFile(file.path);
    openTab(file.path, file.name);
  }

  function handleContextMenu(
    e: React.MouseEvent,
    node: TreeNode | null
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: node?.path ?? null,
      type: node?.type ?? "root",
    });
  }

  function handleNewFile(parentPath: string | null) {
    setCreating({ parentPath, type: "file", name: "" });
    setContextMenu(null);
  }

  function handleNewFolder(parentPath: string | null) {
    setCreating({ parentPath, type: "folder", name: "" });
    setContextMenu(null);
  }

  function handleRename(path: string, currentName: string) {
    setRenaming({ path, name: currentName });
    setContextMenu(null);
  }

  function handleDelete(path: string) {
    deleteNode(path);
    setContextMenu(null);
  }

  function submitCreating() {
    if (!creating || !creating.name.trim()) {
      setCreating(null);
      return;
    }
    if (creating.type === "file") {
      createFile(creating.parentPath, creating.name.trim());
    } else {
      createFolder(creating.parentPath, creating.name.trim());
    }
    setCreating(null);
  }

  function submitRenaming() {
    if (!renaming || !renaming.name.trim()) {
      setRenaming(null);
      return;
    }
    renameNode(renaming.path, renaming.name.trim());
    setRenaming(null);
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const indent = depth * 12 + 8;

    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => handleContextMenu(e, node)}
            className="group flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
            style={{ paddingLeft: indent }}
          >
            {node.expanded ? (
              <ChevronDown size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            )}
            <span className="text-[var(--text-secondary)]">
              {node.name}
            </span>
          </button>
          {node.expanded && node.children.length > 0 && (
            <div>
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
          {node.expanded && node.children.length === 0 && (
            <div
              className="py-1 text-[11px] italic text-[var(--text-muted)]"
              style={{ paddingLeft: indent + 20 }}
            >
              Empty folder
            </div>
          )}
        </div>
      );
    }

    // File
    const { icon: Icon, color } = getFileIcon(node.name);
    const isActive = activeFilePath === node.path;
    return (
      <button
        key={node.path}
        onClick={() => handleFileClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
        className={cn(
          "group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] transition-colors",
          isActive
            ? "bg-[var(--accent-subtle)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        )}
        style={{ paddingLeft: indent + 4 }}
      >
        {renaming?.path === node.path ? (
          <input
            autoFocus
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onBlur={submitRenaming}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRenaming();
              if (e.key === "Escape") setRenaming(null);
            }}
            className="flex-1 bg-[var(--surface-sunken)] border border-[var(--accent)] rounded px-1 py-0 text-[13px] text-[var(--text-primary)] outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <Icon size={14} strokeWidth={1.75} style={{ color }} className="shrink-0" />
            <span className="flex-1 truncate">{node.name}</span>
            {gitStatusBadge(node.gitStatus)}
          </>
        )}
      </button>
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface-panel)]"
      onContextMenu={(e) => handleContextMenu(e, null)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleNewFile(null)}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="New file"
            aria-label="New file"
          >
            <FilePlus size={14} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => handleNewFolder(null)}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus size={14} strokeWidth={1.75} />
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </button>
          <button
            onClick={onOpenSettings}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            title="More"
            aria-label="More options"
          >
            <MoreHorizontal size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Project name */}
      <div className="px-3 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          hello-world
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto pb-3">
        {tree.map((node) => renderNode(node, 0))}

        {/* Creating input (root level) */}
        {creating && creating.parentPath === null && (
          <div className="flex items-center gap-1.5 px-3 py-[3px]" style={{ paddingLeft: 12 }}>
            {creating.type === "file" ? (
              <FilePlus size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            ) : (
              <FolderPlus size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            )}
            <input
              autoFocus
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              onBlur={submitCreating}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreating();
                if (e.key === "Escape") setCreating(null);
              }}
              placeholder={creating.type === "file" ? "filename.rs" : "folder-name"}
              className="flex-1 bg-[var(--surface-sunken)] border border-[var(--accent)] rounded px-1.5 py-0 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[180px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === "folder" || contextMenu.type === "root" ? (
              <>
                <MenuItem onClick={() => handleNewFile(contextMenu.path)} icon={FilePlus}>
                  New File
                </MenuItem>
                <MenuItem onClick={() => handleNewFolder(contextMenu.path)} icon={FolderPlus}>
                  New Folder
                </MenuItem>
                {contextMenu.path && (
                  <>
                    <MenuItem onClick={() => handleRename(contextMenu.path, contextMenu.path?.split("/").pop() ?? "")} icon={FileText}>
                      Rename
                    </MenuItem>
                    <MenuItem onClick={() => handleDelete(contextMenu.path)} icon={FileText} danger>
                      Delete
                    </MenuItem>
                  </>
                )}
              </>
            ) : (
              <>
                <MenuItem onClick={() => handleRename(contextMenu.path ?? "", contextMenu.path?.split("/").pop() ?? "")} icon={FileText}>
                  Rename
                </MenuItem>
                <MenuItem onClick={() => handleDelete(contextMenu.path ?? "")} icon={FileText} danger>
                  Delete
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  icon: Icon,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition-colors",
        danger
          ? "text-[var(--status-error)] hover:bg-[var(--surface-hover)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      )}
    >
      <Icon size={13} strokeWidth={1.75} />
      <span>{children}</span>
    </button>
  );
}
