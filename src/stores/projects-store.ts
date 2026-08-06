"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  projectGetAll,
  projectGet,
  projectSet,
  projectDelete,
  type StoredProject,
} from "@/lib/storage/idb";
import { metaGet, metaSet } from "@/lib/storage/idb";
import { flattenFiles, type TreeNode } from "@/lib/soroban/sample-project";

/**
 * Projects store — local-first project management.
 *
 * Projects are stored in IndexedDB (so the IDE works without login) and
 * optionally mirrored to Postgres when the user is logged in.
 *
 * Switching projects:
 *   1. Save the current file tree into the outgoing project's IDB record
 *   2. Load the incoming project's files into the file system store
 *   3. Update activeProjectId in meta
 *
 * Closing a project:
 *   - Saves the current files into the project's IDB record (so they persist)
 *   - Sets activeProjectId to null
 *   - The IDE shows an empty state / "no project" prompt
 *
 * Deleting a project:
 *   - Removes it from IDB
 *   - If serverProjectId is set AND user is logged in, calls DELETE /api/projects/[id]
 *   - If it was the active project, sets activeProjectId to null
 */

export interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string | null;
  serverProjectId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ProjectsState {
  projects: ProjectMeta[];
  activeProjectId: string | null;
  hydrated: boolean;
  /** True while a create/switch/delete operation is in flight */
  busy: boolean;

  /** Load all local projects from IDB + active project id from meta */
  hydrate: () => Promise<void>;
  /** Pull the latest project list from Postgres (when logged in) and merge */
  syncFromServer: (ownerId: string) => Promise<void>;
  /** Create a new project (local + server if logged in) */
  createProject: (input: {
    name: string;
    description?: string;
    files: { path: string; content: string; language: string }[];
    ownerId?: string | null;
  }) => Promise<ProjectMeta>;
  /** Delete a project (local + server if it has serverProjectId) */
  deleteProject: (projectId: string, requesterId?: string | null) => Promise<void>;
  /** Switch the active project — saves outgoing files, loads incoming */
  switchProject: (projectId: string) => Promise<void>;
  /** Close the active project — saves its files, sets active to null */
  closeActiveProject: () => Promise<void>;
  /** Persist the current file tree into the active project's IDB record */
  persistActiveProjectFiles: (tree: TreeNode[]) => Promise<void>;
  /** Get the active project meta (or null) */
  getActiveProject: () => ProjectMeta | null;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `proj-${Date.now().toString(36)}`
  );
}

