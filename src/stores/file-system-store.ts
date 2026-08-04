"use client";

import { create } from "zustand";
import { getInitialFileTree, findFile, type TreeNode, type FileNode } from "@/lib/soroban/sample-project";

interface FileSystemState {
  tree: TreeNode[];
  activeFilePath: string | null;

  setActiveFile: (path: string) => void;
  getActiveFile: () => FileNode | null;
  updateFileContent: (path: string, content: string) => void;
  createFile: (parentPath: string | null, name: string) => void;
  createFolder: (parentPath: string | null, name: string) => void;
  deleteNode: (path: string) => void;
  renameNode: (path: string, newName: string) => void;
  toggleFolder: (path: string) => void;
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

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  tree: getInitialFileTree(),
  activeFilePath: "src/lib.rs",

  setActiveFile: (path) => set({ activeFilePath: path }),

  getActiveFile: () => {
    const { tree, activeFilePath } = get();
    if (!activeFilePath) return null;
    return findFile(tree, activeFilePath);
  },

  updateFileContent: (path, content) =>
    set((s) => ({
      tree: updateInTree(s.tree, (node) => {
        if (node.type === "file" && node.path === path) {
          return { ...node, content, gitStatus: node.gitStatus ?? "modified" };
        }
        return node;
      }),
    })),

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

  deleteNode: (path) =>
    set((s) => ({
      tree: updateInTree(s.tree, (node) =>
        node.path === path ? null : node
      ),
    })),

  renameNode: (path, newName) =>
    set((s) => ({
      tree: updateInTree(s.tree, (node) => {
        if (node.path !== path) return node;
        const parentPath = path.includes("/")
          ? path.substring(0, path.lastIndexOf("/"))
          : "";
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
        if (node.type === "file") {
          return {
            ...node,
            name: newName,
            path: newPath,
            language: detectLanguage(newName),
          };
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
