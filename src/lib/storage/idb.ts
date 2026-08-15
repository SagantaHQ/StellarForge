import { openDB, type IDBPDatabase } from "idb";

/**
 * §8 — Local-first IndexedDB storage.
 *
 * The app is local-first: files, open tabs, editor state, unsaved buffers,
 * and comment drafts live in IndexedDB and sync opportunistically when
 * online. Offline = full editing continues; reconnect = merge + push.
 *
 * Connection resilience: the DB connection can close unexpectedly due to
 * browser tab suspension, storage pressure, or the persist middleware
 * rehydrating during an operation. We handle this by:
 *   1. Tracking connection state with `dbClosed`
 *   2. Resetting the promise on close so the next call reopens
 *   3. Wrapping all operations in a retry that reopens on failure
 */

const DB_NAME = "stellarforge";
const DB_VERSION = 2;

export type StoreName = "files" | "comments" | "tabs" | "meta" | "projects";

let dbPromise: Promise<IDBPDatabase> | null = null;
let dbClosed = false;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  // If the connection was closed or never opened, (re)open it
  if (!dbPromise || dbClosed) {
    dbClosed = false;
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
      // Handle unexpected connection termination — reset so next call reopens
      blocking() {
        // Another tab wants to upgrade the DB — close our connection
        if (dbPromise) {
          dbPromise.then((db) => db.close()).catch(() => {});
        }
        dbClosed = true;
        dbPromise = null;
      },
      terminated() {
        // The connection was unexpectedly terminated (e.g. browser evicted it)
        dbClosed = true;
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/**
 * Run an IDB operation with automatic retry on connection failure.
 * If the first attempt fails because the connection is closing/closed,
 * we reset the connection and try once more.
 */
async function withRetry<T>(op: (db: IDBPDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await getDB();
    return await op(db);
  } catch (err) {
    // Check if this is a connection-closing error
    const msg = err instanceof Error ? err.message : String(err);
    const isConnectionError =
      msg.includes("closing") ||
      msg.includes("Connection is closed") ||
      msg.includes("already closed") ||
      msg.includes("The database connection is closing");
    if (!isConnectionError) throw err;

    // Reset the connection and retry once
    dbClosed = true;
    dbPromise = null;
    const db = await getDB();
    return await op(db);
  }
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return withRetry((db) => db.get(store, key));
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return withRetry((db) => db.getAll(store));
}

export async function idbSet<T>(store: StoreName, value: T): Promise<void> {
  await withRetry((db) => db.put(store, value));
}

export async function idbSetKey<T>(store: StoreName, key: string, value: T): Promise<void> {
  await withRetry((db) => db.put(store, value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await withRetry((db) => db.delete(store, key));
}

export async function idbClear(store: StoreName): Promise<void> {
  await withRetry((db) => db.clear(store));
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