function genId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      hydrated: false,
      busy: false,

      hydrate: async () => {
        try {
          const stored = await projectGetAll();
          const projects: ProjectMeta[] = stored.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            ownerId: p.ownerId,
            serverProjectId: p.serverProjectId,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          }));
          const activeId = await metaGet<string>("activeProjectId");
          set({
            projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
            activeProjectId: activeId ?? null,
            hydrated: true,
          });

          // §8 — If there's an active project, load its files into the file
          // system store so the editor can render immediately. This is the
          // "restore last opened project" behavior on page load.
          if (activeId) {
            const activeStored = stored.find((p) => p.id === activeId);
            if (activeStored && activeStored.files.length > 0) {
              await loadFilesIntoFileSystem(activeStored.files);
            } else if (activeStored && activeStored.serverProjectId) {
              // Local stub with no cached files — try fetching from server
              try {
                const res = await fetch(`/api/projects/${activeStored.serverProjectId}`);
                if (res.ok) {
                  const data = await res.json();
                  const serverFiles = (data.project.files ?? []).map(
                    (f: { path: string; content: string; language: string }) => ({
                      path: f.path,
                      content: f.content,
                      language: f.language,
                    })
                  );
                  // Cache for next time
                  await projectSet({
                    ...activeStored,
                    files: serverFiles,
                    updatedAt: Date.now(),
                  });
                  await loadFilesIntoFileSystem(serverFiles);
                }
              } catch {
                // Network error — leave file system empty, welcome page shows
              }
            }
          }
        } catch {
          set({ hydrated: true });
        }
      },

      syncFromServer: async (ownerId) => {
        try {
          const res = await fetch(`/api/projects?ownerId=${encodeURIComponent(ownerId)}`);
          if (!res.ok) return;
          const data = (await res.json()) as {
            projects: {
              id: string;
              name: string;
              slug: string;
              description?: string;
              ownerId: string;
              isPublic: boolean;
              defaultBranch: string;
              createdAt: string;
              updatedAt: string;
              _count?: { files: number };
            }[];
          };

          // Merge server projects into local list.
          // For projects that already have a serverProjectId link, update metadata.
          // For new server projects, create a local stub (files will lazy-load on switch).
          const local = get().projects;
          const merged: ProjectMeta[] = [...local];

          for (const sp of data.projects) {
            const existingIdx = merged.findIndex(
              (p) => p.serverProjectId === sp.id
            );
            if (existingIdx >= 0) {
              merged[existingIdx] = {
                ...merged[existingIdx],
                name: sp.name,
                slug: sp.slug,
                description: sp.description ?? undefined,
                ownerId: sp.ownerId,
                updatedAt: new Date(sp.updatedAt).getTime(),
              };
            } else {
              // New server project — create local stub
              const stubId = genId();
              const stub: ProjectMeta = {
                id: stubId,
                name: sp.name,
                slug: sp.slug,
                description: sp.description ?? undefined,
                ownerId: sp.ownerId,
                serverProjectId: sp.id,
                createdAt: new Date(sp.createdAt).getTime(),
                updatedAt: new Date(sp.updatedAt).getTime(),
              };
              merged.push(stub);

              // Lazy: don't fetch files yet — they'll be pulled on first switch
              // Persist the stub to IDB so it survives reload
              await projectSet({
                id: stubId,
                name: sp.name,
                slug: sp.slug,
                description: sp.description,
                ownerId: sp.ownerId,
                serverProjectId: sp.id,
                files: [],
                createdAt: stub.createdAt,
                updatedAt: stub.updatedAt,
              });
            }
          }

          set({
            projects: merged.sort((a, b) => b.updatedAt - a.updatedAt),
          });
        } catch {
          // Silently fail — local-first means we work offline
        }
      },

      createProject: async (input) => {
        set({ busy: true });
        try {
          const id = genId();
          const now = Date.now();
          let serverProjectId: string | null = null;
          let ownerId: string | null = input.ownerId ?? null;

          // If logged in, mirror to Postgres
          if (input.ownerId) {
            try {
              const res = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: input.name,
                  description: input.description,
                  ownerId: input.ownerId,
                  files: input.files,
                }),
              });
              if (res.ok) {
                const data = await res.json();
                serverProjectId = data.project.id;
              }
            } catch {
              // Server sync failed — keep local-only
            }
          }

          const meta: ProjectMeta = {
            id,
            name: input.name,
            slug: slugify(input.name),
            description: input.description,
            ownerId,
            serverProjectId,
            createdAt: now,
            updatedAt: now,
          };

          // Persist to IDB
          await projectSet({
            id,
            name: meta.name,
            slug: meta.slug,
            description: meta.description,
            ownerId: meta.ownerId,
            serverProjectId: meta.serverProjectId,
            files: input.files,
            createdAt: now,
            updatedAt: now,
          });

          set((s) => ({
            projects: [meta, ...s.projects].sort((a, b) => b.updatedAt - a.updatedAt),
            activeProjectId: id,
          }));
          await metaSet("activeProjectId", id);

          return meta;
        } finally {
          set({ busy: false });
        }
      },

      deleteProject: async (projectId, requesterId) => {
        set({ busy: true });
        try {
          const project = get().projects.find((p) => p.id === projectId);
          if (!project) return;

          // If synced with server and we have a requesterId, delete from Postgres
          if (project.serverProjectId && requesterId) {
            try {
              await fetch(
                `/api/projects/${encodeURIComponent(project.serverProjectId)}?requesterId=${encodeURIComponent(requesterId)}`,
                { method: "DELETE" }
              );
            } catch {
              // Best-effort — local delete still proceeds
            }
          }

          // Remove from IDB
          await projectDelete(projectId);

          // Update store
          const wasActive = get().activeProjectId === projectId;
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== projectId),
            activeProjectId: wasActive ? null : s.activeProjectId,
          }));

          if (wasActive) {
            await metaSet("activeProjectId", null);
          }
        } finally {
          set({ busy: false });
        }
      },

      switchProject: async (projectId) => {
        const state = get();
        if (state.activeProjectId === projectId) return;

        set({ busy: true });
        try {
          // 1. Save outgoing project's files (if there was an active project)
          const outgoingId = state.activeProjectId;
          if (outgoingId) {
            await saveCurrentFilesToProject(outgoingId);
          }

          // 2. Load incoming project's files
          const incoming = await projectGet(projectId);
          if (!incoming) {
            // Maybe it's a server-only project — try to fetch
            const meta = state.projects.find((p) => p.id === projectId);
            if (meta?.serverProjectId) {
              try {
                const res = await fetch(`/api/projects/${meta.serverProjectId}`);
                if (res.ok) {
                  const data = await res.json();
                  const serverFiles = (data.project.files ?? []).map(
                    (f: { path: string; content: string; language: string; gitStatus?: string | null }) => ({
                      path: f.path,
                      content: f.content,
                      language: f.language,
                    })
                  );
                  // Persist fetched files to IDB for next time
                  await projectSet({
                    id: projectId,
                    name: meta.name,
                    slug: meta.slug,
                    description: meta.description,
                    ownerId: meta.ownerId,
                    serverProjectId: meta.serverProjectId,
                    files: serverFiles,
                    createdAt: meta.createdAt,
                    updatedAt: Date.now(),
                  });
                  // Load into file system store
                  await loadFilesIntoFileSystem(serverFiles);
                }
              } catch {
                // Network error — fall through to empty
              }
            }
          } else {
            // Load from IDB
            await loadFilesIntoFileSystem(incoming.files);
          }

          // 3. Update active project
          set({ activeProjectId: projectId });
          await metaSet("activeProjectId", projectId);
        } finally {
          set({ busy: false });
        }
      },

      closeActiveProject: async () => {
        const outgoingId = get().activeProjectId;
        if (!outgoingId) return;

        set({ busy: true });
        try {
          // Save current files into the outgoing project
          await saveCurrentFilesToProject(outgoingId);

          // Clear active project
          set({ activeProjectId: null });
          await metaSet("activeProjectId", null);

          // Clear the file system store so the IDE shows "no project"
          const { useFileSystemStore } = await import("@/stores/file-system-store");
          await useFileSystemStore.getState().replaceTree([]);
          // Close all editor tabs
          const { useEditorTabsStore } = await import("@/stores/editor-tabs-store");
          useEditorTabsStore.getState().closeAllTabs();
        } finally {
          set({ busy: false });
        }
      },

      persistActiveProjectFiles: async (tree) => {
        const activeId = get().activeProjectId;
        if (!activeId) return;
        await saveCurrentFilesToProject(activeId, tree);
      },

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        if (!activeProjectId) return null;
        return projects.find((p) => p.id === activeProjectId) ?? null;
      },
    }),
    {
      name: "soroban-build:projects-meta",
      storage: createJSONStorage(() => localStorage),
      // Only persist the lightweight meta — files live in IDB
      partialize: (s) => ({
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
    }
  )
);

