"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createIDBStorage } from "@/lib/storage/zustand-idb-storage";

/**
 * §13.4 — Time-travel snapshots.
 *
 * Named workspace snapshots + auto-snapshot on deploy.
 * Users can restore any snapshot to roll back the entire file tree.
 *
 * Snapshots store a serialized copy of the file tree at capture time.
 * Restore shows a diff view of what would change.
 */

export interface Snapshot {
  id: string;
  name: string;
  description?: string;
  files: { path: string; content: string; language: string }[];
  createdAt: number;
  /** Whether this was auto-created (e.g. before deploy) */
  auto?: boolean;
}

interface SnapshotState {
  snapshots: Snapshot[];

  createSnapshot: (name: string, description: string, files: { path: string; content: string; language: string }[]) => string;
  deleteSnapshot: (id: string) => void;
  getSnapshot: (id: string) => Snapshot | null;
  clearAll: () => void;
}

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],

      createSnapshot: (name, description, files) => {
        const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const snapshot: Snapshot = {
          id,
          name,
          description,
          files,
          createdAt: Date.now(),
        };
        set((s) => ({ snapshots: [snapshot, ...s.snapshots].slice(0, 50) })); // Keep last 50
        return id;
      },

      deleteSnapshot: (id) =>
        set((s) => ({ snapshots: s.snapshots.filter((snap) => snap.id !== id) })),

      getSnapshot: (id) => get().snapshots.find((s) => s.id === id) ?? null,

      clearAll: () => set({ snapshots: [] }),
    }),
    {
      name: "stellarforge:snapshots",
      storage: createJSONStorage(() => createIDBStorage()),
    }
  )
);
