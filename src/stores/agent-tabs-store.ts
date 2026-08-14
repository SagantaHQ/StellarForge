"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Agent chat tabs store — persists chat history across page reloads.
 *
 * Chat is PER-PROJECT: each tab has a projectId. When the user switches
 * projects, the store filters tabs by the new project's ID. When a project
 * is closed, its tabs remain in storage (so reopening the project restores
 * them) but aren't shown.
 *
 * Stored in localStorage (not IDB) because:
 *   - Chat history is small (text only, no file content)
 *   - Needs to load synchronously on page mount (no async)
 *   - Tied to the browser, not the project
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
  /** Project ID this tab belongs to. Tabs are filtered by the active project. */
  projectId: string;
  /** True if a diff was accepted in the last assistant response.
   * Used to show the "Build to verify" button only after an actual file change. */
  diffAccepted?: boolean;
}

interface AgentTabsState {
  /** ALL tabs (across all projects). Filtered by activeProjectId for display. */
  tabs: AgentTab[];
  activeTabId: string;
  /** The currently active project ID. Used to filter which tabs are shown. */
  activeProjectId: string | null;

  setTabs: (tabs: AgentTab[]) => void;
  setActiveTabId: (id: string) => void;
  /** Switch to a different project — filters tabs + creates a default if none exist. */
  setActiveProject: (projectId: string | null) => void;
  addTab: (tab: AgentTab) => void;
  removeTab: (id: string) => void;
  updateTab: (id: string, updater: (tab: AgentTab) => AgentTab) => void;
  clearTabMessages: (id: string) => void;
  /** Remove all tabs for a project (called when a project is deleted). */
  clearProjectTabs: (projectId: string) => void;
}

function createDefaultTab(projectId: string): AgentTab {
  return {
    id: `tab-${Date.now()}`,
    name: "Contract Work",
    scope: "smart-contract",
    messages: [],
    pendingDiffs: [],
    projectId,
  };
}

export const useAgentTabsStore = create<AgentTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: "tab-1",
      activeProjectId: null,

      setTabs: (tabs) => set({ tabs }),

      setActiveTabId: (id) => set({ activeTabId: id }),

      setActiveProject: (projectId) => {
        if (!projectId) {
          // Project closed — clear the active tab but keep all tabs in storage
          set({ activeProjectId: null, activeTabId: "" });
          return;
        }

        // Find tabs for this project
        const projectTabs = get().tabs.filter((t) => t.projectId === projectId);

        if (projectTabs.length === 0) {
          // No tabs for this project — create a default one
          const newTab = createDefaultTab(projectId);
          set((s) => ({
            tabs: [...s.tabs, newTab],
            activeProjectId: projectId,
            activeTabId: newTab.id,
          }));
        } else {
          // Project has tabs — switch to the first one
          set({
            activeProjectId: projectId,
            activeTabId: projectTabs[0].id,
          });
        }
      },

      addTab: (tab) =>
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
        })),

      removeTab: (id) =>
        set((s) => {
          const newTabs = s.tabs.filter((t) => t.id !== id);
          // If we removed the active tab, switch to another tab in the same project
          const projectTabs = newTabs.filter((t) => t.projectId === s.activeProjectId);
          const newActiveId = s.activeTabId === id
            ? (projectTabs[0]?.id ?? "")
            : s.activeTabId;
          // If no tabs left for the active project, create a default one
          if (projectTabs.length === 0 && s.activeProjectId) {
            const newTab = createDefaultTab(s.activeProjectId);
            return {
              tabs: [...newTabs, newTab],
              activeTabId: newTab.id,
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

      clearProjectTabs: (projectId) =>
        set((s) => {
          const newTabs = s.tabs.filter((t) => t.projectId !== projectId);
          const newActiveId = newTabs.find((t) => t.projectId === s.activeProjectId)?.id ?? "";
          return { tabs: newTabs, activeTabId: newActiveId };
        }),
    }),
    {
      name: "soroban-build:agent-tabs",
      storage: createJSONStorage(() => localStorage),
      // Persist everything — tabs + activeTabId + activeProjectId
    }
  )
);
