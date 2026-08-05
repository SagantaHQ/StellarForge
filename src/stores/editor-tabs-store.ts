"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createIDBStorage } from "@/lib/storage/zustand-idb-storage";

export interface EditorTab {
  path: string;
  name: string;
  dirty: boolean;
  /** Optional preview tab indicator (VS Code-style) */
  preview?: boolean;
}

interface EditorTabsState {
  tabs: EditorTab[];
  activeTabPath: string | null;

  openTab: (path: string, name: string, opts?: { preview?: boolean }) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
  reorderTabs: (from: number, to: number) => void;
}

export const useEditorTabsStore = create<EditorTabsState>()(
  persist(
    (set) => ({
      tabs: [{ path: "src/lib.rs", name: "lib.rs", dirty: false }],
      activeTabPath: "src/lib.rs",

      openTab: (path, name, opts) =>
        set((s) => {
          const existing = s.tabs.find((t) => t.path === path);
          if (existing) {
            return {
              tabs: s.tabs.map((t) =>
                t.path === path ? { ...t, preview: opts?.preview ?? false } : t
              ),
              activeTabPath: path,
            };
          }
          const newTab: EditorTab = {
            path,
            name,
            dirty: false,
            preview: opts?.preview,
          };
          let newTabs = s.tabs;
          const previewIdx = s.tabs.findIndex((t) => t.preview);
          if (previewIdx >= 0 && opts?.preview) {
            newTabs = [...s.tabs];
            newTabs[previewIdx] = newTab;
          } else {
            newTabs = [...s.tabs, newTab];
          }
          return { tabs: newTabs, activeTabPath: path };
        }),

      closeTab: (path) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.path === path);
          if (idx < 0) return s;
          const newTabs = s.tabs.filter((t) => t.path !== path);
          let newActive = s.activeTabPath;
          if (s.activeTabPath === path) {
            newActive = newTabs[Math.max(0, idx - 1)]?.path ?? null;
          }
          return { tabs: newTabs, activeTabPath: newActive };
        }),

      setActiveTab: (path) => set({ activeTabPath: path }),

      markDirty: (path, dirty) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)),
        })),

      reorderTabs: (from, to) =>
        set((s) => {
          const newTabs = [...s.tabs];
          const [moved] = newTabs.splice(from, 1);
          newTabs.splice(to, 0, moved);
          return { tabs: newTabs };
        }),
    }),
    {
      name: "soroban-build:editor-tabs",
      storage: createJSONStorage(() => createIDBStorage()),
      partialize: (s) => ({
        tabs: s.tabs,
        activeTabPath: s.activeTabPath,
      }),
    }
  )
);
