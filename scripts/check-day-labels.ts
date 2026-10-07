// Regression check for the Session's Logs day labels.
//
//   bun scripts/check-day-labels.ts
//
// The bug this guards: the date helpers multiplied their argument by 1000 while
// the logs handed them milliseconds, so a block could read "Today" over a
// weekday and date from the year 58737.
import {
  relativeDayLabel,
  startOfLocalDay,
  localDayKey,
  formatDayName,
  formatDateShort,
} from "../src/lib/format";

let failures = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${
      ok ? "" : ` (wanted ${JSON.stringify(want)})`
    }`
  );
}

/** A local wall-clock instant, so the cases do not depend on the runner's date. */
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m, d, h, min, 0, 0).getTime();

const label = (startMs: number, nowMs: number): string =>
  relativeDayLabel(startOfLocalDay(startMs), nowMs);

const now = at(2026, 9, 7); // Wednesday 7 October 2026, local noon

// 23:50 yesterday and 00:10 today are twenty minutes apart and two days apart.
check("23:50 yesterday", label(at(2026, 9, 6, 23, 50), now), "Yesterday");
check("00:10 today", label(at(2026, 9, 7, 0, 10), now), "Today");
check(
  "...they are different local days",
  localDayKey(at(2026, 9, 6, 23, 50)) !== localDayKey(at(2026, 9, 7, 0, 10)),
  true
);

check("2 days ago", label(at(2026, 9, 5, 9, 0), now), "2 days ago");

// Across a month boundary (2 days left in September + 7 in October).
check("Sep 28, seen on Oct 7", label(at(2026, 8, 28, 8, 0), now), "9 days ago");
check("Sep 25, seen on Oct 2", label(at(2026, 8, 25, 8, 0), at(2026, 9, 2)), "7 days ago");
check("Oct 31, seen on Nov 1", label(at(2026, 9, 31, 23, 0), at(2026, 10, 1, 9, 0)), "Yesterday");

// Across a year boundary.
check(
  "Dec 31 2026, seen on Jan 2 2027",
  label(at(2026, 11, 31, 22, 0), at(2027, 0, 2, 9, 0)),
  "2 days ago"
);
check(
  "Dec 31 2026, seen on Jan 1 2027",
  label(at(2026, 11, 31, 22, 0), at(2027, 0, 1, 9, 0)),
  "Yesterday"
);

// The printed date must be the LOCAL date of the day the block covers.
check("weekday of 7 Oct 2026", formatDayName(startOfLocalDay(now)), "Wednesday");
check("short date of 7 Oct 2026", formatDateShort(startOfLocalDay(now)), "Oct 7");
check("23:50 yesterday prints yesterday", formatDateShort(startOfLocalDay(at(2026, 9, 6, 23, 50))), "Oct 6");
check("31 Dec prints 31 Dec", formatDateShort(startOfLocalDay(at(2026, 11, 31, 22, 0))), "Dec 31");
check("1 Jan prints 1 Jan", formatDateShort(startOfLocalDay(at(2027, 0, 1, 3, 0))), "Jan 1");

// Day keys are padded, so they also sort chronologically.
check("key of 7 Oct 2026", localDayKey(now), "2026-10-07");
check("Oct 6 sorts before Oct 30", localDayKey(at(2026, 9, 6)) < localDayKey(at(2026, 9, 30)), true);
check("Jan 2027 sorts after Dec 2026", localDayKey(at(2026, 11, 31)) < localDayKey(at(2027, 0, 1)), true);
check(
  "a whole local day shares one key",
  localDayKey(at(2026, 9, 7, 0, 0)) === localDayKey(at(2026, 9, 7, 23, 59)),
  true
);

console.log(`failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
