import { openDB, type IDBPDatabase } from "idb";

/**
 * §8 — Local-first IndexedDB storage.
 *
 * The app is local-first: files, open tabs, editor state, unsaved buffers,
 * and comment drafts live in IndexedDB and sync opportunistically when
 * online. Offline = full editing continues; reconnect = merge + push.
 */

const DB_NAME = "soroban-build";
const DB_VERSION = 2;

export type StoreName = "files" | "comments" | "tabs" | "meta" | "projects";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1 stores
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "path" });
        }
        if (!db.objectStoreNames.contains("comments")) {
          db.createObjectStore("comments", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tabs")) {
          db.createObjectStore("tabs", { keyPath: "path" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
        // v2 — projects store (keyPath: "id") for local-first project management
        if (oldVersion < 2 && !db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(store, key);
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDB();
  return db.getAll(store);
}

export async function idbSet<T>(store: StoreName, value: T): Promise<void> {
  const db = await getDB();
  await db.put(store, value);
}

export async function idbSetKey<T>(store: StoreName, key: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put(store, value, key);
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, key);
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}

// Meta store (key-value)
export async function metaGet<T>(key: string): Promise<T | undefined> {
  return idbGet<T>("meta", key);
}

export async function metaSet<T>(key: string, value: T): Promise<void> {
  return idbSetKey("meta", key, value);
}

// File store helpers
export interface StoredFile {
  path: string;
  content: string;
  language: string;
  gitStatus?: string | null;
  updatedAt: number;
}

export async function fileGetAll(): Promise<StoredFile[]> {
  return idbGetAll<StoredFile>("files");
}

export async function fileSet(path: string, content: string, language: string, gitStatus?: string | null): Promise<void> {
  await idbSet<StoredFile>("files", { path, content, language, gitStatus: gitStatus ?? null, updatedAt: Date.now() });
}

export async function fileDelete(path: string): Promise<void> {
  return idbDelete("files", path);
}

export async function fileClearAll(): Promise<void> {
  return idbClear("files");
}

// ============================================================
// Projects store (local-first, optional Postgres sync)
// ============================================================

export interface StoredProject {
  id: string;
  name: string;
  slug: string;
  description?: string;
  /** ownerId — set when synced with Postgres; null for local-only */
  ownerId: string | null;
  /** serverProjectId — set when the project has a Postgres counterpart */
  serverProjectId: string | null;
  /** Files snapshot for fast project switching (path -> content/language) */
  files: { path: string; content: string; language: string }[];
  createdAt: number;
  updatedAt: number;
}

export async function projectGetAll(): Promise<StoredProject[]> {
  return idbGetAll<StoredProject>("projects");
}

export async function projectGet(id: string): Promise<StoredProject | undefined> {
  return idbGet<StoredProject>("projects", id);
}

export async function projectSet(project: StoredProject): Promise<void> {
  await idbSet<StoredProject>("projects", project);
}

export async function projectDelete(id: string): Promise<void> {
  return idbDelete("projects", id);
}

export async function projectClearAll(): Promise<void> {
  return idbClear("projects");
}
