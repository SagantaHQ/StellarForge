import { openDB, type IDBPDatabase } from "idb";

/**
 * §8 — Local-first IndexedDB storage.
 *
 * The app is local-first: files, open tabs, editor state, unsaved buffers,
 * and comment drafts live in IndexedDB and sync opportunistically when
 * online. Offline = full editing continues; reconnect = merge + push.
 */

const DB_NAME = "soroban-build";
const DB_VERSION = 1;

export type StoreName = "files" | "comments" | "tabs" | "meta";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
