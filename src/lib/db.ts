import type { Category, SessionLog, Retention, CategoryTask } from "./types";
import { ICONS } from "./icons";

const DB_NAME = "session-tracker";
const STORE_CATEGORIES = "categories";
const STORE_SESSIONS = "sessions";
const STORE_TASKS = "tasks";

const CATEGORY_KEY = "session-tracker:settings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        db.createObjectStore(STORE_CATEGORIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
        // Secondary index so we can list sessions quickly by category.
        store.createIndex("categoryId", "categoryId", { unique: false });
        store.createIndex("deleted", "deleted", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        const store = db.createObjectStore(STORE_TASKS, { keyPath: "id" });
        store.createIndex("categoryId", "categoryId", { unique: false });
        store.createIndex("deleted", "deleted", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runInTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = work(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      })
      .catch(reject);
  });
}

// ---------------------------- Categories ----------------------------

export function listCategories(): Promise<Category[]> {
  return runInTransaction(STORE_CATEGORIES, "readonly", (store) => {
    return store.getAll() as IDBRequest<Category[]>;
  });
}

/**
 * The four categories the app ships with. They are ordinary records in the
 * same store as anything the user adds, so they behave identically.
 */
export const DEFAULT_CATEGORIES: ReadonlyArray<
  Pick<Category, "name" | "icon" | "color">
> = [
  { name: "Work", icon: ICONS.work, color: "#24292e" },
  { name: "Study", icon: ICONS.study, color: "#1f6feb" },
  { name: "Hobby", icon: ICONS.hobby, color: "#0b8b5f" },
  { name: "Ideas", icon: ICONS.ideas, color: "#6366f1" },
];

/** Seed the built-in categories the first time the app runs. */
export async function seedDefaultCategories(newId: () => string): Promise<void> {
  const existing = (await listCategories()).filter((c) => !c.deleted);
  if (existing.length > 0) return;
  const now = Date.now();
  for (const c of DEFAULT_CATEGORIES) {
    await addCategory({
      id: newId(),
      name: c.name,
      icon: c.icon,
      color: c.color,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });
  }
}

export function getCategory(id: string): Promise<Category | undefined> {
  return runInTransaction(STORE_CATEGORIES, "readonly", (store) => {
    const req = store.get(id);
    return req as IDBRequest<Category>;
  });
}

export function addCategory(category: Category): Promise<void> {
  return runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    store.put(category);
    return store as unknown as IDBRequest<void>;
  });
}

export function updateCategory(category: Category): Promise<void> {
  return runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    store.put(category);
    return store as unknown as IDBRequest<void>;
  });
}

export function deleteCategory(id: string): Promise<void> {
  return runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    store.delete(id);
    return store as unknown as IDBRequest<void>;
  });
}

// ---------------------------- Sessions ----------------------------

export function listSessions(): Promise<SessionLog[]> {
  return runInTransaction(STORE_SESSIONS, "readonly", (store) => {
    return store.getAll() as IDBRequest<SessionLog[]>;
  });
}

export function saveSession(log: SessionLog): Promise<void> {
  return runInTransaction(STORE_SESSIONS, "readwrite", (store) => {
    store.put(log);
    return store as unknown as IDBRequest<void>;
  });
}

export function deleteSession(id: string): Promise<void> {
  return runInTransaction(STORE_SESSIONS, "readwrite", (store) => {
    store.delete(id);
    return store as unknown as IDBRequest<void>;
  });
}

export function toggleSessionDeleted(id: string): Promise<void> {
  return runInTransaction(STORE_SESSIONS, "readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const log = req.result;
      if (log) {
        log.deleted = !log.deleted;
        store.put(log);
      }
    };
    return req as unknown as IDBRequest<void>;
  });
}

export function countDeletedSessions(): Promise<number> {
  return runInTransaction(STORE_SESSIONS, "readonly", (store) => {
    const index = store.index("deleted");
    const range = IDBKeyRange.only(true);
    const count = index.count(range);
    return count as unknown as IDBRequest<number>;
  });
}

/**
 * Soft-delete session logs older than the retention window.
 * Records are never hard-deleted so a future sync can still reconcile them.
 */
export async function pruneSessionsOlderThan(months: number): Promise<void> {
  const cutoff = Date.now() - months * 30 * 86_400_000;
  const all = await listSessions();
  const stale = all.filter(
    (s) => s.status === "stopped" && s.startedAt < cutoff && !s.deleted,
  );
  await Promise.all(
    stale.map((s) => saveSession({ ...s, deleted: true, updatedAt: Date.now() })),
  );
}

// ---------------------------- Tasks ----------------------------

export function listTasks(): Promise<CategoryTask[]> {
  return runInTransaction(STORE_TASKS, "readonly", (store) => {
    return store.getAll() as IDBRequest<CategoryTask[]>;
  });
}

export function saveTask(task: CategoryTask): Promise<void> {
  return runInTransaction(STORE_TASKS, "readwrite", (store) => {
    store.put(task);
    return store as unknown as IDBRequest<void>;
  });
}

export function toggleTaskDone(id: string): Promise<void> {
  return runInTransaction(STORE_TASKS, "readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const task = req.result as CategoryTask | undefined;
      if (task) {
        task.done = !task.done;
        task.updatedAt = Date.now();
        store.put(task);
      }
    };
    return req as unknown as IDBRequest<void>;
  });
}

// ---------------------------- Settings (retention) ----------------------------

export function getSettings(): Promise<{ retentionMonths: Retention }> {
  return runInTransaction(STORE_CATEGORIES, "readonly", (store) => {
    const req = store.get(CATEGORY_KEY);
    return req as unknown as IDBRequest<{ retentionMonths: Retention }>;
  });
}

export function saveSettings(
  value: { retentionMonths: Retention }
): Promise<void> {
  return runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    store.put(value, CATEGORY_KEY);
    return store as unknown as IDBRequest<void>;
  });
}
