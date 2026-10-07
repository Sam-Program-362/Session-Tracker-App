// Regression check for the built-in category seeding rules.
//
//   bun scripts/check-default-seeding.ts
//
// The bug this guards: deleting a built-in (Hobby) then logging out wiped this
// device's tombstone, so signing back in re-created Hobby with updatedAt = now —
// newer than the deletion — and the next sync overwrote the server's deleted
// row, bringing Hobby back on every device.
import {
  DEFAULT_CATEGORIES,
  SEEDED_UPDATED_AT,
  defaultCategoryId,
  missingDefaultCategories,
  newDefaultCategory,
  type DefaultCategory,
} from "../src/lib/db";
import type { Category } from "../src/lib/types";

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

const UID = "u1";
const names = (list: DefaultCategory[]): string[] => list.map((c) => c.name);
const cat = (id: string, name: string, deleted = false): Category => ({
  id,
  userId: UID,
  name,
  icon: "briefcase",
  color: "#24292e",
  createdAt: 1,
  updatedAt: 1,
  deleted,
});

// A fresh device gets all four.
check("nothing stored", names(missingDefaultCategories([], UID)), [
  "Work",
  "Study",
  "Hobby",
  "Ideas",
]);

// Hobby deleted, then a log out, then a sign-in: the pulled tombstone is what
// stops the seeding code from inventing Hobby again.
const tombstone = cat(defaultCategoryId(UID, "hobby"), "Hobby", true);
check("Hobby's tombstone suppresses Hobby", names(missingDefaultCategories([tombstone], UID)), [
  "Work",
  "Study",
  "Ideas",
]);

// The copy seeded before signing in carries a random id; it must not bring a
// deleted built-in back either.
const preLoginCopy = cat("random-hobby-id", "Hobby", false);
check(
  "a pre-login 'Hobby' copy also suppresses it",
  names(missingDefaultCategories([preLoginCopy], UID)),
  ["Work", "Study", "Ideas"]
);
check(
  "no account id yet still matches by name",
  names(missingDefaultCategories([preLoginCopy], null)),
  ["Work", "Study", "Ideas"]
);

// Renamed and then deleted: only the shared id links it to the built-in.
const renamedTombstone = cat(defaultCategoryId(UID, "hobby"), "Job", true);
check(
  "'Job' at Hobby's shared id suppresses Hobby",
  names(missingDefaultCategories([renamedTombstone], UID)),
  ["Work", "Study", "Ideas"]
);

// An unrelated user category must never suppress a built-in.
check(
  "an unrelated category changes nothing",
  names(missingDefaultCategories([cat("x", "Reading")], UID)),
  ["Work", "Study", "Hobby", "Ideas"]
);

// Seeding is per-category, not all-or-nothing.
const live = ["work", "study", "ideas"].map((slug) =>
  cat(defaultCategoryId(UID, slug), slug[0].toUpperCase() + slug.slice(1))
);
check("Hobby alone comes back", names(missingDefaultCategories(live, UID)), ["Hobby"]);
check("all four held -> nothing to seed", missingDefaultCategories([...live, tombstone], UID).length, 0);

// A seeded record is not an edit: it must never outrank a real row, so a
// tombstone always wins the merge in /api/sync (incoming <= stored -> skip).
const seeded = newDefaultCategory(DEFAULT_CATEGORIES[2], defaultCategoryId(UID, "hobby"), UID, 1);
check("updatedAt is the floor, not 'now'", seeded.updatedAt, SEEDED_UPDATED_AT);
check("...and that floor is 0", SEEDED_UPDATED_AT, 0);
check(
  "...so a tombstone from a minute ago is newer",
  Date.now() - 60_000 > seeded.updatedAt,
  true
);
check(
  "the seeded record is otherwise a normal built-in",
  [seeded.id, seeded.name, seeded.icon, seeded.deleted],
  [defaultCategoryId(UID, "hobby"), "Hobby", "palette", false]
);

console.log(`failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
