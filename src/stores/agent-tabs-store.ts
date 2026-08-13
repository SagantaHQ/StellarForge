"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Agent chat tabs store — persists chat history across page reloads.
 *
 * Each tab has: id, name, scope, messages[], pendingDiffs[]
 * Messages have: role, content, timestamp
 *
 * Stored in localStorage (not IDB) because:
 *   - Chat history is small (text only, no file content)
 *   - Needs to load synchronously on page mount (no async)
 *   - Tied to the browser, not the project
 *
 * The store is separate from the AIKeysStore (provider config) because
 * chat history is a different concern + can grow large.
 */

export type AgentScope = "smart-contract" | "ui-frontend" | "general" | "custom";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface AgentTab {
  id: string;
  name: string;
  scope: AgentScope;
  messages: AgentMessage[];
  pendingDiffs: unknown[]; // ParsedDiff[] — kept as unknown[] to avoid import cycle
  unread?: boolean;
}

interface AgentTabsState {
  tabs: AgentTab[];
  activeTabId: string;

  setTabs: (tabs: AgentTab[]) => void;
  setActiveTabId: (id: string) => void;
  addTab: (tab: AgentTab) => void;
  removeTab: (id: string) => void;
  updateTab: (id: string, updater: (tab: AgentTab) => AgentTab) => void;
  clearTabMessages: (id: string) => void;
}

export const useAgentTabsStore = create<AgentTabsState>()(
  persist(
    (set) => ({
      tabs: [
        {
          id: "tab-1",
          name: "Contract Work",
          scope: "smart-contract" as AgentScope,
          messages: [],
          pendingDiffs: [],
        },
      ],
      activeTabId: "tab-1",

      setTabs: (tabs) => set({ tabs }),

      setActiveTabId: (id) => set({ activeTabId: id }),

      addTab: (tab) =>
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
        })),

      removeTab: (id) =>
        set((s) => {
          const newTabs = s.tabs.filter((t) => t.id !== id);
          // If we removed the active tab, switch to the first remaining tab
          const newActiveId = s.activeTabId === id
            ? (newTabs[0]?.id ?? "tab-1")
            : s.activeTabId;
          // If no tabs left, create a default one
          if (newTabs.length === 0) {
            return {
              tabs: [
                {
                  id: "tab-1",
                  name: "Contract Work",
                  scope: "smart-contract" as AgentScope,
                  messages: [],
                  pendingDiffs: [],
                },
              ],
              activeTabId: "tab-1",
            };
          }
          return { tabs: newTabs, activeTabId: newActiveId };
        }),

      updateTab: (id, updater) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? updater(t) : t)),
        })),

      clearTabMessages: (id) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, messages: [], pendingDiffs: [] } : t
          ),
        })),
    }),
    {
      name: "soroban-build:agent-tabs",
      storage: createJSONStorage(() => localStorage),
      // Persist everything — tabs + activeTabId
    }
  )
);
