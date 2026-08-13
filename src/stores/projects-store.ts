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
  /** True while project files are being fetched from the cloud (server).
   * Shown as a "Syncing project files…" indicator in the UI. */
  syncingFromCloud: boolean;

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
  /** Schedule a debounced auto-sync of the active project to the server */
  scheduleAutoSync: () => void;
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
      syncingFromCloud: false,

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
          // system store so the editor can render immediately.
          //
          // IMPORTANT: per-file IDB is the SOURCE OF TRUTH (written on every
          // keystroke via persistFile). The project-snapshot `files` array is
          // a STALE snapshot from the last time the project was saved. If we
          // always called loadFilesIntoFileSystem(activeStored.files), it
          // would call replaceTree → fileClearAll → write stale snapshot,
          // OVERWRITING the user's latest edits in per-file IDB.
          //
          // So: only load from the snapshot if the file-system store hasn't
          // already hydrated with newer data from per-file IDB. The
          // file-system store's hydrate() runs in parallel and reads per-file
          // IDB — if it found files, we must NOT overwrite them.
          if (activeId) {
            const activeStored = stored.find((p) => p.id === activeId);
            // Check if the file-system store already has files (from per-file IDB)
            const { useFileSystemStore } = await import("@/stores/file-system-store");
            const fsTree = useFileSystemStore.getState().tree;
            const fsHasFiles = fsTree.length > 0;

            if (activeStored && activeStored.files.length > 0 && !fsHasFiles) {
              // Per-file IDB was empty — fall back to the project snapshot
              await loadFilesIntoFileSystem(activeStored.files);
            } else if (activeStored && activeStored.serverProjectId && !fsHasFiles) {
              // Local stub with no cached files — fetch from server (cloud sync)
              set({ syncingFromCloud: true });
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
              } finally {
                set({ syncingFromCloud: false });
              }
            }
            // else: per-file IDB has newer files — DON'T overwrite them.
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

          // EAGERLY fetch files for all server projects. This way, when the
          // user selects a project, the files are already in IDB + load
          // instantly. We fetch in parallel (batches of 3) for speed.
          const projectsNeedingFiles = merged.filter((p) => p.serverProjectId);

          // Fetch files in batches of 3
          const BATCH_SIZE = 3;
          for (let i = 0; i < projectsNeedingFiles.length; i += BATCH_SIZE) {
            const batch = projectsNeedingFiles.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (p) => {
              if (!p.serverProjectId) return;
              // Check if we already have files cached in IDB
              const cached = await projectGet(p.id);
              if (cached && cached.files && cached.files.length > 0) return; // already cached
              try {
                const fileRes = await fetch(`/api/projects/${p.serverProjectId}`);
                if (fileRes.ok) {
                  const fileData = await fileRes.json();
                  const serverFiles = (fileData.project.files ?? []).map(
                    (f: { path: string; content: string; language: string }) => ({
                      path: f.path,
                      content: f.content,
                      language: f.language,
                    })
                  );
                  // Cache in IDB for next time
                  await projectSet({
                    id: p.id,
                    name: p.name,
                    slug: p.slug,
                    description: p.description,
                    ownerId: p.ownerId,
                    serverProjectId: p.serverProjectId,
                    files: serverFiles,
                    createdAt: p.createdAt,
                    updatedAt: Date.now(),
                  });
                }
              } catch {
                // Best-effort — if one project fails, continue with others
              }
            }));
          }
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

          // Load the new project's files into the file-system store so the
          // editor renders them immediately. Without this, the editor would
          // show stale files from the previous project (or the old hello-world
          // seed) because the file-system store's IDB cache isn't cleared.
          await loadFilesIntoFileSystem(input.files);

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

          // Remove from IDB (with retry — the IDB layer handles connection issues)
          await projectDelete(projectId);

          const wasActive = get().activeProjectId === projectId;

          // If we're deleting the active project, clear the file system store
          // and editor tabs BEFORE updating the projects store, so the UI
          // transitions cleanly to the welcome page.
          if (wasActive) {
            try {
              const { useFileSystemStore } = await import("@/stores/file-system-store");
              const { useEditorTabsStore } = await import("@/stores/editor-tabs-store");
              await useFileSystemStore.getState().replaceTree([]);
              useEditorTabsStore.getState().closeAllTabs();
            } catch {
              // Best-effort — the UI will show empty state regardless
            }
            await metaSet("activeProjectId", null);
          }

          // Update store state
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== projectId),
            activeProjectId: wasActive ? null : s.activeProjectId,
          }));
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
            // Maybe it's a server-only project — try to fetch from cloud
            const meta = state.projects.find((p) => p.id === projectId);
            if (meta?.serverProjectId) {
              set({ syncingFromCloud: true });
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
              } finally {
                set({ syncingFromCloud: false });
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
          const project = get().projects.find((p) => p.id === outgoingId);

          // 1. Delete from the server if it has a serverProjectId.
          //    The server cascade-deletes: files, comments, members,
          //    snapshots, audit logs, share permissions, collab sessions.
          if (project?.serverProjectId && project.ownerId) {
            try {
              await fetch(
                `/api/projects/${encodeURIComponent(project.serverProjectId)}?requesterId=${encodeURIComponent(project.ownerId)}`,
                { method: "DELETE" }
              );
            } catch {
              // Best-effort — local delete still proceeds
            }
          }

          // 2. Delete from IndexedDB (local project record + cached files)
          await projectDelete(outgoingId);

          // 3. Clear the file system store (the IDB "files" object store
          //    still has the file contents — clear them so the next project
          //    doesn't see stale data)
          const { useFileSystemStore } = await import("@/stores/file-system-store");
          const { fileClearAll } = await import("@/lib/storage/idb");
          await fileClearAll();
          await useFileSystemStore.getState().replaceTree([]);

          // 4. Close all editor tabs
          const { useEditorTabsStore } = await import("@/stores/editor-tabs-store");
          useEditorTabsStore.getState().closeAllTabs();

          // 5. Clear active project + remove from the projects list
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== outgoingId),
            activeProjectId: null,
          }));
          await metaSet("activeProjectId", null);
        } finally {
          set({ busy: false });
        }
      },

      persistActiveProjectFiles: async (tree) => {
        const activeId = get().activeProjectId;
        if (!activeId) return;
        await saveCurrentFilesToProject(activeId, tree);
      },

      /**
       * Schedule a debounced auto-sync of the active project's files to the
       * server. Called by the file-system store whenever a file is edited.
       * The sync is delayed by 2 seconds to batch rapid edits, and only
       * runs if the user is logged in and the project has a serverProjectId.
       */
      scheduleAutoSync: (() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        return () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(async () => {
            timer = null;
            await syncActiveProjectToServer();
          }, 2000);
        };
      })(),

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

