# Bugs found on 18 Nov 2026 (Claude Code pass, run cut off before fixes)

Baseline at the time: commit 09294b6, bundle index-wJT9be8z.js, build green, 17/17 unit, 15/15 e2e.
Eight defects were reproduced with failing tests. Only `src/App.tsx` had begun to change and that edit
was reverted; the tree is back at 09294b6 and green. Nothing was deployed.

The reproduction work is saved outside the repo:
- `/Users/irenellemedalla/Downloads/Gantt_Preview/bugs_tests.patch` — 11 new e2e checks plus a
  deterministic latency hook in the stub (`POST /__stub/delay {read, put}`), 225 lines.
- `/Users/irenellemedalla/Downloads/Gantt_Preview/bugs_src_partial.patch` — the unfinished App.tsx
  edit. Do not apply it as-is; it deletes the popstate effect without adding the replacement.

## The defects, worst first

1. **Silent record loss on a fast switch.** `openEntry` snapshots `latestXml` once, so an `autosave`
   that arrives while the previous file's PUT is in flight is overwritten by `setOpen`. An edit can
   vanish. This is the DTC data-integrity case and must be fixed with a test that fails first.
2. **One-click race.** Two rows clicked in quick succession open the last one only sometimes — the
   slower `readXml` for the first row wins. Needs a sequence guard in `openEntry` (`openSeq`).
3. **No initial route parse.** A cold load of `/f/<slug>` shows the home screen; the app pushes `/`
   on mount. `src/lib/nav.ts` already has `parsePath`/`pathFor` and nothing imports it.
4. **Reload loses the open file.** Same cause as 3.
5. **Back/Forward is broken.** `onPop` returns early for any `/f/` path, so the URL moves and the
   screen does not.
6. **Drawer has no Escape, no scrim, no focus handling.** No Escape handler, no `.sw-scrim`, no
   focus return to the Files button, no trap.
7. **Drawer is dead on a phone.** `@media (max-width:700px) { .sw-app.has-open .sw-panel { display:none } }`
   in `src/workspace.css` removes it entirely, while the drawer rules further down assume it renders.
8. **Warm spare editor is not inert.** The wrapper is `visibility:hidden` only, so script focus can
   still land inside the frame.

## How to finish

For each: reproduce, write the failing test, fix, prove the test passes. Then `npm run build`,
`npm test`, `npm run test:e2e`, `npm run test:perf` all green before any commit. Keep working
behaviour untouched: one-page print, titles with capitals, duplicate, delete scoping, the manual
link, `?selftest=1` valid JSON, Save-Data skipping the prefetch, and one-click open itself.
