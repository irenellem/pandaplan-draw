# Open the editor fast — 2026-11-17

The complaint: "make loading faster than spinning bullet". Opening a diagram showed a pulsing
"Loading the drawing editor…" for seconds (≈4 s warm, >25 s cold on the live site).

## Measurements

**Read this first: none of the after-change browser numbers were measured.** This session could not
run a browser. Headless Chrome aborts in the sandbox: binding its ProcessSingleton socket is denied
(`bind() … SingletonSocket: Operation not permitted`), and so is its crashpad Mach port. Running it
outside the sandbox was refused. Local port binding is off (`listen EPERM`), so `test/perf.mjs` cannot
serve either, and the GitHub download of the pinned `draw.war` was denied. Nothing below is an
estimate dressed up as a measurement.

| | before | after |
|---|---|---|
| shell DOM ready | ~1.06 s (live, your browser) | not measured |
| warm click → editor usable | ~4.0 s (live) | **not measured** (target ≤ 1.5 s) |
| cold click → editor usable | > 25 s, did not finish (live) | **not measured** (target ≤ 8 s) |
| app bundle (JS, raw / gzip) | 195.04 KB / 62.66 KB | 199.71 KB / 64.34 KB (vite build output) |
| draw.io critical bytes | see below | unchanged (same files; now fetched earlier, cached longer) |

draw.io's critical path, measured from the files (draw.io 32.6.1 from the desktop app, the closest
copy here; the image pins 32.6.10). `node test/stage-drawio.mjs …` stages it; sizes via Node zlib:

| file | raw | gzip | zstd |
|---|---|---|---|
| js/app.min.js | 10,395,039 | 2,382,082 | 2,327,266 |
| resources/dia.txt | 126,082 | 41,789 | 43,765 |
| styles/grapheditor.css | 85,964 | 16,715 | 19,283 |
| js/bootstrap.js | 12,982 | 3,903 | 4,161 |
| index.html (no-store) | 4,134 | 1,776 | 1,841 |
| PreConfig / PostConfig / main.js | 1,586 | 974 | 984 |
| **total** | **10,625,787** | **2,447,239** | **2,397,300** |

The boot is serial: `index.html` → `bootstrap.js` → `PreConfig.js` → `app.min.js` → `PostConfig.js`.
`app.min.js` is 98% of the bytes. Your > 25 s cold open is about 2.4 MB on the wire, plus about 10 MB
of JS to parse, that can only start after three round trips.

**How to produce the real numbers** (in a normal terminal; the harness needs a port and Chrome):

```sh
node test/stage-drawio.mjs path/to/draw-32.6.10.war   # or the draw.io.app app.asar
git worktree add ../draw-before HEAD && (cd ../draw-before && npm install && npm run build)
npm run build
node test/perf.mjs --label before --dist ../draw-before/dist
node test/perf.mjs --label after
```

Each run prints a table (cold/warm × "click as soon as the list shows"/"after 3 s on the list" ×
unthrottled/4G) and the three targets as met or MISSED. JSON goes to `test/out/perf-<label>.json`.
Paste both runs here. Then open a diagram on the live site and load `/?selftest=1` in the same tab
for one real-network number (see "selftest" below).

## What changed

1. **Measurement** — `test/perf.mjs` (`npm run test:perf`) runs real Chrome (CDP pipe, like the e2e)
   against a real local HTTP server. That server sends nginx's Cache-Control headers and gzip, so
   the HTTP cache and throttling are real. The page is timed with its own clock and draw.io's own
   `init`/`load` messages, so the same harness measures the old build too. It reports shell DOM
   ready, list shown, click→frame, click→usable, and draw.io bytes/requests/cache hits. Timings are
   advisory: the exit code only flags harness errors. `test/stage-drawio.mjs` puts a real draw.io in
   `test/.drawio/` (gitignored).
2. **Prefetch** (`src/lib/warmup.ts`) — once the saved-work list is on screen, the pane is empty and
   the browser is idle (`requestIdleCallback`; `setTimeout` on Safari), the app adds
   `<link rel="prefetch">` for app.min.js, grapheditor.css, bootstrap.js, dia.txt, Pre/PostConfig.js
   and main.js. It does this once per page and skips it on `navigator.connection.saveData`.
   **Not the draw.io document:** it is `no-store` by design (below), so a prefetched copy is not one
   the frame may reuse. It is 4 KB, and the warm frame fetches it anyway. That is a deliberate
   deviation from the brief. There is also no prefetch when a file is already open: its frame is
   already fetching the same files.
