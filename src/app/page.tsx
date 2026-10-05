"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
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
  listTasks,
  saveTask,
  toggleTaskDone,
} from "@/lib/db";
import { generateId } from "@/lib/ids";
import { ICONS, PICKABLE_ICONS, type IconName } from "@/lib/icons";
import { CapsuleButton, TextInput, AuthForm } from "@/components";
import { resolveSignedIn } from "@/lib/auth-client";
import {
  formatDuration,
  formatTime12,
  formatDateShort,
  formatDayName,
} from "@/lib/format";
import type {
  Category,
  SessionLog,
  CategoryTask,
  Retention,
} from "@/lib/types";

type Screen = "login" | "categories" | "running" | "logs";

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
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [retention, setRetention] = useState<Retention>(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dir, setDir] = useState<"back" | "forward">("forward");
  // null while we are still finding out whether this device is signed in.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    const [cats, allLogs, settings] = await Promise.all([
      listCategories(),
      listSessions(),
      getSettings(),
    ]);
    setCategories(cats.filter((c) => !c.deleted));
    setLogs(allLogs);
    setRetention(settings.retentionMonths);
  }, []);

  // Load from IndexedDB once on mount and apply the retention window.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await getSettings();
      await seedDefaultCategories(generateId);
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

  // Resolve the session once on open. Online it refreshes from the cookie,
  // offline it falls back to the flag cached on the device, so a signed-in
  // user goes straight into the app either way.
  useEffect(() => {
    let alive = true;
    void resolveSignedIn().then((result) => {
      if (alive) setSignedIn(result);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const startSession = useCallback(
    async (category: Category) => {
      const now = Date.now();
      await saveSession({
        id: generateId(),
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
    },
    [reload],
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
    },
    [runningSession, reload],
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
  }, [runningSession, reload]);

  const changeRetention = useCallback(
    async (months: Retention) => {
      setRetention(months);
      await saveSettings({ retentionMonths: months });
      await pruneSessionsOlderThan(months);
      await reload();
    },
    [reload],
  );

  const activeLogs = useMemo(() => logs.filter((l) => !l.deleted), [logs]);

  // A live session always wins: this keeps the stopwatch on screen after the
  // app is closed or the phone locks, without needing an effect.
  const visibleScreen: Screen = runningSession ? "running" : screen;

  return (
    <div className="flex h-full flex-col">
      <div key={visibleScreen} className={`flex min-h-0 flex-1 flex-col screen-${dir}`}>
        {visibleScreen === "login" && (
          <LoginScreen
            onLoggedIn={() => {
              setSignedIn(true);
              go("categories");
            }}
            onOpenLogs={() => go("logs")}
          />
        )}

        {visibleScreen === "categories" && (
          <CategoriesScreen
            categories={categories}
            onSelect={startSession}
            onAddCategory={() => setSheetOpen(true)}
            onOpenLogs={() => go("logs", "back")}
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
            retentionMonths={retention}
            onSetRetention={changeRetention}
            onSelectCategory={startSession}
            onBack={() => go("login", "back")}
          />
        )}
      </div>

      {sheetOpen && (
        <AddCategorySheet
          onClose={() => setSheetOpen(false)}
          onSave={async (name, icon, color) => {
            await dbAddCategory({
              id: generateId(),
              name: name.trim(),
              icon,
              color,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              deleted: false,
            });
            setSheetOpen(false);
            await reload();
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
  onLoggedIn,
  onOpenLogs,
}: {
  onLoggedIn: () => void;
  onOpenLogs: () => void;
}) {
  // The LOG IN pill reveals the real sign in / create account form.
  const [formOpen, setFormOpen] = useState(false);

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
                onClick={() => setFormOpen(true)}
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
  onAddCategory,
  onOpenLogs,
}: {
  categories: Category[];
  onSelect: (c: Category) => void;
  onAddCategory: () => void;
  onOpenLogs: () => void;
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
            <CategoryPill key={cat.id} category={cat} onClick={() => onSelect(cat)} />
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
      </div>
    </div>
  );
}

function CategoryPill({
  category,
  onClick,
}: {
  category: Category;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="capsule-button flex w-full items-center gap-3.5 rounded-2xl border border-border/60 bg-white px-4 py-3.5 text-left shadow-soft transition hover:shadow-md"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${category.color}14`, color: category.color }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={category.icon} />
        </svg>
      </span>
      <span className="flex-1 text-base font-semibold">{category.name}</span>
      <svg className="h-5 w-5 shrink-0 text-foreground-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
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
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={category?.icon ?? ICONS.clock} />
              </svg>
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
  retentionMonths,
  onSetRetention,
  onSelectCategory,
  onBack,
}: {
  logs: SessionLog[];
  categories: Category[];
  retentionMonths: Retention;
  onSetRetention: (n: Retention) => void;
  onSelectCategory: (c: Category) => void;
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
      </div>
    </div>
  );
}

type DayGroup = {
  key: string;
  label: string;
  dateLabel: string;
  logs: SessionLog[];
};

function DayBlock({
  day,
  categories,
  expanded,
  now,
  onToggle,
  onSelectCategory,
}: {
  day: DayGroup;
  categories: Category[];
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
              const category = categories.find((c) => c.id === log.categoryId);
              return (
                <SessionRow
                  key={log.id}
                  log={log}
                  categoryName={category?.name ?? log.categoryName}
                  color={category?.color ?? "#24292e"}
                  icon={category?.icon ?? ICONS.clock}
                  now={now}
                  onClick={category ? () => onSelectCategory(category) : undefined}
                />
              );
            })}
          </div>

          {/* Totals per category, directly below the box */}
          <CategoryTotals logs={day.logs} categories={categories} now={now} />
        </div>
      ) : null}
    </div>
  );
}

function SessionRow({
  log,
  categoryName,
  color,
  icon,
  now,
  onClick,
}: {
  log: SessionLog;
  categoryName: string;
  color: string;
  icon: string;
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
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
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

function AddCategorySheet({
  onSave,
  onClose,
}: {
  onSave: (name: string, icon: string, color: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<IconName>("work");
  const [color, setColor] = useState("#24292e");

  return (
    <Sheet title="New Category" subtitle="Saved on this device permanently." onClose={onClose}>
      <div className="mt-4 space-y-4">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reading"
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground/80">Icon</span>
          <div className="flex flex-wrap gap-2">
            {PICKABLE_ICONS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setIconKey(key)}
                aria-label={key}
                aria-pressed={iconKey === key}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
                  iconKey === key
                    ? "border-primary bg-primary text-white"
                    : "border-border/60 bg-white text-foreground-muted"
                }`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[key]} />
                </svg>
              </button>
            ))}
          </div>
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
          onClick={() => void onSave(name, ICONS[iconKey], color)}
          disabled={!name.trim()}
          className="flex-1"
        >
          Save
        </CapsuleButton>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group session logs into day blocks, newest day first. */
function groupByDay(logs: SessionLog[], now: number): DayGroup[] {
  const buckets = new Map<string, SessionLog[]>();

  for (const log of logs) {
    const d = new Date(log.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const list = buckets.get(key);
    if (list) list.push(log);
    else buckets.set(key, [log]);
  }

  return Array.from(buckets.entries())
    .map(([key, items]) => {
      items.sort((a, b) => a.startedAt - b.startedAt);
      const startOfDay = new Date(items[0].startedAt);
      startOfDay.setHours(0, 0, 0, 0);
      return {
        key,
        label: relativeDayLabel(startOfDay.getTime(), now),
        dateLabel: `${formatDayName(items[0].startedAt)} ${formatDateShort(items[0].startedAt)}`,
        logs: items,
      };
    })
    .sort((a, b) => Number(b.key) - Number(a.key) || a.logs[0].startedAt - b.logs[0].startedAt)
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

function relativeDayLabel(startOfDay: number, now: number): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - startOfDay) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}