// Client half of Phase 4 — device <-> Neon sync.
//
// Rules this module keeps:
//   - nothing here blocks the UI: every entry point is fire-and-forget;
//   - a session that is still running is never uploaded;
//   - records older than the retention setting are neither sent nor applied;
//   - lastSyncAt is the SERVER's clock (the serverTime in the reply), never
//     the device's own clock.

import {
  addCategory,
  getSettings,
  listCategories,
  listSessions,
  saveSession,
  updateCategory,
} from "./db";
import { getSignedInUserId } from "./auth-client";
import type { Category, Retention, SessionLog } from "./types";

const LAST_SYNC_KEY = "session-tracker:last-sync-at";

export type SyncOutcome =
  | { ok: true; pulled: number }
  | { ok: false; reason: "offline" | "signed-out" | "error" };

/** When the device last successfully synced (epoch ms), or null the first time. */
export function getLastSyncAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Drop the stored watermark.
 *
 * Called when the device is wiped on log out: the watermark belongs to the
 * account that just left, and keeping it would make the next account's pull
 * start from somebody else's clock.
 */
export function clearLastSyncAt(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    // Private mode: there was nothing durable to remove.
  }
}

function setLastSyncAt(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SYNC_KEY, String(value));
  } catch {
    // Private mode: the next sync simply pulls a little more than it needs to.
  }
}

/** Same window the app uses to soft-delete old logs. */
function retentionCutoff(months: Retention): number {
  return Date.now() - months * 30 * 86_400_000;
}

/** Why logging out is not safe right now. */
export type LogoutBlocker =
  /** Offline, with records that have never reached the server. */
  | "unsynced-offline"
  /** Online, but the sync itself failed, so we cannot claim a clean copy. */
  | "sync-failed"
  /** The session is gone, so there is nothing to sync with. */
  | "signed-out";

/**
 * Can this device be wiped without losing anything?
 *
 * Online, the only trustworthy answer comes from a real sync, so one is run
 * and must succeed. Offline, the device is inspected instead: anything edited
 * after the last successful sync — and any stopwatch still running, which is
 * never uploaded — would be destroyed, so it must not be allowed.
 */
export async function checkBeforeLogout(): Promise<
  { ok: true } | { ok: false; blocked: LogoutBlocker }
> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return (await hasUnsyncedChanges())
      ? { ok: false, blocked: "unsynced-offline" }
      : { ok: true };
  }

  const outcome = await syncNow();
  if (outcome.ok) return { ok: true };
  return {
    ok: false,
    blocked: outcome.reason === "signed-out" ? "signed-out" : "sync-failed",
  };
}

/**
 * Records that sync has not put on the server yet: everything edited after
 * the last successful sync, plus a session that is still running.
 */
async function hasUnsyncedChanges(): Promise<boolean> {
  const [cats, logs] = await Promise.all([listCategories(), listSessions()]);
  if (logs.some((l) => l.status === "running" && !l.deleted)) return true;
  // No watermark means this device has never completed a sync, so every
  // record it holds is still unsynced.
  const watermark = getLastSyncAt() ?? 0;
  return (
    cats.some((c) => c.updatedAt > watermark) ||
    logs.some((l) => l.updatedAt > watermark)
  );
}

let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Start a sync. Callers never await it for rendering; overlapping calls share
 * the one already in flight so a burst of saves cannot stack up requests.
 */
