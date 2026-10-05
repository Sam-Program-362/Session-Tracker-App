# Session Tracker

A small, mobile-first web app that times what you do — Work, Study, Hobby,
Ideas — and keeps the history on your own device.

Phase 1 only: **no account, no server, no login for real.** Everything lives
inside your phone's browser storage (IndexedDB). Nothing is uploaded anywhere.

---

## How to run it

```bash
bun install     # download the pieces it needs (only once)
bun run dev     # start the app on http://localhost:3000
```

To build a production copy:

```bash
bun run build
```

---

## The four screens

| Screen | What it is for |
| --- | --- |
| 1. **Log in** | A big `LOG IN` pill that just opens the app, plus a smaller `Session's Logs` pill at the bottom. |
| 2. **Categories** | Big pills with chevrons: Work, Study, Hobby, Ideas (plus any you add). Tapping one starts a session. The `New Entry / Add Category` button at the bottom saves your own categories forever. |
| 3. **Running session** | A live stopwatch. You can add a note, work through a checklist for that category, `Switch to Other` (ends this one and takes you back to the picker) or `Close Session` (optional one-line summary, then saves the log). |
| 4. **Session's Logs** | Day blocks, newest first, labelled `Today`, `Yesterday`, `2 days ago` etc. Tap a day to open a scrollable box of its sessions (category, start time, end time, duration, notes) with **totals per category** right underneath. A setting at the bottom keeps logs for 1, 2 or 3 months. |

---

## Things worth knowing

**The timer cannot drift.** The stopwatch does not count seconds in a variable.
It stores *the moment you started* (`startedAt`) and works out the difference
every time the screen redraws. If your phone locks, or you close the app and
come back tomorrow, the elapsed time is still correct — it is recomputed from
the clock, not remembered from a counter.

If you close the app mid-session, the session is still there when you return;
the app drops you straight back onto the running stopwatch.

**Records are built for a future sync.** Every record (category, session, task)
carries:

- `id` — a random UUID generated on your device (never a row number, so records
  can be merged safely later without clashing)
- `createdAt` / `updatedAt` — timestamps in milliseconds
- `deleted` — a soft-delete flag

Nothing is ever hard-deleted. Lowering the "keep logs" setting just flags old
records as deleted instead of destroying them, which is exactly what you want
when a sync layer is added later.

**Deleting is not exposed in the UI yet.** The flag is there and honoured — the
logs screen only shows records where `deleted` is false — but there is no
delete button yet. That is a deliberate Phase 2 item.

---

## Design notes

- Background fades from `#F8F9FA` to `#EDF2F7`
- Dark slate `#24292E` capsule buttons with white text
- Soft shadows, Inter throughout
- Every button presses down slightly when tapped
- Screens slide in smoothly left or right
- No emojis, badges or notifications anywhere

---

## Project layout

```
src/
  app/
    page.tsx        all four screens and the navigation between them
    layout.tsx      fonts + mobile settings
    globals.css     colours, shadows, motion
  components/
    capsule-button.tsx   the pill button
    text-input.tsx       name / colour inputs
  lib/
    types.ts        the shape of each record
    db.ts           IndexedDB read/write
    ids.ts          UUID generation
    format.ts       "1h 05m 03s", clock times, dates
    icons.ts        the SVG icons used
```

Check it before committing anything:

```bash
bun tsc -b --noEmit   # types
npx eslint src        # lint
bun run build         # production build
```