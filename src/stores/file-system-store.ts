"use client";

import { create } from "zustand";
import { findFile, type TreeNode, type FileNode } from "@/lib/soroban/sample-project";
import { fileGetAll, fileSet, fileDelete, fileClearAll, metaGet, metaSet } from "@/lib/storage/idb";

/**
 * §8 — Local-first file system store.
 *
 * Files are stored in IndexedDB (not localStorage) for:
 *   - Much larger storage limit (50MB+ vs 5MB)
 *   - Structured async storage (doesn't block main thread)
 *   - Survives browser restarts, works offline
 *
 * On mount: loads files from IndexedDB. If empty, seeds from the sample
 * project. On every mutation: persists to IndexedDB (async, fire-and-forget).
 *
 * Sync strategy (§8): when online, changes sync to Postgres. When offline,
 * changes accumulate locally and merge on reconnect. (Sync layer TBD.)
 */

interface FileSystemState {
  tree: TreeNode[];
  activeFilePath: string | null;
  /** Whether the initial load from IndexedDB has completed */
  hydrated: boolean;

  setActiveFile: (path: string) => void;
  getActiveFile: () => FileNode | null;
  updateFileContent: (path: string, content: string) => void;
  createFile: (parentPath: string | null, name: string) => void;
  createFolder: (parentPath: string | null, name: string) => void;
  deleteNode: (path: string) => void;
  renameNode: (path: string, newName: string) => void;
  toggleFolder: (path: string) => void;
  /** Load files from IndexedDB — called once on mount */
  hydrate: () => Promise<void>;
  /** Replace the entire file tree (used by template scaffolding) */
  replaceTree: (files: { path: string; content: string; language: string }[]) => Promise<void>;
}

function deepClone(tree: TreeNode[]): TreeNode[] {
  return tree.map((node) =>
    node.type === "folder"
      ? { ...node, children: deepClone(node.children) }
      : { ...node }
  );
}

function detectLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "toml": return "toml";
    case "md": return "markdown";
    case "json": return "json";
    default: return "plaintext";
  }
}

function updateInTree(
  tree: TreeNode[],
  fn: (node: TreeNode) => TreeNode | null
): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of tree) {
    const updated = fn(node);
    if (updated === null) continue;
    if (updated.type === "folder") {
      result.push({ ...updated, children: updateInTree(updated.children, fn) });
    } else {
      result.push(updated);
    }
  }
  return result;
}

