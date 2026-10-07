import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { createDb, schema } from "@/db";

/**
 * Phase 4 — device <-> Neon sync.
 *
 * Request:  { lastSyncAt?: number, categories: [...], sessions: [...] }
 * Response: { serverTime, categories: [...], sessions: [...] }
 *
 * Timestamps cross the wire as epoch milliseconds, the same unit the device
 * stores; they are converted to timestamp(3) here.
 *
 * updatedAt is only ever the device's edit time and drives "newest edit
 * wins". The pull is keyed on serverUpdatedAt (the database clock), so a
 * record cannot be missed because a device clock is behind, and the
 * serverTime handed back comes from that same clock for the next lastSyncAt.
 *
 * Two rules are absolute:
 *   - the account comes from the Better Auth session cookie, never from the
 *     payload, so a client cannot write into somebody else's data;
 *   - every statement is scoped by that account id.
 */

/** One round trip per record, so keep a sync payload sane. */
const MAX_RECORDS = 500;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_RECORDS) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Epoch ms from a client number or a Postgres/ISO timestamp string. */
function parseMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const zoned = /(?:Z|[+-]\d{2}(?::\d{2})?)$/.test(normalized)
      ? normalized
      : `${normalized}Z`;
    const ms = Date.parse(zoned);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** ISO string for a timestamp(3) column, falling back to `fallback`. */
function toIso(value: unknown, fallback: string): string {
  const ms = parseMs(value);
  return ms === null ? fallback : new Date(ms).toISOString();
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isObject(body)) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const lastSyncAt = parseMs(body.lastSyncAt);
  const sinceIso =
    lastSyncAt === null ? "1970-01-01T00:00:00.000Z" : new Date(lastSyncAt).toISOString();

  const db = createDb();

  // Read the database clock BEFORE writing anything. The device stores this
  // as its next lastSyncAt, so taking it first means nothing written in this
  // request can land below the watermark: worst case a row is handed back
  // once more (the merge ignores it) instead of being skipped forever.
  const [clockRow] = await db
    .select({ now: sql<string>`now()` })
    .from(schema.user)
    .limit(1);
  const serverTime = (clockRow ? parseMs(clockRow.now) : null) ?? Date.now();

  // ------------------------------------------------------------------
  // 1. Save what the device changed (upsert, newest wins, owner forced).
  // ------------------------------------------------------------------
  for (const raw of asArray(body.categories)) {
    if (!isObject(raw)) continue;
    const id = asString(raw.id);
    if (!id) continue;

    const updatedAt = toIso(raw.updatedAt, nowIso);
    const createdAt = toIso(raw.createdAt, updatedAt);

    const [stored] = await db
      .select({ updatedAt: schema.categories.updatedAt })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.userId, userId)
        )
      )
      .limit(1);

    if (stored) {
      const storedMs = parseMs(stored.updatedAt);
      const incomingMs = parseMs(updatedAt);
      if (storedMs === null || incomingMs === null || incomingMs <= storedMs) {
        continue; // stale — the server copy is already newer
      }
      await db
        .update(schema.categories)
        .set({
          name: asString(raw.name),
          icon: asString(raw.icon),
          color: asString(raw.color),
          createdAt,
          updatedAt,
          serverUpdatedAt: sql`now()`,
          deleted: raw.deleted === true,
          userId,
        })
        .where(
          and(
            eq(schema.categories.id, id),
            eq(schema.categories.userId, userId)
          )
        );
    } else {
      // onConflictDoNothing: an id that belongs to another account is left
      // untouched instead of raising or leaking across users.
      await db
        .insert(schema.categories)
        .values({
          id,
          userId,
          name: asString(raw.name),
          icon: asString(raw.icon),
          color: asString(raw.color),
          createdAt,
          updatedAt,
          serverUpdatedAt: sql`now()`,
          deleted: raw.deleted === true,
        })
        .onConflictDoNothing({ target: schema.categories.id });
    }
  }

  for (const raw of asArray(body.sessions)) {
    if (!isObject(raw)) continue;
    const id = asString(raw.id);
    if (!id) continue;

    // A stopwatch still running on the device is not uploadable yet; it only
    // reaches the server once it is closed (status "stopped").
    const status = raw.status === "running" ? "running" : "stopped";
    if (status === "running") continue;

    const updatedAt = toIso(raw.updatedAt, nowIso);
    const createdAt = toIso(raw.createdAt, updatedAt);
    const startedAt = toIso(raw.startedAt, createdAt);
    const endedMs = parseMs(raw.endedAt);
    const endedAt = endedMs && endedMs > 0 ? new Date(endedMs).toISOString() : null;

    const [stored] = await db
      .select({ updatedAt: schema.sessions.updatedAt })
      .from(schema.sessions)
      .where(
        and(eq(schema.sessions.id, id), eq(schema.sessions.userId, userId))
      )
      .limit(1);

    if (stored) {
      const storedMs = parseMs(stored.updatedAt);
      const incomingMs = parseMs(updatedAt);
      if (storedMs === null || incomingMs === null || incomingMs <= storedMs) {
        continue;
      }
      await db
        .update(schema.sessions)
        .set({
          categoryId: asString(raw.categoryId),
          categoryName: asString(raw.categoryName),
          status,
          startedAt,
          endedAt,
          note: asString(raw.note),
          summary: asString(raw.summary),
          createdAt,
          updatedAt,
          serverUpdatedAt: sql`now()`,
          deleted: raw.deleted === true,
          userId,
        })
        .where(
          and(eq(schema.sessions.id, id), eq(schema.sessions.userId, userId))
        );
    } else {
      await db
        .insert(schema.sessions)
        .values({
          id,
          userId,
          categoryId: asString(raw.categoryId),
          categoryName: asString(raw.categoryName),
          status,
          startedAt,
          endedAt,
          note: asString(raw.note),
          summary: asString(raw.summary),
          createdAt,
          updatedAt,
          serverUpdatedAt: sql`now()`,
          deleted: raw.deleted === true,
        })
        .onConflictDoNothing({ target: schema.sessions.id });
    }
  }

  // ------------------------------------------------------------------
  // 2. Hand back everything this account changed since the device synced.
  // ------------------------------------------------------------------
  const serverCategories = await db
    .select()
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.userId, userId),
        gt(schema.categories.serverUpdatedAt, sinceIso)
      )
    )
    .orderBy(schema.categories.updatedAt);

  const serverSessions = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        gt(schema.sessions.serverUpdatedAt, sinceIso)
      )
    )
    .orderBy(schema.sessions.updatedAt);

  return NextResponse.json({
    serverTime,
    categories: serverCategories.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      icon: row.icon,
      color: row.color,
      createdAt: parseMs(row.createdAt) ?? 0,
      updatedAt: parseMs(row.updatedAt) ?? 0,
      deleted: row.deleted,
    })),
    sessions: serverSessions.map((row) => ({
      id: row.id,
      userId: row.userId,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      status: row.status,
      startedAt: parseMs(row.startedAt) ?? 0,
      endedAt: row.endedAt ? (parseMs(row.endedAt) ?? 0) : 0,
      note: row.note ?? "",
      summary: row.summary ?? "",
      createdAt: parseMs(row.createdAt) ?? 0,
      updatedAt: parseMs(row.updatedAt) ?? 0,
      deleted: row.deleted,
    })),
  });
}