export function syncNow(): Promise<SyncOutcome> {
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// ---------------------------------------------------------------------------
// Payloads — what crosses the wire (epoch ms, no userId: the server decides).
// ---------------------------------------------------------------------------

type CategoryPayload = {
  id: string;
  name: string;
  icon: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

type SessionPayload = {
  id: string;
  categoryId: string;
  categoryName: string;
  status: string;
  startedAt: number;
  endedAt: number;
  note: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

function toCategoryPayload(c: Category): CategoryPayload {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deleted: c.deleted,
  };
}

function toSessionPayload(s: SessionLog): SessionPayload {
  return {
    id: s.id,
    categoryId: s.categoryId,
    categoryName: s.categoryName,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    note: s.note,
    summary: s.summary,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deleted: s.deleted,
  };
}

// ---------------------------------------------------------------------------
// Running a sync
// ---------------------------------------------------------------------------

async function runSync(): Promise<SyncOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, reason: "offline" };
  }

  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, reason: "signed-out" };

  const settings = await getSettings();
  const cutoff = retentionCutoff(settings.retentionMonths);

  const [cats, logs] = await Promise.all([listCategories(), listSessions()]);
  // Records still owned by nobody are ours to upload; the server rewrites
  // userId from the session cookie either way.
  const owned = (r: { userId: string | null }) => !r.userId || r.userId === userId;

  const body = {
    lastSyncAt: getLastSyncAt(),
    categories: cats.filter(owned).map(toCategoryPayload),
    sessions: logs
      .filter(owned)
      // An ACTIVE session stays on the device until it is closed.
      .filter((l) => l.status !== "running" && l.startedAt >= cutoff)
      .map(toSessionPayload),
  };

  let response: Response;
  try {
    response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (!response.ok) {
    return { ok: false, reason: response.status === 401 ? "signed-out" : "error" };
  }

  let reply: {
    serverTime?: number;
    categories?: unknown;
    sessions?: unknown;
  };
  try {
    reply = (await response.json()) as typeof reply;
  } catch {
    return { ok: false, reason: "error" };
  }

  const pulled = await applyIncoming(userId, reply, cutoff);
  if (typeof reply.serverTime === "number" && Number.isFinite(reply.serverTime)) {
    setLastSyncAt(reply.serverTime);
  }
  return { ok: true, pulled };
}

// ---------------------------------------------------------------------------
// Merging what the server sent back
// ---------------------------------------------------------------------------

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toCategory(raw: unknown): Category | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<Category>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  return {
    id: r.id,
    userId: typeof r.userId === "string" ? r.userId : null,
    name: typeof r.name === "string" ? r.name : "",
    icon: typeof r.icon === "string" ? r.icon : "",
    color: typeof r.color === "string" ? r.color : "",
    createdAt: numberOr(r.createdAt, 0),
    updatedAt: numberOr(r.updatedAt, 0),
    deleted: r.deleted === true,
  };
}

function toSession(raw: unknown): SessionLog | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<SessionLog>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.categoryId !== "string") return null;
  return {
    id: r.id,
    userId: typeof r.userId === "string" ? r.userId : null,
    categoryId: r.categoryId,
    categoryName: typeof r.categoryName === "string" ? r.categoryName : "",
    status: r.status === "running" ? "running" : "stopped",
    startedAt: numberOr(r.startedAt, 0),
    endedAt: numberOr(r.endedAt, 0),
    note: typeof r.note === "string" ? r.note : "",
    summary: typeof r.summary === "string" ? r.summary : "",
    createdAt: numberOr(r.createdAt, 0),
    updatedAt: numberOr(r.updatedAt, 0),
    deleted: r.deleted === true,
  };
}

/**
 * Write the server's copy into IndexedDB, newest edit wins: the local record
 * is only replaced when the incoming updatedAt is strictly newer. Returns how
 * many local records actually changed.
 */
async function applyIncoming(
  userId: string,
  reply: { categories?: unknown; sessions?: unknown },
  cutoff: number
): Promise<number> {
  const incomingCats = Array.isArray(reply.categories) ? reply.categories : [];
  const incomingLogs = Array.isArray(reply.sessions) ? reply.sessions : [];
  if (incomingCats.length === 0 && incomingLogs.length === 0) return 0;

  const [localCats, localLogs] = await Promise.all([
    listCategories(),
    listSessions(),
  ]);
  const catsById = new Map(localCats.map((c) => [c.id, c]));
  const logsById = new Map(localLogs.map((l) => [l.id, l]));
  let applied = 0;

  for (const raw of incomingCats) {
    const row = toCategory(raw);
    if (!row) continue;
    const local = catsById.get(row.id);
    if (local && local.updatedAt >= row.updatedAt) continue;
    await updateCategory({ ...row, userId });
    applied++;
  }

  for (const raw of incomingLogs) {
    const row = toSession(raw);
    if (!row) continue;
    // Retention applies in both directions: out-of-window logs are not shown
    // on this device, so they are not pulled into it either.
    if (row.startedAt < cutoff) continue;
    const local = logsById.get(row.id);
    if (local && local.updatedAt >= row.updatedAt) continue;
    await saveSession({ ...row, userId });
    applied++;
  }

  return applied;
}
