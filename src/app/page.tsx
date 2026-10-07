"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { registerServiceWorkerOnce } from "@/lib/sw-registration";
import {
  listCategories,
  saveSession,
  listSessions,
  getSettings,
  saveSettings,
  pruneSessionsOlderThan,
  seedDefaultCategories,
  addCategory as dbAddCategory,
  updateCategory,
  assignMissingUserIds,
  listTasks,
  saveTask,
  toggleTaskDone,
  clearAllLocalData,
} from "@/lib/db";
import { generateId } from "@/lib/ids";
import {
  ICONS,
  CATEGORY_ICON_NAMES,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON,
  emojiIconValue,
  parseCategoryIcon,
  toEmojiIconValue,
  type ParsedCategoryIcon,
} from "@/lib/icons";
import { CapsuleButton, TextInput, AuthForm, CategoryIcon } from "@/components";
import {
  verifySession,
  hasSignedInBefore,
  getSignedInUserId,
  getCachedUserId,
  signOut,
} from "@/lib/auth-client";
import { syncNow, checkBeforeLogout, clearLastSyncAt } from "@/lib/sync";
import {
  formatDuration,
  formatTime12,
  formatDateShort,
  formatDayName,
  startOfLocalDay,
  localDayKey,
  relativeDayLabel,
} from "@/lib/format";
import type {
  Category,
  SessionLog,
  CategoryTask,
  Retention,
} from "@/lib/types";

type Screen = "login" | "categories" | "running" | "logs";

type LogOutResult = { ok: true } | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Re-render on an interval so the stopwatch ticks live. */
function useTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Screen router
// ---------------------------------------------------------------------------