3. **Warm editor** (`src/lib/editorSlot.ts`, `src/components/DrawioEditor.tsx`, `src/App.tsx`) — at
   the same idle point, with the pane empty and no Save-Data, the app mounts a **spare** draw.io frame
   behind the empty state. It is full size, `visibility:hidden`, out of the tab order and
   `aria-hidden`. It boots while she reads the list. Opening a file **adopts** the spare: it keeps the
   same iframe and sends the one deferred `load` with her XML. The `postMessage` protocol is
   unchanged. `connectDrawio` gained only a deferred `load()` (when `onInit` returns null) and the
   `load` event as "usable".
   - **Why a hand-off and not one persistent frame:** draw.io accepts repeated `load`, but a frame
     reused across files can deliver a late `autosave` from diagram A after B was loaded, and A's XML
     would then be saved under B. Each frame still gets exactly one file. Switching A → B directly
     (a file already open) keeps the **existing remount path**: a new frame from the warm HTTP cache.
     No spare is booted while a file is open, because a same-origin iframe shares the app's main
     thread and booting draw.io (≈10 MB of JS) would freeze the editor she is using. After she closes
     a file (Back, delete), a new spare boots at the next idle.
   - Phone: the empty main pane is now off-screen (`left:-200vw; visibility:hidden`) instead of
     `display:none`, so the spare boots at the real screen size. It costs phone memory/CPU while she
     browses the list; Save-Data turns it off.
   - A spare that loads but never starts trips the same 45 s "editor did not load" placeholder,
     now possibly before any file is opened.
4. **Loader** — the bullet text is gone. A static, canvas-shaped skeleton (toolbar strip, shapes
   column, faint 20 px grid, theme colours, nothing pulses) covers the frame with one line:
   `Preparing the editor…` until draw.io sends `init`, then `Opening <title>…`. After 8 s it adds
   `Still working — the editor takes a few seconds on a fresh session.` It disappears on draw.io's
   `load` event, or 4 s after `load` was sent if that event never comes, so it can never trap the
   canvas. No percentages.
5. **Cache headers** (`deploy/nginx.conf`) — `/drawio/*`: `public, max-age=2592000, immutable` (was
   7 days, revalidated). `location = /drawio/index.html` **stays `no-store`**. The comment says why: a
   cached copy keeps its old CSP `frame-ancestors`, which silently breaks embedding for that browser.
   **Upgrade note:** draw.io file URLs carry no version, so after a `DRAWIO_VERSION` bump a browser
   may keep running the old release for up to 30 days (it was 7 before). It runs it consistently,
   because the old JS set is used as a whole. To roll out at once, serve the tree under
   `/drawio/<version>/` and point `DRAWIO_PATH` at it. I did not do that: I could not run nginx here
   to test a routing change.
6. **Critical path** — `index.html` has one script, the app bundle. There is no third-party script.
   The Cloudflare insights beacon injected at the edge is **blocked by the app's own CSP**
   (`script-src 'self'`), so it costs a request and a CSP error and reports nothing. Turn it off in
   the Cloudflare dashboard, or allow it in the CSP if you want its data. I have not checked this
   live.

