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
        // Settle when the transaction finishes, not on a request event:
        // several helpers return the store itself, so there is no request
        // event to wait for and the promise would never settle.
        t.oncomplete = () => resolve(req.result);
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
  }).then((all) =>
    // The retention setting lives in this store too; it is not a category.
    all.filter((c) => c.id !== CATEGORY_KEY)
  );
}

/**
 * The four categories the app ships with. They are ordinary records in the
 * same store as anything the user adds, so they behave identically.
 */
export const DEFAULT_CATEGORIES: ReadonlyArray<
  Pick<Category, "name" | "icon" | "color"> & { slug: string }
> = [
  { slug: "work", name: "Work", icon: ICONS.work, color: "#24292e" },
  { slug: "study", name: "Study", icon: ICONS.study, color: "#1f6feb" },
  { slug: "hobby", name: "Hobby", icon: ICONS.hobby, color: "#0b8b5f" },
  { slug: "ideas", name: "Ideas", icon: ICONS.ideas, color: "#6366f1" },
];

/**
 * The one id every device uses for a built-in category of an account:
 * "<userId>-work". The phone and the laptop then agree on the id, so syncing
 * can never create a second "Work" pill.
 */
export function defaultCategoryId(userId: string, slug: string): string {
  return `${userId}-${slug}`;
}

/** Seed the built-in categories the first time the app runs. */
export async function seedDefaultCategories(
  newId: () => string,
  userId: string | null = null
): Promise<void> {
  const existing = (await listCategories()).filter((c) => !c.deleted);
  if (existing.length > 0) return;
  const now = Date.now();
  for (const c of DEFAULT_CATEGORIES) {
    // A device that already knows its account seeds the shared ids straight
    // away; one that does not seeds random ids, renamed at first sign-in.
    const id = userId ? defaultCategoryId(userId, c.slug) : newId();
    await addCategory({
      id,
      userId,
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

/**
 * Claim every local record that has no owner for the given account.
 *
 * Data written before the first sign-in has no userId, so the first login
 * attaches it to the person who just signed in. Returns how many records
 * changed so the caller knows it has to redraw.
 */
/** Rename a record: IndexedDB keys cannot be edited in place. */
async function renameCategory(from: string, next: Category): Promise<void> {
  await runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    store.delete(from);
    store.put(next);
    return store as unknown as IDBRequest<void>;
  });
}

/**
 * Give the built-in categories their per-account id ("<userId>-work") and
 * move every session that pointed at the old id across. Without this, a
 * device that seeded the defaults before its first sign-in would push a
 * second set of Work/Study/Hobby/Ideas pills into the account.
 */
async function adoptDefaultCategories(userId: string): Promise<number> {
  const [cats, logs] = await Promise.all([listCategories(), listSessions()]);
  let changed = 0;

  for (const def of DEFAULT_CATEGORIES) {
    const cat = cats.find(
      (c) => c.name === def.name && c.icon === def.icon && c.color === def.color
    );
    if (!cat) continue;

    const to = defaultCategoryId(userId, def.slug);
    if (cat.id === to) continue;

    const taken = cats.some((c) => c.id === to);
    if (taken) {
      // The shared id already exists locally: keep it and retire the copy
      // that still carries the old random id.
      await updateCategory({ ...cat, userId, deleted: true });
    } else {
      await renameCategory(cat.id, { ...cat, id: to, userId });
    }
    changed++;

    for (const log of logs) {
      if (log.categoryId === cat.id) {
        await saveSession({ ...log, categoryId: to });
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Claim every local record that has no owner for the given account.
 *
 * Data written before the first sign-in has no userId, so the first login
 * attaches it to the person who just signed in. Returns how many records
 * changed so the caller knows it has to redraw.
 */
export async function assignMissingUserIds(userId: string): Promise<number> {
  let changed = await adoptDefaultCategories(userId);

  const [cats, logs] = await Promise.all([listCategories(), listSessions()]);
  const pending: Promise<void>[] = [];
  for (const c of cats) {
    if (!c.userId) pending.push(addCategory({ ...c, userId }));
  }
  for (const l of logs) {
    if (!l.userId) pending.push(saveSession({ ...l, userId }));
  }
  changed += pending.length;
  await Promise.all(pending);
  return changed;
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
  return runInTransaction(
    STORE_CATEGORIES,
    "readonly",
    (store) =>
      store.get(CATEGORY_KEY) as IDBRequest<
        { retentionMonths: Retention } | undefined
      >
  ).then((value) => value ?? { retentionMonths: 1 });
}

export function saveSettings(
  value: { retentionMonths: Retention }
): Promise<void> {
  return runInTransaction(STORE_CATEGORIES, "readwrite", (store) => {
    // This store keys on "id", so the settings record carries its key as a
    // field: put(value, key) is rejected on a keyPath store.
    store.put({ ...value, id: CATEGORY_KEY });
    return store as unknown as IDBRequest<void>;
  });
}
