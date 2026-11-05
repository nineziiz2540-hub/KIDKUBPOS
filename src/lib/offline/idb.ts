import type { OutboxEntry } from "./outbox-rules";

// The only module that touches IndexedDB. Browser-only: nothing here runs at
// import time; every browser global is touched lazily inside a function.

const DB_NAME = "kidkub-pos";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const KV = "kv";
const CHANNEL_NAME = "kidkub-outbox";
const PERSIST_KEY = "persist-asked";

const UNAVAILABLE = "storage_unavailable";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openKidkubDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error(UNAVAILABLE));
  }
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new Error(UNAVAILABLE));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "clientRef" });
      }
      if (!db.objectStoreNames.contains(KV)) {
        db.createObjectStore(KV);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new Error(UNAVAILABLE));
    req.onblocked = () => reject(new Error(UNAVAILABLE));
  });
  dbPromise = p;
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

function mapWriteError(err: { name?: string; message?: string } | null | undefined): Error {
  if (err && err.name === "QuotaExceededError") return new Error(UNAVAILABLE);
  return err instanceof Error ? err : new Error(err?.message ?? "idb_error");
}

// A write is its own readwrite transaction; resolves on oncomplete so the
// data is committed before we report it saved.
async function write(
  store: string,
  fn: (s: IDBObjectStore) => void,
): Promise<void> {
  const db = await openKidkubDb();
  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, "readwrite");
      fn(tx.objectStore(store));
    } catch (e) {
      reject(mapWriteError(e as Error));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapWriteError(tx.error));
    tx.onabort = () => reject(mapWriteError(tx.error));
  });
}

async function read<T>(
  store: string,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openKidkubDb();
  return new Promise<T>((resolve, reject) => {
    try {
      const req = fn(db.transaction(store, "readonly").objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("idb_error"));
    } catch (e) {
      reject(e);
    }
  });
}

// ---- change notifications ----

const localListeners = new Set<() => void>();
let postChannel: BroadcastChannel | null = null;

function notifyChange(): void {
  for (const cb of Array.from(localListeners)) {
    try {
      cb();
    } catch {
      // a broken listener must not break the others
    }
  }
  try {
    if (typeof BroadcastChannel === "undefined") return;
    postChannel ??= new BroadcastChannel(CHANNEL_NAME);
    postChannel.postMessage("change");
  } catch {
    // cross-tab refresh is best-effort
  }
}

export function onOutboxChange(cb: () => void): () => void {
  localListeners.add(cb);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => cb();
    }
  } catch {
    channel = null;
  }
  return () => {
    localListeners.delete(cb);
    try {
      channel?.close();
    } catch {
      // ignore
    }
  };
}

// ---- outbox ----

export async function outboxPut(e: OutboxEntry): Promise<void> {
  await write(OUTBOX, (s) => {
    s.put(e);
  });
  notifyChange();
}

export async function outboxDelete(clientRef: string): Promise<void> {
  await write(OUTBOX, (s) => {
    s.delete(clientRef);
  });
  notifyChange();
}

export async function outboxAll(): Promise<OutboxEntry[]> {
  return read<OutboxEntry[]>(OUTBOX, (s) => s.getAll());
}

// ---- key-value ----

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return read<T | undefined>(KV, (s) => s.get(key));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await write(KV, (s) => {
    s.put(value, key);
  });
}

export async function kvDelete(key: string): Promise<void> {
  await write(KV, (s) => {
    s.delete(key);
  });
}

// ---- persistent storage ----

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const asked = await kvGet<boolean>(PERSIST_KEY);
    if (asked !== undefined) return asked;
    let granted = false;
    try {
      granted = (await navigator.storage?.persist?.()) === true;
    } catch {
      granted = false;
    }
    await kvSet(PERSIST_KEY, granted);
    return granted;
  } catch {
    return false;
  }
}
