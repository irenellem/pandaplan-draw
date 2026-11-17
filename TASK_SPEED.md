# Task: make PandaPlan Draw's editor open fast

Repo: this directory (`pandaplan-draw`). Live: https://draw.pandaplan.work (behind Cloudflare
Access — you cannot reach it; work locally).

## The complaint, verbatim

> make loading faster than spinning bullet

Translation: opening a diagram shows a small pulsing loader ("Loading the drawing editor…") for
seconds. She wants the editor ready before she notices, and the loader must never be the thing she
stares at.

## What I measured against the live site today (browser, warm HTTP cache)

- App shell: TTFB ~1.0 s, DOM ready ~1.06 s, 168 KB of JS+CSS, 7 requests.
- Opening a saved diagram: iframe created on click, draw.io boots, editor usable at **~4.0 s** warm.
- Same open with the HTTP cache **disabled** (cold, what a new laptop/phone sees): iframe did not
  finish booting in **25 s** — it was still loading when the test gave up.
- `GET /drawio/index.html` → `Cache-Control: no-store` (deliberate, see `deploy/nginx.conf`).
- `/drawio/*` other files → `Cache-Control: public, max-age=604800` (7 days).
- `/assets/*` → immutable, 30 days.
- Cloudflare compresses with zstd, so bytes-on-wire is already handled.
- The draw.io iframe is only mounted when a file is opened (`src/components/DrawioEditor.tsx`,
  remounted per file via `key`). Nothing warms it while she is reading the saved-work list.

## Do this, in this order

1. **Measure first, then choose.** Build a repeatable local measurement (the existing
   `test/e2e.mjs` already drives real Chrome — reuse its harness, or add `test/perf.mjs`):
   shell DOM-ready, click-to-iframe, click-to-editor-ready, and the number of draw.io bytes
   fetched. Report cold (cache bypassed) and warm. Do not change code before you have the
   numbers.
2. **Kill the cold-download cost.** Prefetch draw.io's critical resources once the shell is
   interactive and the saved list has rendered (not before — do not compete with the shell):
   `<link rel="prefetch">` for the draw.io document plus its largest scripts, injected at idle
   (`requestIdleCallback`, fallback `setTimeout`). Respect `navigator.connection.saveData` and
   skip prefetching on it.
3. **Warm the editor instance.** After the list is on screen, and only if the diagram pane is
   empty, mount the draw.io iframe early (off-screen or behind the empty state) so its boot
   overlaps the time she spends choosing a file. Opening a file then loads XML into a booted
   editor. Keep the existing `postMessage` protocol from `src/lib/drawioProtocol.ts`; if a
   persistent frame is not safely achievable, say so in the changelog and keep the remount path.
4. **Replace the loader with a skeleton, not a bullet.** No pulsing dot, no "Loading the drawing
   editor…" alone. Show a canvas-shaped skeleton (faint grid) plus a one-line stage: 
   `Preparing the editor…` → `Opening <title>…`. If boot exceeds 8 s, add a plain second line:
   `Still working — the editor takes a few seconds on a fresh session.` Never a percentage you
   did not measure.
5. **Cache headers.** `/drawio/*` may go to `30d, immutable` (the release is pinned by
   `ARG DRAWIO_VERSION` in the Dockerfile). `location = /drawio/index.html` must stay `no-store`
   — that is a correctness requirement, not an oversight. Explain in a comment why.
6. **Drop anything on the critical path that is not the app.** Cloudflare's insights beacon is
   already injected by the edge; make sure no other third-party script sits in `index.html`.

## Targets (report the measured value, never a promise)

- warm click → editor usable: **≤ 1.5 s**
- cold click → editor usable: **≤ 8 s**
- shell DOM ready: unchanged or better
- If a target is missed, report the number and the reason — do not tune the test.

## Hard constraints

- Do NOT run any deploy command, do NOT touch git remotes. Build + local test only.
- Keep `?selftest=1` working and extend it with the new timings (it already reports 8 checks).
- Keep `npm test` and `npm run test:e2e` green; add perf assertions to the e2e where they are
  stable, and label anything timing-based as advisory rather than a hard gate.
- Do not change the saved-work behaviour, the title handling, duplicate, autosave or the print
  path — those were just shipped and verified.
- No new runtime dependencies unless there is no alternative; no CDN, everything stays same-origin
  (the CSP in `deploy/nginx.conf` is strict and must keep working).
- Write what you changed to `docs/CHANGES.md`, including the before/after measurements.
