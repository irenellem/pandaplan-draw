# Task: split file home from the editor, and open a file instantly

Repo: this directory (`pandaplan-draw`). Live: https://draw.pandaplan.work (behind Cloudflare
Access — you cannot reach it; work locally).

## What she said, verbatim

> ang issue ko is mas mabilis talaga yung sa docmost. what if sabihin mo kay claude magkaiba yung
> file home, then kapag i choose a file then we open instantly like in docmost.

Meaning: Docmost (her docs tool) feels faster than this app. Two separate ideas she wants:

1. **The file home is its own screen.** Right now the saved-work list and the drawing editor share
   one page. She wants a distinct file home — the landing view is the list (search, folders, recent
   files), and the editor is somewhere else.
2. **Choosing a file opens it instantly.** No spinner, no page rebuild, no waiting — the same feel
   as clicking a page in Docmost.

## What is already true in this build (do not break it)

- `src/lib/editorSlot.ts` keeps one draw.io iframe alive; `src/lib/warmup.ts` prefetches draw.io and
  starts a hidden spare editor once the list renders; opening a file adopts that frame.
- Measured live today: warm click → usable **0.49 s**, cold cache **1.78 s**.
- The loader is a canvas skeleton with a stage line, never a pulsing dot.
- Titles keep the user's capitals and punctuation (slug stays the storage key); duplicate, autosave,
  one-page print, the `/manual/` link, and `?selftest=1` all work and are covered by tests.

## Build this

1. **Two views, one page load.**
   - Home (`/`): the saved-work list as the main content — folders tree, search, recency, counts —
     laid out as a real landing screen, not a narrow side panel.
   - Editor (`/f/<folder>/<slug>`, and `/f/<slug>` for unfiled files): the drawing surface filling
     the window.
   - Switching between them must **not** reload the document, remount the iframe, or re-fetch the
     list. Use the History API for the URL and plain view state for the swap. Back button returns to
     home with the editor still warm.
2. **Instant open.** On a file click: switch the view in the same frame, then send the existing
   `load` message over `src/lib/drawioProtocol.ts`. If the frame is already warm this must be a
   single paint — target **click → diagram visible ≤ 150 ms**. If it is not warm (Save-Data, or the
   very first seconds), show the skeleton and load normally; never show the skeleton when the frame
   is warm.
3. **Prefetch what the click needs.** The file's own XML should be fetched as soon as the pointer is
   over a row or the row is in view on a slow link — a few hundred bytes, so this is safe. Cancel on
   pointer leave if it has not started.
4. **Home must feel like a home.** Full-width list, generous rows, folder grouping, the existing
   search, and a "New diagram" action. Show the recent files first. On a phone the list is the whole
   screen; the editor is the whole screen; no fixed 300 px panel — that defect is documented.
5. **Never regress** autosave, titles, duplicate, delete scoping, print, the manual link, or the
   `?selftest=1` JSON (extend it with the two-view checks, keep it valid JSON).

## Prove it, don't assert it

- Extend `test/e2e.mjs`: home renders as the landing view; clicking a file shows the editor with the
  same iframe (assert the iframe identity does not change); back returns home with the frame warm;
  a cold open still works. Timing assertions are **advisory** (log the number), never a hard gate.
- Extend `test/perf.mjs` (or add a case) to report **click → diagram visible** for warm and cold, at
  phone size too, since her complaint is about feel on the phone as well.
- Record before/after numbers in `docs/CHANGES.md`.

## Hard constraints

- Do NOT run any deploy command, do NOT touch git remotes. Build + local test only.
- `npm test` and `npm run test:e2e` must stay green; `npm run test:perf` needs
  `node test/stage-drawio.mjs /tmp/draw.war` once (already staged at `test/.drawio/`).
- Same-origin only — the CSP in `deploy/nginx.conf` must keep working; no CDN, no new runtime
  dependency unless there is no alternative.
- Keep print one page, keep the file home usable at 390 px wide.
