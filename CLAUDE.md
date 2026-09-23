@AGENTS.md

# Yumego — project guide

Bilingual (Japanese/English UI text, Thai-speaking operator) preschool
attendance & operations app for two branches, deployed on Vercel at
https://yumego.vercel.app. Next.js App Router + TypeScript + Tailwind
CSS v4. Google Sheets is the entire backing store (no database) via
`src/lib/sheets.ts`.

## Domain model

- Branches are hardcoded: `type Branch = "プロンポン" | "トンロー"` in
  `src/lib/classes.ts` (プロンポン = Phrom Phong, トンロー = Thong Lo).
  `CLASSES` is the fixed 6-class continuum (3 grades × 2 branches:
  年少/年中/年長 = younger/middle/older). "Extra" classes (e.g.
  トンロー　小学生) are Master-managed and live via `useExtraClasses()` /
  the `ExtraClass` type in `sheets.ts` instead.
- **Class name strings use a FULL-WIDTH space** (`　`, U+3000) between
  branch and grade, e.g. `"プロンポン　年長"`. Always split/join with
  this exact character — a regular space silently breaks matching.
  Watch for this in shell/curl test payloads too (see Gotchas below).
- The device's selected class persists in `localStorage` via
  `useSelectedClass()` (device-locked, not per-login-session).
- Bus pattern & override system (`src/lib/sheets.ts`,
  `dashboard/pickup/page.tsx`): `StudentBusPattern` is weekly
  (`arrivalMode`/`departureMode`, each `"bus"|"self"`, though the UI
  presents it as "monthly" — the UI just writes the same value across
  every week in that month). `StudentBusOverride` is a single date,
  always both legs together (no single-leg update in the API — reuse
  `effectiveModeForDate()`'s current value for the leg you're not
  touching). Override wins wholesale over pattern when present.

## Established UI conventions — reuse these, don't reinvent

- **Custom `<Select>`** (`src/components/Select.tsx`) instead of a
  native `<select>`, everywhere — Windows Chrome has a rendering bug
  with long native option lists.
- **`invisible` (or absolute positioning) instead of conditional
  mount/unmount** for a toggleable element inside a centered flex row
  (e.g. "今日に戻る / Back to today" links). Conditionally
  mounting/unmounting shifts sibling layout sideways or misaligns
  vertical centering — this was a repeated, hard-won bug class this
  project has already been through. See `select-class/page.tsx`'s
  date-nav for the current best version (today-link absolutely
  positioned below the row so it affects neither the row's height nor
  width).
- **Skeleton loaders** (`src/components/Skeleton.tsx`: `SkeletonRows`,
  `SkeletonBlock`) instead of a plain "読み込み中" text line — plain
  text collapses the page then re-expands once data loads, which reads
  as a jarring shrink/flash.
- **In-page overlays instead of route navigation** for "take an action
  for one day" flows — 出席確認 (`dashboard/page.tsx`) and
  登園確認/降園確認 (`dashboard/pickup/page.tsx`) are both a `showX`
  boolean toggling a ternary branch on the SAME page, not a separate
  route. If a page has more than one such overlay flag, make them
  explicitly mutually exclusive (each opener sets the others' flags
  false) — nothing prevents two from being true at once otherwise, and
  the resulting UI silently desyncs (header reacts to one flag, body
  ternary checks another first).
- **Enlarged retry button** for session-expired/error states:
  `rounded-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4
  text-base font-semibold`.
- **`apiFetch`/`SessionExpiredError`** (`src/lib/apiFetch.ts`) wraps
  `fetch` to detect a silent redirect to `/login` (expired session) —
  use this instead of raw `fetch` wherever session-expiry should
  surface as a distinct state.
- **`useSearchParams()` pages need a `<Suspense>` wrapper** — split the
  component into `XyzPageInner` (does the actual work) + a default
  export `XyzPage` that wraps it in `<Suspense fallback={null}>`. See
  `dashboard/pickup/page.tsx`, `dashboard/outings/page.tsx`,
  `dashboard/outings/summary/page.tsx`.
- **Card grids with optional extra lines** (student name cards, etc.)
  need an explicit `min-h-*` (+ `flex flex-col items-center
  justify-center`) or every row's height silently depends on whether
  that row happens to contain a card with an extra status line.

## Deploy & verification workflow

1. `npx tsc --noEmit` then `npm run build` — both must pass clean.
2. Commit, push to `main`.
3. Poll production: `POST /api/login {password}` (from `.env.local`'s
   `APP_PASSWORD`) to get the `yumego_auth` cookie, then poll
   `GET /api/version` until it returns the new commit hash.
4. Smoke-test with Playwright against production (or `npm run dev` +
   Playwright against localhost first, for anything visual/layout —
   cheaper than redeploying repeatedly to eyeball a screenshot).
5. Scratch scripts live in `scripts-tmp/` (gitignored) — clean up
   `node_modules`/scripts after each task EXCEPT
   `scripts-tmp/dashboard-preview/`, which is permanent.
6. Any test data written to production Sheets during verification
   (students, outings, bus overrides/patterns, etc.) MUST be deleted
   or reverted afterward — read back and confirm it's gone, don't just
   assume the delete call succeeded.

## Gotchas hit this session

- Windows/Linux classic (non-overlay) scrollbars toggling on/off
  causes horizontal layout shift when content height crosses the
  viewport threshold — fixed globally via `scrollbar-gutter: stable;`
  on `html` in `globals.css`. Doesn't reproduce in default headless
  Playwright (overlay scrollbars) — needs `channel: "chrome"` to catch.
- A literal full-width space (`　`) embedded directly in an inline
  `bash -d '...'` JSON string can get mangled depending on how the
  shell tool passes it through. Write the JSON to a file (heredoc) and
  POST with `--data-binary @file.json` instead of inlining it.
- Next.js/Turbopack dev server: if a stale `next dev` process is still
  running on port 3000 from an earlier session, a new one silently
  starts on 3001 instead — check for and kill stale processes before
  trusting a "Ready" message, or you'll preview against old code.
