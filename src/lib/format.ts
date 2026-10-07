// Format milliseconds into h/m/s, e.g. "1h 05m 03s".
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

// Format a UTC timestamp into a 12-hour clock with AM/PM, e.g. "3:42 PM".
export function formatTime12(secondsSinceEpoch: number): string {
  const d = new Date(secondsSinceEpoch * 1000);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Format an epoch-MILLISECOND timestamp into a short date, e.g. "Oct 5".
//
// Milliseconds, because that is the unit every record stores. These two used
// to take seconds and multiply by 1000, while the logs passed milliseconds —
// which printed a weekday and date from the year 58737.
export function formatDateShort(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Format an epoch-MILLISECOND timestamp into a weekday name, e.g. "Thursday".
export function formatDayName(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    weekday: "long",
  });
}

// ---------------------------------------------------------------------------
// Local calendar days
//
// Everything below works on the DEVICE's local calendar date, and counts whole
// DAYS rather than elapsed hours, so 23:50 yesterday is "Yesterday" next to
// 00:10 today, and a 23- or 25-hour daylight-saving day still counts as one.
// ---------------------------------------------------------------------------

/** Local midnight of the calendar day an instant falls in. */
export function startOfLocalDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A key for the LOCAL calendar day, e.g. "2026-10-07".
 * Zero-padded, so these also compare and sort chronologically as strings.
 */
export function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The local calendar day as a whole day number, built from the local year,
 * month and day. Two instants on the same local day give the same number, and
 * the difference between two numbers is a count of days — never of hours.
 */
export function localDayNumber(epochMs: number): number {
  const d = new Date(epochMs);
  return Math.round(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
  );
}

/** "Today" / "Yesterday" / "N days ago" for a day that started at dayStartMs. */
export function relativeDayLabel(dayStartMs: number, nowMs: number): string {
  const days = localDayNumber(nowMs) - localDayNumber(dayStartMs);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