export default function Home() {
  const [screen, setScreen] = useState<Screen>("login");
  const [categories, setCategories] = useState<Category[]>([]);
  // Every category the device still holds, deleted ones included. The logs use
  // it so a past session keeps showing the category it was recorded under.
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [retention, setRetention] = useState<Retention>(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [dir, setDir] = useState<"back" | "forward">("forward");
  // null while we are still finding out whether this device is signed in.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // Whether this device has an account remembered in local storage. This is
  // what decides "straight into the app" versus "show the form" — never the
  // network, which is only consulted in the background.
  const [deviceAccount, setDeviceAccount] = useState(false);
  // Set only when the server CLEARLY said the session is gone (401 / empty
  // session). The app keeps working; the settings line says so.
  const [sessionGone, setSessionGone] = useState(false);
  // The Better Auth account that owns every record created on this device.
  const [userId, setUserId] = useState<string | null>(null);
  // Plain-text sync status for Settings; Step 4 renders it.
  const [syncStatus, setSyncStatus] = useState<"synced" | "waiting">("waiting");

  const reload = useCallback(async () => {
    const [cats, allLogs, settings] = await Promise.all([
      listCategories(),
      listSessions(),
      getSettings(),
    ]);
    setCategories(cats.filter((c) => !c.deleted));
    setAllCategories(cats);
    setLogs(allLogs);
    setRetention(settings.retentionMonths);
  }, []);

  // Load from IndexedDB once on mount and apply the retention window.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await getSettings();
      // A device that already knows its account seeds the shared ids.
      await seedDefaultCategories(generateId, getCachedUserId());
      await pruneSessionsOlderThan(settings.retentionMonths);
      const [cats, allLogs] = await Promise.all([listCategories(), listSessions()]);
      if (!alive) return;
      setRetention(settings.retentionMonths);
      setCategories(cats.filter((c) => !c.deleted));
      setLogs(allLogs);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Register the service worker once the component hydrates on the client.
  useEffect(() => {
    registerServiceWorkerOnce();
  }, []);

  // Claim the local records for the signed-in account: remember who this
  // device belongs to, and attach anything created before the first sign-in.
  const adoptUser = useCallback(async () => {
    const uid = await getSignedInUserId();
    if (!uid) return;
    setUserId(uid);
    const claimed = await assignMissingUserIds(uid);
    if (claimed > 0) await reload();
  }, [reload]);

  // Verify the session with the server in the background. Only a clear "no
  // session" changes anything: the device then keeps its local data, stays
  // inside the app, and the settings line offers a sign-in.
  const verifyInBackground = useCallback(async () => {
    const state = await verifySession();
    if (state === "valid") {
      setSessionGone(false);
      setDeviceAccount(true);
      await adoptUser();
    } else if (state === "invalid") {
      setSessionGone(true);
      setDeviceAccount(false);
    }
    // "unknown" (offline, timeout, server error): change nothing at all.
  }, [adoptUser]);

  // Open straight into the session when this device has signed in before. The
  // decision is made from local storage, so a slow or missing connection can
  // never send a signed-in user back to the form; the server is asked
  // afterwards, in the background.
  useEffect(() => {
    const remembered = hasSignedInBefore();
    setDeviceAccount(remembered);
    setSignedIn(remembered);
    if (remembered) void verifyInBackground();
  }, [verifyInBackground]);

  // Fire-and-forget: no screen ever waits on the network. When a sync lands
  // we redraw so anything the server held shows up straight away.
  const triggerSync = useCallback(() => {
    void (async () => {
      const outcome = await syncNow();
      if (outcome.ok) {
        setSessionGone(false);
        setSyncStatus("synced");
        await reload();
        return;
      }
      // A 401 from the server is a clear answer, not a network hiccup: the
      // session is gone, so say so instead of "waiting for internet".
      if (outcome.reason === "signed-out") setSessionGone(true);
      setSyncStatus("waiting");
    })();
  }, [reload]);

  // Sync when the app opens, and again the moment the browser is back online.
  useEffect(() => {
    triggerSync();
    const onOnline = () => triggerSync();
    const onOffline = () => setSyncStatus("waiting");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [triggerSync]);

  // Enter the app directly once signed in.
  useEffect(() => {
    if (signedIn) setScreen("categories");
  }, [signedIn]);

  // Re-attach to a session that was left running (app closed / phone locked).
  const runningSession = useMemo(
    () => logs.find((l) => l.status === "running" && !l.deleted) ?? null,
    [logs],
  );

  const go = useCallback((next: Screen, dir: "back" | "forward" = "forward") => {
    setDir(dir);
    setScreen(next);
  }, []);

  // An explicit sign-in: remember the account, fetch what the account already
  // has, then put back only the built-in categories it is missing and claim
  // anything created before signing in.
  //
  // The pull comes FIRST on purpose. A log out wipes this device, so at this
  // moment we know nothing about the account — and a built-in the user deleted
  // only exists as a tombstone on the server. Pulling before we invent anything
  // brings that tombstone back, which is what tells the seeding (and the
  // adoption below) to leave it alone instead of re-creating it with a newer
  // updatedAt that would overwrite the deletion everywhere.
  const afterSignIn = useCallback(async () => {
    const uid = await getSignedInUserId();
    if (!uid) return;
    setUserId(uid);
    // Best effort: a pull that fails must not leave a new account with an empty
    // hub. Seeding after a failure is still safe, because a seeded record's
    // updatedAt floor can never outrank a real row — including a tombstone — on
    // the next sync.
    try {
      await syncNow();
    } catch {
      // Ignored on purpose; see above.
    }
    await seedDefaultCategories(generateId, uid);
    await assignMissingUserIds(uid);
    await reload();
    triggerSync();
  }, [reload, triggerSync]);

  /**
   * Log out — the one action allowed to delete this device's data.
   *
   * Nothing is removed until we know the server has a copy: online a sync
   * must succeed, and offline the device must hold no unsynced changes. Any
   * other outcome says why and leaves everything exactly as it is.
   */
  const logOut = useCallback(async (): Promise<LogOutResult> => {
    const readiness = await checkBeforeLogout();
    if (!readiness.ok) {
      const message =
        readiness.blocked === "unsynced-offline"
          ? "This device has changes that have not synced yet. Connect to the internet and sync before logging out."
          : readiness.blocked === "signed-out"
            ? "Sign in again to sync this device before logging out."
            : "Could not reach the server, so nothing was deleted. Try again in a moment.";
      return { ok: false, message };
    }

    await signOut();
    clearLastSyncAt();
    await clearAllLocalData();

    setUserId(null);
    setSignedIn(false);
    setDeviceAccount(false);
    setSessionGone(false);
    setSyncStatus("waiting");
    setCategories([]);
    setAllCategories([]);
    setLogs([]);
    setRetention(1);
    setSheetOpen(false);
    setEditingCategory(null);
    go("login", "back");
    return { ok: true };
  }, [go]);

  const startSession = useCallback(
    async (category: Category) => {
      const now = Date.now();
      await saveSession({
        id: generateId(),
        userId,
        categoryId: category.id,
        categoryName: category.name,
        status: "running",
        startedAt: now,
        endedAt: 0,
        note: "",
        summary: "",
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
      await reload();
      setDir("forward");
      setScreen("running");
      triggerSync();
    },
    [reload, userId, triggerSync],
  );

  const endSession = useCallback(
    async (summary: string) => {
      if (!runningSession) return;
      await saveSession({
        ...runningSession,
        status: "stopped",
        endedAt: Date.now(),
        summary: summary.trim(),
        updatedAt: Date.now(),
      });
      await reload();
      setDir("back");
      setScreen("logs");
      triggerSync();
    },
    [runningSession, reload, triggerSync],
  );

  // "Switch to Other" ends this session and opens the category picker.
  const switchCategory = useCallback(async () => {
    if (runningSession) {
      await saveSession({
        ...runningSession,
        status: "stopped",
        endedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await reload();
    setDir("back");
    setScreen("categories");
    triggerSync();
  }, [runningSession, reload, triggerSync]);

  const changeRetention = useCallback(
    async (months: Retention) => {
      setRetention(months);
      await saveSettings({ retentionMonths: months });
      await pruneSessionsOlderThan(months);
      await reload();
      triggerSync();
    },
    [reload, triggerSync],
  );

  const activeLogs = useMemo(() => logs.filter((l) => !l.deleted), [logs]);

  // A live session always wins: this keeps the stopwatch on screen after the
  // app is closed or the phone locks, without needing an effect.
  const visibleScreen: Screen = runningSession ? "running" : screen;

  // Nothing is decided until the LOCAL signed-in check has run, so draw the
  // plain background and no screen at all. Rendering the login screen here
  // would show it for one frame to a device that is about to go straight into
  // the app. (Every hook above has already run, so this early return is safe.)
  if (signedIn === null) {
    return <div className="flex h-full flex-col" aria-busy="true" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div key={visibleScreen} className={`flex min-h-0 flex-1 flex-col screen-${dir}`}>
        {visibleScreen === "login" && (
          <LoginScreen
            hasDeviceAccount={deviceAccount}
            onContinue={() => {
              // Straight in — the session is checked in the background.
              setSignedIn(true);
              go("categories");
              void verifyInBackground();
            }}
            onLoggedIn={() => {
              setSignedIn(true);
              setDeviceAccount(true);
              setSessionGone(false);
              go("categories");
              void afterSignIn();
            }}
            onOpenLogs={() => go("logs")}
          />
        )}

        {visibleScreen === "categories" && (
          <CategoriesScreen
            categories={categories}
            onSelect={startSession}
            onEdit={setEditingCategory}
            onAddCategory={() => setSheetOpen(true)}
            onOpenLogs={() => go("logs", "back")}
            onLogOut={logOut}
          />
        )}

        {visibleScreen === "running" && runningSession && (
          <RunningSessionScreen
            log={runningSession}
            category={categories.find((c) => c.id === runningSession.categoryId)}
            onClose={endSession}
            onSwitch={switchCategory}
          />
        )}

        {visibleScreen === "logs" && (
          <LogsScreen
            logs={activeLogs}
            categories={categories}
            allCategories={allCategories}
            retentionMonths={retention}
            syncStatus={syncStatus}
            sessionGone={sessionGone}
            onSetRetention={changeRetention}
            onSelectCategory={startSession}
            onLogOut={logOut}
            onBack={() => go("login", "back")}
          />
        )}
      </div>

      {sheetOpen && (
        <CategorySheet
          onClose={() => setSheetOpen(false)}
          onSave={async (name, icon, color) => {
            await dbAddCategory({
              id: generateId(),
              userId,
              name: name.trim(),
              icon,
              color,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              deleted: false,
            });
            setSheetOpen(false);
            await reload();
            triggerSync();
          }}
        />
      )}

      {editingCategory && (
        <CategorySheet
          key={editingCategory.id}
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onSave={async (name, icon, color) => {
            // Renaming, recolouring and re-iconing one record: the update is
            // what "newest edit wins" merges on, so it moves updatedAt.
            await updateCategory({
              ...editingCategory,
              name: name.trim(),
              icon,
              color,
              updatedAt: Date.now(),
            });
            setEditingCategory(null);
            await reload();
            triggerSync();
          }}
          onDelete={async () => {
            // Soft delete, with a fresh updatedAt, so the removal syncs to the
            // other devices instead of being undone by them.
            await updateCategory({
              ...editingCategory,
              deleted: true,
              updatedAt: Date.now(),
            });
            setEditingCategory(null);
            await reload();
            triggerSync();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — Log in
// ---------------------------------------------------------------------------

function LoginScreen({
  hasDeviceAccount,
  onContinue,
  onLoggedIn,
  onOpenLogs,
}: {
  hasDeviceAccount: boolean;
  onContinue: () => void;
  onLoggedIn: () => void;
  onOpenLogs: () => void;
}) {
  // The LOG IN pill reveals the real sign in / create account form — but only
  // on a device that has never signed in. A device with a remembered account
  // goes straight into the app; the form is never shown on the way.
  const [formOpen, setFormOpen] = useState(false);

  function handleLogIn() {
    if (hasDeviceAccount) {
      onContinue();
      return;
    }
    setFormOpen(true);
  }

  return (
    <main className="flex flex-1 flex-col safe-area-bottom">
      <div className="flex-1 overflow-y-auto px-6">
        <div className="mx-auto w-full max-w-sm py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground-muted">
            Session Tracker
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
            Time, kept where you keep it.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
            Start a stopwatch for Work, Study, Hobby or Ideas. Sign in once and
            this device stays signed in.
          </p>

          {formOpen ? (
            <AuthForm onDone={onLoggedIn} />
          ) : (
            <div className="mt-9 flex justify-center">
              <CapsuleButton
                size="lg"
                onClick={handleLogIn}
                className="w-48"
              >
                LOG IN
              </CapsuleButton>
            </div>
          )}
        </div>
      </div>

      <div className="w-full px-6 pb-10 safe-area-bottom">
        <div className="mx-auto w-full max-w-sm">
          <CapsuleButton variant="ghost" onClick={onOpenLogs} className="w-full">
            Session&apos;s Logs
          </CapsuleButton>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — Category picker
// ---------------------------------------------------------------------------

function CategoriesScreen({
  categories,
  onSelect,
  onEdit,
  onAddCategory,
  onOpenLogs,
  onLogOut,
}: {
  categories: Category[];
  onSelect: (c: Category) => void;
  onEdit: (c: Category) => void;
  onAddCategory: () => void;
  onOpenLogs: () => void;
  onLogOut: () => Promise<LogOutResult>;
}) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Start a session</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Pick a category to begin tracking.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="grid gap-3">
          {categories.map((cat) => (
            <CategoryPill
              key={cat.id}
              category={cat}
              onClick={() => onSelect(cat)}
              onEdit={() => onEdit(cat)}
            />
          ))}
        </div>

        {categories.length === 0 ? (
          <p className="mt-10 text-center text-sm text-foreground-muted">
            No categories yet. Add your first one below.
          </p>
        ) : null}
      </div>

      <div className="border-t border-border/60 px-6 py-4 safe-area-bottom">
        <CapsuleButton onClick={onAddCategory} className="w-full">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Entry / Add Category
        </CapsuleButton>
        <button
          type="button"
          onClick={onOpenLogs}
          className="mt-3 w-full text-center text-xs font-medium text-foreground-muted transition hover:text-foreground"
        >
          Session&apos;s Logs
        </button>

        {/* Same quiet text style, and the same guarded flow as Session's Logs. */}
        <div className="mt-3">
          <LogOutControl onLogOut={onLogOut} />
        </div>
      </div>
    </div>
  );
}

/**
 * The one log-out control, mounted from both Session's Logs and the category
 * hub. It owns only the confirm step and the refusal message; the guarded flow
 * itself (sync first, refuse when anything would be lost, then wipe) lives in
 * Home's logOut, so both entry points behave identically by construction.
 */
function LogOutControl({
  onLogOut,
}: {
  onLogOut: () => Promise<LogOutResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmLogOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await onLogOut();
    setBusy(false);
    if (!result.ok) {
      // Refused: stay right here and say why. Nothing was deleted.
      setConfirming(false);
      setError(result.message);
      return;
    }
    // Success returns the app to the LOG IN screen, unmounting this.
    setConfirming(false);
  }

  return (
    <div className="flex flex-col items-center">
      {confirming ? (
        <div className="w-full rounded-2xl border border-border/60 bg-white p-3.5 shadow-soft">
          <p className="text-xs leading-relaxed text-foreground-muted">
            Log out and delete the sessions stored on this device?
          </p>
          <div className="mt-3 flex gap-2">
            <CapsuleButton
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              className="flex-1"
            >
              Cancel
            </CapsuleButton>
            <CapsuleButton
              onClick={() => void confirmLogOut()}
              disabled={busy}
              className="flex-1"
            >
              {busy ? "Checking" : "Log out"}
            </CapsuleButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className="text-xs font-medium text-foreground-muted transition hover:text-foreground"
        >
          Log out
        </button>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-3 w-full rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CategoryPill({
  category,
  onClick,
  onEdit,
}: {
  category: Category;
  onClick: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-1 rounded-2xl border border-border/60 bg-white shadow-soft transition hover:shadow-md">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Start a ${category.name} session`}
        className="capsule-button flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left"
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${category.color}14`, color: category.color }}
        >
          <CategoryIcon value={category.icon} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">
          {category.name}
        </span>
      </button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${category.name}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground-faint transition hover:bg-border/40 hover:text-foreground active:scale-95"
      >
        <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      </button>

      <ChevronRight
        className="mr-3 h-5 w-5 shrink-0 text-foreground-faint"
        strokeWidth={2}
        aria-hidden="true"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Running session
// ---------------------------------------------------------------------------

function RunningSessionScreen({
  log,
  category,
  onClose,
  onSwitch,
}: {
  log: SessionLog;
  category: Category | undefined;
  onClose: (summary: string) => Promise<void>;
  onSwitch: () => Promise<void>;
}) {
  // The timer is derived from the SAVED start timestamp, never from a counter,
  // so it stays correct when the phone locks or the app is closed.
  const now = useTicker(250);
  const elapsed = Math.max(0, now - log.startedAt);
  const categoryName = category?.name ?? log.categoryName;

  const [noteOpen, setNoteOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const loadTasks = useCallback(async (): Promise<CategoryTask[]> => {
    if (!category) return [];
    const all = await listTasks();
    return all
      .filter((t) => !t.deleted && t.categoryId === category.id)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [category]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {/* Stopwatch card with soft glow */}
        <div
          className="mt-6 rounded-3xl border border-border/50 bg-white px-6 py-9 text-center"
          style={{ boxShadow: "var(--shadow-glow)" }}
        >
          <div className="flex items-center justify-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: `${category?.color ?? "#24292e"}14`, color: category?.color ?? "#24292e" }}
            >
              <CategoryIcon value={category?.icon} className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-muted">
              {categoryName}
            </span>
          </div>

          <div className="mt-6 text-[3.25rem] font-bold leading-none tabular-nums tracking-tight">
            {formatDuration(elapsed)}
          </div>
          <p className="mt-2 text-xs text-foreground-muted">
            Started at {formatTime12(Math.floor(log.startedAt / 1000))}
          </p>

          {log.note ? (
            <div className="mt-6 border-t border-border/60 pt-4 text-left">
              <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-foreground-faint">
                Note
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{log.note}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex gap-3">
          <CapsuleButton variant="ghost" onClick={() => setNoteOpen(true)} className="flex-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.note} />
            </svg>
            Add {categoryName} Note
          </CapsuleButton>
          <CapsuleButton variant="ghost" onClick={() => setTasksOpen(true)} className="flex-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.tasks} />
            </svg>
            {categoryName} Tasks
          </CapsuleButton>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border/60 px-6 py-4 safe-area-bottom">
        <div className="flex gap-3">
          <CapsuleButton variant="ghost" onClick={() => void onSwitch()} className="flex-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Switch to Other
          </CapsuleButton>
          <CapsuleButton onClick={() => setSummaryOpen(true)} className="flex-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.close} />
            </svg>
            Close Session
          </CapsuleButton>
        </div>
      </div>

      {noteOpen && (
        <NoteSheet
          initial={log.note}
          onClose={() => setNoteOpen(false)}
          onSave={async (text) => {
            await saveSession({ ...log, note: text, updatedAt: Date.now() });
            setNoteOpen(false);
          }}
        />
      )}

      {tasksOpen && (
        <TasksSheet
          categoryId={category?.id ?? log.categoryId}
          categoryName={categoryName}
          load={loadTasks}
          onClose={() => setTasksOpen(false)}
        />
      )}

      {summaryOpen && (
        <SummarySheet
          elapsed={elapsed}
          onClose={() => setSummaryOpen(false)}
          onSave={async (summary) => {
            setSummaryOpen(false);
            await onClose(summary);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — Session's logs
// ---------------------------------------------------------------------------

function LogsScreen({
  logs,
  categories,
  allCategories,
  retentionMonths,
  syncStatus,
  sessionGone,
  onSetRetention,
  onSelectCategory,
  onLogOut,
  onBack,
}: {
  logs: SessionLog[];
  categories: Category[];
  allCategories: Category[];
  retentionMonths: Retention;
  syncStatus: "synced" | "waiting";
  sessionGone: boolean;
  onSetRetention: (n: Retention) => void;
  onSelectCategory: (c: Category) => void;
  onLogOut: () => Promise<LogOutResult>;
  onBack: () => void;
}) {
  const now = useTicker(30_000);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const days = useMemo(() => groupByDay(logs, now), [logs, now]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <header className="px-6 pt-8 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-medium text-foreground-muted transition hover:text-foreground"
        >
          &larr; Back
        </button>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Session&apos;s Logs</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {logs.length === 0
            ? "No sessions recorded yet."
            : `${logs.length} session${logs.length === 1 ? "" : "s"} recorded.`}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {days.length === 0 ? (
          <p className="mt-12 text-center text-sm text-foreground-muted">
            Start a session and it will show up here.
          </p>
        ) : (
          <div className="space-y-4">
            {days.map((day) => (
              <DayBlock
                key={day.key}
                day={day}
                categories={categories}
                allCategories={allCategories}
                expanded={openDay === day.key}
                now={now}
                onToggle={() => setOpenDay(openDay === day.key ? null : day.key)}
                onSelectCategory={onSelectCategory}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 px-6 py-4 safe-area-bottom">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">
            Keep logs
          </span>
          <div className="flex gap-2">
            {([1, 2, 3] as Retention[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onSetRetention(n)}
                className={`capsule-button h-9 rounded-full px-4 text-sm font-semibold transition ${
                  retentionMonths === n
                    ? "bg-primary text-white"
                    : "border border-border/60 bg-white text-foreground-muted"
                }`}
              >
                {n} mo
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-xs text-foreground-muted">
          {sessionGone
            ? "Sign in again to sync"
            : syncStatus === "synced"
              ? "Synced"
              : "Waiting for internet"}
        </p>

        {/* Log out — the last thing in Settings, and the only destructive one. */}
        <div className="mt-4">
          <LogOutControl onLogOut={onLogOut} />
        </div>
      </div>
    </div>
  );
}

type DayGroup = {
  key: string;
  /** Local midnight of the day this block covers. */
  dayStart: number;
  label: string;
  dateLabel: string;
  logs: SessionLog[];
};

function DayBlock({
  day,
  categories,
  allCategories,
  expanded,
  now,
  onToggle,
  onSelectCategory,
}: {
  day: DayGroup;
  categories: Category[];
  allCategories: Category[];
  expanded: boolean;
  now: number;
  onToggle: () => void;
  onSelectCategory: (c: Category) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-white shadow-soft">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="flex flex-col">
          <span className="text-sm font-bold">{day.label}</span>
          <span className="text-xs text-foreground-muted">{day.dateLabel}</span>
        </span>
        <svg
          className={`h-5 w-5 shrink-0 text-foreground-faint transition-transform duration-300 ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded ? (
        <div className="border-t border-border/60 px-3 py-2">
          {/* Fixed-height scrollable session list */}
          <div className="max-h-64 space-y-1 overflow-y-auto scroll-logs pr-1">
            {day.logs.map((log) => {
              // Shown from every record the device still has, so a session
              // recorded under a category that was later deleted keeps that
              // category's name and colour instead of turning into "Category".
              const shown = allCategories.find((c) => c.id === log.categoryId);
              // Only a live category can be started again from a log row.
              const startable = categories.find((c) => c.id === log.categoryId);
              return (
                <SessionRow
                  key={log.id}
                  log={log}
                  categoryName={shown?.name ?? log.categoryName}
                  color={shown?.color ?? "#24292e"}
                  iconValue={shown?.icon}
                  now={now}
                  onClick={startable ? () => onSelectCategory(startable) : undefined}
                />
              );
            })}
          </div>

          {/* Totals per category, directly below the box */}
          <CategoryTotals logs={day.logs} categories={allCategories} now={now} />
        </div>
      ) : null}
    </div>
  );
}

function SessionRow({
  log,
  categoryName,
  color,
  iconValue,
  now,
  onClick,
}: {
  log: SessionLog;
  categoryName: string;
  color: string;
  iconValue: string | undefined;
  now: number;
  onClick?: () => void;
}) {
  const endedAt = log.status === "running" ? now : log.endedAt;
  const duration = Math.max(0, endedAt - log.startedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition enabled:hover:bg-border/40 enabled:active:scale-[0.99]"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}14`, color }}
      >
        <CategoryIcon value={iconValue} className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{categoryName}</span>
        <span className="block text-xs text-foreground-muted tabular-nums">
          {formatTime12(Math.floor(log.startedAt / 1000))} &ndash;{" "}
          {formatTime12(Math.floor(endedAt / 1000))}
        </span>
        {log.summary ? (
          <span className="mt-0.5 block truncate text-xs text-foreground-muted">
            {log.summary}
          </span>
        ) : log.note ? (
          <span className="mt-0.5 block truncate text-xs text-foreground-muted">{log.note}</span>
        ) : null}
      </span>

      <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
        {formatDuration(duration)}
      </span>
    </button>
  );
}

function CategoryTotals({
  logs,
  categories,
  now,
}: {
  logs: SessionLog[];
  categories: Category[];
  now: number;
}) {
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of logs) {
      const end = log.status === "running" ? now : log.endedAt;
      const prev = map.get(log.categoryId) ?? 0;
      map.set(log.categoryId, prev + Math.max(0, end - log.startedAt));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [logs, now]);

  if (totals.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-foreground-faint">
        Totals
      </p>
      <div className="mt-2 space-y-1">
        {totals.map(([categoryId, ms]) => {
          const category = categories.find((c) => c.id === categoryId);
          return (
            <div key={categoryId} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: category?.color ?? "#24292e" }}
                />
                {category?.name ?? "Category"}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatDuration(ms)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 px-4 pb-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-[slideUp_260ms_ease-out] rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-foreground-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-foreground-faint transition hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.close} />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NoteSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <Sheet title="Note" onClose={onClose}>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What are you working on?"
        rows={5}
        className="mt-4 w-full resize-none rounded-xl border border-input/60 bg-background px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-ring/25"
      />
      <div className="mt-4 flex gap-2">
        <CapsuleButton variant="ghost" onClick={onClose} className="flex-1">
          Cancel
        </CapsuleButton>
        <CapsuleButton onClick={() => void onSave(value)} className="flex-1">
          Save
        </CapsuleButton>
      </div>
    </Sheet>
  );
}

function TasksSheet({
  categoryId,
  categoryName,
  load,
  onClose,
}: {
  categoryId: string;
  categoryName: string;
  load: () => Promise<CategoryTask[]>;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<CategoryTask[]>([]);
  const [value, setValue] = useState("");

  useEffect(() => {
    let alive = true;
    void load().then((list) => {
      if (alive) setTasks(list);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setTasks(await load());
  }, [load]);

  return (
    <Sheet title={`${categoryName} Tasks`} subtitle="Reusable checklist for this category." onClose={onClose}>
      <div className="mt-4 max-h-56 space-y-1 overflow-y-auto scroll-logs">
        {tasks.length === 0 ? (
          <p className="text-sm text-foreground-muted">Nothing here yet.</p>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={async () => {
                await toggleTaskDone(task.id);
                await refresh();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition active:scale-[0.99] hover:bg-border/40"
            >
              <span className={`task-checkbox shrink-0 ${task.done ? "checked" : ""}`}>
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.check} />
                </svg>
              </span>
              <span
                className={`text-sm ${
                  task.done ? "text-foreground-muted line-through" : "text-foreground"
                }`}
              >
                {task.text}
              </span>
            </button>
          ))
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = value.trim();
          if (!text) return;
          const now = Date.now();
          await saveTask({
            id: generateId(),
            categoryId,
            text,
            done: false,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          });
          setValue("");
          await refresh();
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a task"
          className="flex-1 rounded-xl border border-input/60 bg-background px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-ring/25"
        />
        <CapsuleButton type="submit" aria-label="Add task">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.add} />
          </svg>
          Add
        </CapsuleButton>
      </form>
    </Sheet>
  );
}

function SummarySheet({
  elapsed,
  onSave,
  onClose,
}: {
  elapsed: number;
  onSave: (summary: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Sheet
      title="Close Session"
      subtitle={`Tracked ${formatDuration(elapsed)}. A summary is optional.`}
      onClose={onClose}
    >
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What did you get done?"
        rows={3}
        className="mt-4 w-full resize-none rounded-xl border border-input/60 bg-background px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-ring/25"
      />
      <div className="mt-4 flex gap-2">
        <CapsuleButton variant="ghost" onClick={onClose} className="flex-1">
          Keep Going
        </CapsuleButton>
        <CapsuleButton onClick={() => void onSave(value)} className="flex-1">
          Save Log
        </CapsuleButton>
      </div>
    </Sheet>
  );
}

/**
 * One sheet for both jobs: a new category, and an existing one (which can also
 * be renamed, recoloured, re-iconed or deleted).
 */
function CategorySheet({
  category,
  onSave,
  onDelete,
  onClose,
}: {
  category?: Category;
  onSave: (name: string, icon: string, color: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  // An existing category opens on the picture it already has; a new one starts
  // on the default icon (never on the "unrecognised value" fallback).
  const initialIcon: ParsedCategoryIcon = category
    ? parseCategoryIcon(category.icon)
    : { kind: "icon", name: DEFAULT_CATEGORY_ICON };
  const [name, setName] = useState(category?.name ?? "");
  // Either an icon name ("briefcase") or a stored emoji ("emoji:🎨") — the
  // same string the record keeps, so nothing has to be translated on save.
  const [iconValue, setIconValue] = useState<string>(
    initialIcon.kind === "emoji" ? emojiIconValue(initialIcon.emoji) : initialIcon.name
  );
  const [emojiText, setEmojiText] = useState(
    initialIcon.kind === "emoji" ? initialIcon.emoji : ""
  );
  const [color, setColor] = useState(category?.color ?? "#24292e");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const typedEmoji = toEmojiIconValue(emojiText);
  const editing = Boolean(category);

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    await onSave(name.trim(), iconValue, color);
    setBusy(false);
  }

  async function remove() {
    if (busy || !onDelete) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
  }

  return (
    <Sheet
      title={editing ? "Edit Category" : "New Category"}
      subtitle={
        editing
          ? "Rename it, give it a new look, or delete it."
          : "Saved on this device permanently."
      }
      onClose={onClose}
    >
      <div className="mt-4 space-y-4">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reading"
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground/80">
            Icon or emoji
          </span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ICON_NAMES.map((key) => {
              const Icon = CATEGORY_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setIconValue(key);
                    setEmojiText("");
                  }}
                  aria-label={key}
                  aria-pressed={iconValue === key}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
                    iconValue === key
                      ? "border-primary bg-primary text-white"
                      : "border-border/60 bg-white text-foreground-muted"
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </button>
              );
            })}
          </div>

          {/* Any emoji from the phone keyboard, kept in the same icon field. */}
          <div className="mt-1 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-white text-xl">
              <CategoryIcon value={iconValue} className="h-6 w-6 text-xl" />
            </span>
            <input
              aria-label="Use an emoji instead of an icon"
              value={emojiText}
              onChange={(e) => {
                const next = e.target.value;
                setEmojiText(next);
                const emoji = toEmojiIconValue(next);
                if (emoji) setIconValue(emoji);
              }}
              placeholder="…or type one emoji"
              className="min-w-0 flex-1 rounded-xl border border-input/70 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-input/80 focus:ring-2 focus:ring-ring/30"
            />
          </div>
          {emojiText.trim() && !typedEmoji ? (
            <p className="text-xs text-foreground-muted">
              One emoji, or pick an icon above.
            </p>
          ) : null}
        </div>

        <TextInput
          label="Colour"
          type="color"
          color={color}
          onColorChange={(e) => setColor(e.target.value)}
        />
      </div>

      <div className="mt-5 flex gap-2">
        <CapsuleButton variant="ghost" onClick={onClose} className="flex-1">
          Cancel
        </CapsuleButton>
        <CapsuleButton
          onClick={() => void save()}
          disabled={!name.trim() || busy}
          className="flex-1"
        >
          {busy ? "Saving" : "Save"}
        </CapsuleButton>
      </div>

      {onDelete ? (
        confirmingDelete ? (
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-red-700">
              Delete {category?.name}? The sessions you already recorded keep
              their name and totals.
            </p>
            <div className="mt-2.5 flex gap-2">
              <CapsuleButton
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                className="flex-1"
              >
                Keep
              </CapsuleButton>
              <CapsuleButton
                onClick={() => void remove()}
                disabled={busy}
                className="flex-1"
              >
                {busy ? "Deleting" : "Delete"}
              </CapsuleButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="mt-3 w-full text-center text-xs font-medium text-red-700 transition hover:text-red-800"
          >
            Delete category
          </button>
        )
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group session logs into the DEVICE's local calendar days, newest day first.
 *
 * Day identity, the label and the printed date all come from the same local
 * day start, so a block can never say "Today" over another day's date.
 */
function groupByDay(logs: SessionLog[], now: number): DayGroup[] {
  const buckets = new Map<string, { dayStart: number; logs: SessionLog[] }>();

  for (const log of logs) {
    const key = localDayKey(log.startedAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.logs.push(log);
    else buckets.set(key, { dayStart: startOfLocalDay(log.startedAt), logs: [log] });
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      bucket.logs.sort((a, b) => a.startedAt - b.startedAt);
      return {
        key,
        dayStart: bucket.dayStart,
        label: relativeDayLabel(bucket.dayStart, now),
        dateLabel: `${formatDayName(bucket.dayStart)} ${formatDateShort(bucket.dayStart)}`,
        logs: bucket.logs,
      };
    })
    // Newest day first: an explicit number, never a string comparison of an
    // unpadded key (which put Oct 6 above Oct 30, and Jan above Dec).
    .sort((a, b) => b.dayStart - a.dayStart);
}