import { NextResponse } from "next/server";
import { and, eq, gt, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/server-db";
import { categories, trackerSessions } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Incoming = Record<string, unknown> & { id: string; updatedAt: number };

export async function POST(request: Request) {
  const signedIn = await auth.api.getSession({ headers: request.headers });
  if (!signedIn) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    since?: number;
    retentionMonths?: 1 | 2 | 3;
    categories?: Incoming[];
    sessions?: Incoming[];
  };
  const userId = signedIn.user.id;
  const since = Number.isFinite(body.since) ? Math.max(0, Number(body.since)) : 0;
  const retention = [1, 2, 3].includes(Number(body.retentionMonths)) ? Number(body.retentionMonths) : 1;
  const cutoff = Date.now() - retention * 30 * 86_400_000;

  for (const item of body.categories ?? []) {
    if (!item.id || !Number.isFinite(item.updatedAt)) continue;
    const current = await db.query.categories.findFirst({
      where: and(eq(categories.id, item.id), eq(categories.userId, userId)),
    });
    if (current && current.updatedAt >= item.updatedAt) continue;
    const row = {
      id: item.id,
      userId,
      name: String(item.name ?? "Category"),
      icon: String(item.icon ?? ""),
      color: String(item.color ?? "#24292e"),
      createdAt: Number(item.createdAt) || item.updatedAt,
      updatedAt: item.updatedAt,
      deleted: Boolean(item.deleted),
    };
    await db.insert(categories).values(row).onConflictDoUpdate({ target: categories.id, set: row });
  }

  for (const item of body.sessions ?? []) {
    // Running sessions are deliberately device-only until they are closed.
    if (!item.id || item.status === "running" || Number(item.startedAt) < cutoff || !Number.isFinite(item.updatedAt)) continue;
    const current = await db.query.trackerSessions.findFirst({
      where: and(eq(trackerSessions.id, item.id), eq(trackerSessions.userId, userId)),
    });
    if (current && current.updatedAt >= item.updatedAt) continue;
    const row = {
      id: item.id,
      userId,
      categoryId: String(item.categoryId),
      categoryName: String(item.categoryName ?? "Category"),
      status: "stopped",
      startedAt: Number(item.startedAt),
      endedAt: Number(item.endedAt),
      note: String(item.note ?? ""),
      summary: String(item.summary ?? ""),
      createdAt: Number(item.createdAt) || item.updatedAt,
      updatedAt: item.updatedAt,
      deleted: Boolean(item.deleted),
    };
    await db.insert(trackerSessions).values(row).onConflictDoUpdate({ target: trackerSessions.id, set: row });
  }

  // Every read is scoped to this exact user. Retention limits both download and upload.
  const [remoteCategories, remoteSessions] = await Promise.all([
    db.select().from(categories).where(and(eq(categories.userId, userId), gt(categories.updatedAt, since))),
    db.select().from(trackerSessions).where(and(
      eq(trackerSessions.userId, userId),
      gt(trackerSessions.updatedAt, since),
      gte(trackerSessions.startedAt, cutoff),
    )),
  ]);

  const stripUser = <T extends { userId: string }>(record: T) => {
    const { userId: _userId, ...safe } = record;
    void _userId;
    return safe;
  };
  return NextResponse.json({
    syncedAt: Date.now(),
    categories: remoteCategories.map(stripUser),
    sessions: remoteSessions.map(stripUser),
  });
}
