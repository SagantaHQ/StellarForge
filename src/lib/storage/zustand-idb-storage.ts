import type { StateStorage } from "zustand/middleware";

/**
 * Zustand storage adapter backed by IndexedDB.
 *
 * Drop-in replacement for `createJSONStorage(() => localStorage)` that
 * uses IndexedDB under the hood. Async, non-blocking, 50MB+ limit.
 *
 * Usage:
 *   persist(store, {
 *     name: "my-store",
 *     storage: createIDBStorage(),
 *   })
 */

import { idbGet, idbSetKey, idbDelete } from "./idb";

export function createIDBStorage(): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const val = await idbGet<string>("meta", `zustand:${name}`);
      return val ?? null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await idbSetKey("meta", `zustand:${name}`, value);
    },
    removeItem: async (name: string): Promise<void> => {
      await idbDelete("meta", `zustand:${name}`);
    },
  };
}