// ============================================================
// Helpers (not exported as part of the store interface)
// ============================================================

/** Save the current in-memory file tree into a project's IDB record. */
async function saveCurrentFilesToProject(projectId: string, explicitTree?: TreeNode[]) {
  try {
    const stored = await projectGet(projectId);
    if (!stored) return;

    // Dynamic import to avoid circular dependency
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const tree = explicitTree ?? useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language,
    }));

    await projectSet({
      ...stored,
      files,
      updatedAt: Date.now(),
    });

    // Update the in-memory projects list (so the UI shows fresh updatedAt)
    useProjectsStore.setState((s) => ({
      projects: s.projects
        .map((p) =>
          p.id === projectId ? { ...p, updatedAt: Date.now() } : p
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }));
  } catch {
    // Best-effort — don't block switching on save failure
  }
}

/** Load files from a project record into the file system store. */
async function loadFilesIntoFileSystem(
  files: { path: string; content: string; language: string }[]
) {
  const { useFileSystemStore } = await import("@/stores/file-system-store");
  const { useEditorTabsStore } = await import("@/stores/editor-tabs-store");

  if (files.length === 0) {
    // Empty project — clear the tree
    await useFileSystemStore.getState().replaceTree([]);
    return;
  }

  // Replace the file tree with the project's files
  await useFileSystemStore.getState().replaceTree(files);

  // Open the first source file
  const firstFile =
    files.find((f) => f.path === "src/lib.rs") ??
    files.find((f) => f.path.endsWith(".rs")) ??
    files[0];
  if (firstFile) {
    useEditorTabsStore.getState().openTab(
      firstFile.path,
      firstFile.path.split("/").pop() ?? firstFile.path
    );
  }
}