function findFolder(tree: TreeNode[], path: string | null): TreeNode[] | null {
  if (path === null) return tree;
  function search(nodes: TreeNode[]): TreeNode[] | null {
    for (const node of nodes) {
      if (node.type === "folder") {
        if (node.path === path) return node.children;
        const found = search(node.children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(tree);
}

/** Persist a single file to IndexedDB (fire-and-forget). */
function persistFile(file: FileNode) {
  fileSet(file.path, file.content, file.language, file.gitStatus).catch(() => {});
}

/** Persist the entire tree to IndexedDB (used on hydrate/replace). */
async function persistAllFiles(tree: TreeNode[]) {
  await fileClearAll();
  const all: FileNode[] = [];
  function collect(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === "file") all.push(n);
      else collect(n.children);
    }
  }
  collect(tree);
  await Promise.all(all.map((f) => fileSet(f.path, f.content, f.language, f.gitStatus)));
}

/** Rebuild the tree structure from a flat list of files. */
function buildTreeFromFiles(files: { path: string; content: string; language: string; gitStatus?: string | null }[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.path.split("/");
    const fileName = parts[parts.length - 1];
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;

    // Create parent folders
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const parentPath = currentPath || null;
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      if (!folderMap.has(currentPath)) {
        const folder: TreeNode = {
          type: "folder",
          name: folderName,
          path: currentPath,
          children: [],
          expanded: true,
        };
        folderMap.set(currentPath, folder);
        const target = parentPath ? folderMap.get(parentPath)?.children : root;
        if (target) target.push(folder);
      }
    }

    // Add the file
    const target = folderPath ? folderMap.get(folderPath)?.children : root;
    if (target) {
      target.push({
        type: "file",
        name: fileName,
        path: file.path,
        language: file.language,
        content: file.content,
        gitStatus: file.gitStatus ?? null,
      });
    }
  }

  return root;
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  tree: [],
  activeFilePath: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await fileGetAll();
      if (stored.length > 0) {
        // Rebuild tree from stored files (cache of the last active project)
        const tree = buildTreeFromFiles(stored);
        const activePath = await metaGet<string>("activeFilePath");
        set({
          tree,
          activeFilePath: activePath ?? stored[0]?.path ?? null,
          hydrated: true,
        });
      } else {
        // No cached files — start with an empty tree. The projects store
        // will load the active project's files (if any) after hydrating.
        // If there's no active project, the welcome page is shown.
        set({ tree: [], activeFilePath: null, hydrated: true });
      }
    } catch {
      // Fallback to empty tree if IndexedDB fails
      set({ tree: [], activeFilePath: null, hydrated: true });
    }
  },

  replaceTree: async (files) => {
    const tree = buildTreeFromFiles(files);
    await persistAllFiles(tree);
    set({ tree, activeFilePath: files[0]?.path ?? null });
  },

  setActiveFile: (path) => {
    set({ activeFilePath: path });
    metaSet("activeFilePath", path).catch(() => {});
  },

  getActiveFile: () => {
    const { tree, activeFilePath } = get();
    if (!activeFilePath) return null;
    return findFile(tree, activeFilePath);
  },

  updateFileContent: (path, content) =>
    set((s) => {
      const newTree = updateInTree(s.tree, (node) => {
        if (node.type === "file" && node.path === path) {
          const updated = { ...node, content, gitStatus: node.gitStatus ?? "modified" as const };
          persistFile(updated);
          return updated;
        }
        return node;
      });
      return { tree: newTree };
    }),

  createFile: (parentPath, name) =>
    set((s) => {
      const newTree = deepClone(s.tree);
      const parent = findFolder(newTree, parentPath);
      if (!parent) return s;
      const newFile: FileNode = {
        type: "file",
        name,
        path: parentPath ? `${parentPath}/${name}` : name,
        content: "",
        language: detectLanguage(name),
        gitStatus: "untracked",
      };
      parent.push(newFile);
      persistFile(newFile);
      return { tree: newTree, activeFilePath: newFile.path };
    }),

  createFolder: (parentPath, name) =>
    set((s) => {
      const newTree = deepClone(s.tree);
      const parent = findFolder(newTree, parentPath);
      if (!parent) return s;
      const newFolder: TreeNode = {
        type: "folder",
        name,
        path: parentPath ? `${parentPath}/${name}` : name,
        children: [],
        expanded: true,
      };
      parent.push(newFolder);
      return { tree: newTree };
    }),

  deleteNode: (path) => {
    fileDelete(path).catch(() => {});
    set((s) => ({
      tree: updateInTree(s.tree, (node) =>
        node.path === path ? null : node
      ),
    }));
  },

  renameNode: (path, newName) =>
    set((s) => ({
      tree: updateInTree(s.tree, (node) => {
        if (node.path !== path) return node;
        const parentPath = path.includes("/")
          ? path.substring(0, path.lastIndexOf("/"))
          : "";
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
        if (node.type === "file") {
          const updated = {
            ...node,
            name: newName,
            path: newPath,
            language: detectLanguage(newName),
          };
          // Delete old path, persist new
          fileDelete(path).catch(() => {});
          persistFile(updated);
          return updated;
        }
        return { ...node, name: newName, path: newPath };
      }),
    })),

  toggleFolder: (path) =>
    set((s) => ({
      tree: updateInTree(s.tree, (node) =>
        node.type === "folder" && node.path === path
          ? { ...node, expanded: !node.expanded }
          : node
      ),
    })),
}));
