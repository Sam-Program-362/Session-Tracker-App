import { addCategory, getSettings, listCategories, listSessions, saveSession, saveSettings } from "./db";
import type { Category, SessionLog } from "./types";

export type SyncState = "synced" | "offline" | "syncing";

export async function syncNow(onState?: (state: SyncState) => void): Promise<void> {
  if (!navigator.onLine) { onState?.("offline"); return; }
  onState?.("syncing");
  try {
    const [localCategories, localSessions, settings] = await Promise.all([
      listCategories(), listSessions(), getSettings(),
    ]);
    const cutoff = Date.now() - settings.retentionMonths * 30 * 86_400_000;
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        since: settings.lastSyncAt ?? 0,
        retentionMonths: settings.retentionMonths,
        categories: localCategories.filter((r) => r.updatedAt > (settings.lastSyncAt ?? 0)),
        sessions: localSessions.filter((r) => r.status === "stopped" && r.startedAt >= cutoff && r.updatedAt > (settings.lastSyncAt ?? 0)),
      }),
    });
    if (response.status === 401) return; // Offline-local access can outlive the server cookie.
    if (!response.ok) throw new Error("Sync failed");
    const data = await response.json() as { syncedAt: number; categories: Category[]; sessions: SessionLog[] };
    const categoryMap = new Map(localCategories.map((r) => [r.id, r]));
    const sessionMap = new Map(localSessions.map((r) => [r.id, r]));
    await Promise.all(data.categories.map((remote) => {
      const local = categoryMap.get(remote.id);
      return !local || remote.updatedAt > local.updatedAt ? addCategory(remote) : Promise.resolve();
    }));
    await Promise.all(data.sessions.map((remote) => {
      const local = sessionMap.get(remote.id);
      // Never replace an active session on this device.
      return (!local || (local.status !== "running" && remote.updatedAt > local.updatedAt)) ? saveSession(remote) : Promise.resolve();
    }));
    await saveSettings({ ...settings, lastSyncAt: data.syncedAt });
    onState?.("synced");
  } catch {
    onState?.(navigator.onLine ? "offline" : "offline");
  }
}