/**
 * Sync the active project's files to the server (Postgres).
 * Called by scheduleAutoSync (debounced) after the user edits files.
 *
 * Only syncs if:
 *   - The project has a serverProjectId (was created on the server)
 *   - The user is logged in (has a wallet address + server profile)
 *
 * Uses PATCH /api/projects/[id] with the full file list. The server
 * soft-deletes old files and creates new ones.
 */
async function syncActiveProjectToServer() {
  try {
    // Only sync if the user is logged in
    const { useProfileStore } = await import("@/stores/profile-store");
    if (!useProfileStore.getState().isLoggedIn()) return;

    const state = useProjectsStore.getState();
    const activeId = state.activeProjectId;
    if (!activeId) return;

    const project = state.projects.find((p) => p.id === activeId);
    if (!project || !project.serverProjectId) return;

    // Get the current files from the file system store
    const { useFileSystemStore } = await import("@/stores/file-system-store");
    const tree = useFileSystemStore.getState().tree;
    const files = flattenFiles(tree).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language,
    }));

    // Save to IDB first (fast, local)
    await saveCurrentFilesToProject(activeId, tree);

    // Then sync to server (fire-and-forget — don't block the UI)
    fetch(`/api/projects/${project.serverProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files,
        requesterId: project.ownerId,
      }),
    }).catch(() => {
      // Best-effort — sync will retry on next edit
    });
  } catch {
    // Best-effort — don't crash the app if sync fails
  }
}
