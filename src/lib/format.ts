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

// Format a UTC timestamp into a short date, e.g. "Oct 5".
export function formatDateShort(secondsSinceEpoch: number): string {
  const d = new Date(secondsSinceEpoch * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Format a UTC timestamp into a weekday name, e.g. "Thursday".
export function formatDayName(secondsSinceEpoch: number): string {
  const d = new Date(secondsSinceEpoch * 1000);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
  });
}
