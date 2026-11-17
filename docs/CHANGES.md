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