## Per file
- `src/lib/warmup.ts` (new): critical file list, `warmupAllowed`, `whenIdle`, `prefetchDrawio`, loader wording.
- `src/lib/editorSlot.ts` (new): which frame holds which file (spare / adopt / new frame).
- `src/lib/perf.ts` (new): per-open timing (`window.__pandadrawPerf`, last one in sessionStorage).
- `src/lib/drawioProtocol.ts`: deferred `load()`, `loadSent`, `onLoaded` for draw.io's `load` event.
- `src/components/DrawioEditor.tsx`: `file` prop (null = spare), skeleton, slow line, linkRef set only for a frame holding a file (Print never exports a spare).
- `src/App.tsx`: slot state set in `setOpen`, idle warm-up effects, `beginOpen` on open/new. Save, title, duplicate, autosave and print code untouched.
- `src/workspace.css`: skeleton, hidden spare, phone off-screen pane.
- `src/lib/selftest.ts`: `?selftest=1` now has **11 checks** (+ Save-Data skip, prefetch list same-origin/no `index.html`, loader wording). It also has `timings`: `shell` (that page's DOM ready) and `lastOpen` (the last diagram opened in this tab: path warm-booted/warm-booting/fresh, frame age, click→frame, click→init, click→usable). Still offline, no network call.
- `deploy/nginx.conf`: as above.
- `test/stub.mjs`: the fake editor answers `load` with draw.io's `load` event (as real draw.io does with proto=json) and can delay `init` (`localStorage.fakeInitDelay`).
- `test/client.test.mjs`: slot hand-off rules, deferred-load protocol, warm-up gate. `npm test` → **17/17 pass**.
- `test/e2e.mjs`: 4 new checks. (1) After the list shows: prefetch links exist and exclude `index.html`, and a hidden spare has booted behind the empty state. (2) Opening a file adopts that same iframe without reloading it; the file loads and the skeleton is gone (click→usable printed as *advisory*). (3) The skeleton reads `Preparing the editor…`, then the 8 s line, never the old text. (4) Save-Data: nothing is warmed, and opening still works through a fresh frame.
- `test/perf.mjs`, `test/stage-drawio.mjs` (new); `package.json` `test:perf`; `.gitignore`.

## Not done / not verified
- **`npm run test:e2e` was not run** (no Chrome in this sandbox; the unsandboxed run was refused). The 4 new checks and the existing 11 are unverified after this change. Run `npm run build && npm run test:e2e`.
- **No after-change timings.** None of the three targets is reported as met. Run the commands above.
- Draw.io behaviour inside a hidden frame (focus, layout at the off-screen phone size) is reasoned from its code, not observed.
- The perf harness duplicates the e2e's ~40-line CDP plumbing instead of sharing a module. I left `e2e.mjs`'s plumbing alone because I could not run it after a refactor.
# Titles, duplicate, debug pass — 2026-11-17

## Per file
- `worker/pandaplan-draw-api.mjs` (edited, not deployed): PUT reads `title` and stores it in `customMetadata.title` (clamped to 120 code points; never passes `safeName`). `/backups` lists with `include:["customMetadata"]`, returns `title` per item plus `limit` and `truncated`. New `optSlug()`: a missing `folder` param means "no folder". DELETE: `folder=<slug>` deletes in that folder only; `folder=` (empty) deletes unfiled copies only; with no param it deletes in every folder (the old contract).
- `src/lib/drawioFile.ts`: `clampTitle`, `TITLE_MAX`; `makeFile(name, xml, title)` puts `title` in the payload.
- `src/lib/savedWork.ts`: `Entry.title`, `titleOf()` (falls back to `pretty`), `saveXml(name, folder, xml, title, keepalive)` sends `&title=`, `listEntries` returns `truncated`, `deleteEntry(name, folder)` always sends `folder`.
- `src/App.tsx`: open file carries `title`. Titles are used in the file bar, `document.title`, editor title, print sheet, confirms/errors and download names. Rename takes free text: same slug → re-save with the new title, no delete. New slug → copy, then delete in the old folder only. Same slug and same title → no-op. New `duplicate` runs on the save chain and copies `latestXml` when the source is open. `upsert` now updates `entriesRef` straight away. `relocate` always writes first, then deletes.
- `src/components/SavedWorkPanel.tsx`: rows, search and the rename input use the title, with free text kept exactly as typed. Duplicate (`Copy` icon) sits in the action bar and on each row, and Ctrl/⌘+D duplicates the focused row. The copy is selected, not opened. A "Showing N of M" notice appears when the list is truncated.
- `src/lib/download.ts`: `titleFilename()` (removes `/\:*?"<>|`, control characters and leading dots).
- `src/main.tsx`, `src/lib/selftest.ts`, `src/vite-env.d.ts`: the `?selftest=1` view (offline JSON in `<pre id="selftest-json">`).
- `test/`: `fakeR2.mjs`, `stub.mjs` (the real Worker over an in-memory R2, plus a fake draw.io page), `worker.test.mjs`, `client.test.mjs`, `stub-server.mjs`, `e2e.mjs`. `npm test` / `npm run test:e2e`.

## Defects reproduced (with the command that showed them)
- Titles lost: `node --test test/client.test.mjs` test 1 — `pretty(slugify("PR# 123 – QC Report"))` gives `"Pr 123 qc report"`.
- Worker sends unfiled saves to `draws/workspace/`: `node --test test/worker.test.mjs` on the original Worker → 6/6 fail (`test/out/worker-before.txt`). Key `draws/workspace/plan.pandadraw`, not `draws/<day>/…`, because `safeName(null)` returns `"workspace"`. As a result, a folder-less DELETE only searched `workspace`; it did **not** delete "in every folder" as the brief assumed.
- The list never had titles and gave no truncation flag (same run: tests 2 and 4). R2 `list()` omits customMetadata unless `include` is passed. That is documented R2 behaviour, modelled in `fakeR2`; I have not checked it against live R2.
- `?selftest=1` did not exist: `grep -rn selftest src` matched only a CSS class. Git history shows no implementation.
- After the fixes: `npm test` → 14/14 pass (`test/out/worker-after.txt`, `client-after.txt`). `npm run build` → no TypeScript errors.

## Not done, and why
- **The browser acceptance run (step 2) was not executed.** This sandbox forbids listening on a port (`listen EPERM` for vite preview and the stub). Headless Chrome cannot start in it either (ProcessSingleton/Mach denied), and running outside the sandbox was refused. `test/e2e.mjs` is written for it. It uses no ports: CDP over a pipe, and requests served by `test/stub.mjs` from `dist/`. It covers create, reload, Ctrl+D, duplicating an open file, rename, download name, print and selftest. Run `npm run build && npm run test:e2e`.
- **Autosave (§4) is unchanged and not browser-verified**: I only added the title argument to its PUT.
- **Print CSS left unchanged**: one page for a tall diagram is unproven, but the e2e has a check that counts PDF pages.
- `entriesRef` lag after rename: hardened (`upsert` syncs the ref) but not reproduced.
- Folder rename is unchanged (slug only).
- Files already in `draws/workspace/` still list as folder "Workspace" (no data migration).
- Deploy the Worker together with this client. On the old Worker, titles are still kept in each file but the list shows `pretty(slug)`.
