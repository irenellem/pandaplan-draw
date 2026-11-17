# Task brief — PandaPlan Draw: titles, duplicate, debug

Repo: this folder (`draw/`). React 18 + Vite + TS, served by nginx at https://draw.pandaplan.work.
Backend is the Cloudflare Worker `pandaplan-draw-api`, source now at `worker/pandaplan-draw-api.mjs`
(downloaded from the live account; edit this file, do NOT deploy it).
There is a `?selftest=1` JSON view (src/main.tsx) that must keep working.

Do NOT run any deploy command, do NOT touch git remotes. Build + local test only.

## 1. Titles must keep capitals and punctuation (the main defect)

Today `slugify()` lowercases and strips punctuation, and `pretty()` re-capitalises only the first
letter, so a name typed "PR# 123 – QC Report" comes back as "Pr 123 qc report". The slug must stay
the storage key; a *display title* must be stored alongside it and shown everywhere.

- `Entry` (src/lib/savedWork.ts) gains `title: string`.
- `saveXml(name, folder, xml, keepalive)` gains a `title` argument and sends it as `&title=<uri>`.
- The saved file payload (`makeFile` in src/lib/drawioFile.ts) also carries `title`.
- Worker `GET /api/draw/backup` (by key) already returns the JSON file — it will now contain `title`.
- Worker `PUT` reads `title` from the query string, keeps it in `customMetadata.title` (it already
  writes `customMetadata: { savedBy, source }`), and `/api/draw/backups` returns
  `o.customMetadata?.title || ''` for each item so the list shows the real title.
- Worker `safeName()` is for slugs only: never let a title reach it. Titles are arbitrary UTF-8,
  max 120 chars — clamp in both the client and the Worker.
- `pretty()` stays as the fallback when an entry has no title (old files).
- Every place that shows a name to a person uses the title: tree rows, rename input, file bar,
  document.title, print sheet, download filename (`<title>.drawio`, sanitised for the filesystem).

## 2. Rename must accept free text

- The rename input keeps the typed text exactly (no lowercasing). On commit:
  `slug = uniqueSlug(text, otherNames)`, `title = text.trim().slice(0,120)`.
- Renaming to the same *title* with the same slug is a no-op; if only the slug would change but the
  title is identical, still do the copy+delete so the key matches the new slug.
- Empty input cancels. Escape cancels (already there).
- Folders keep slug-only names; leave folder rename alone.

## 3. Duplicate a diagram

- Add a `Duplicate` action (icon: lucide `Copy`) beside Rename/Delete in the saved-work action bar,
  in the row context and on `Cmd/Ctrl+D` while a file row is focused.
- Duplicate = read the XML (`readXml`), save it under `uniqueSlug(<title> + " copy", all names)` with
  title `<title> copy`, in the same folder, then select the new row (do not open it).
- Runs on the existing save `chain` (`enqueue`) so it can never interleave with an autosave PUT.
- Never duplicate an open file's stale copy: if the source is the open file, use `latestXml.current`.
- Report a failure through the existing `fail()` path; never a silent no-op.

## 4. Autosave — verify, do not rebuild

Autosave already exists (2 s debounce, `flush()`, pagehide/visibility flush, beforeunload guard).
Confirm by test that it fires and reports "Saved HH:MM". Fix only what the test proves broken.

## 5. Debug pass — prove each fix

Find and fix real defects you can demonstrate. Known candidates to check (not a licence to guess):
- `/api/draw/backups` returns at most 400 items silently (`slice(0,400)` in the Worker) and the UI
  shows no notice. Add "showing N of M" when truncated.
- `deleteEntry(name)` with no folder deletes that name in *every* folder (Worker behaviour). Rename
  and move must never rely on that when the file has a folder.
- After a rename, the old key stays cached in `entriesRef` (check `upsert(... , e.id)` ordering).
- `window.print()` prints the `.print-sheet`; confirm the sheet is hidden on screen and one page.

## Acceptance (must be run, not claimed)

1. `npm run build` — zero TypeScript errors.
2. Start `npx vite preview --port 4188` and, with a stub `/api/draw` server you write under
   `test/` (Node, no new deps), drive the app with headless Chrome to prove:
   - create "PR# 123 – QC Report" → the tree row reads exactly that, capitals and dash intact;
   - reload the page → the title survives (read back from the stub's stored payload);
   - Duplicate → a second row "PR# 123 – QC Report copy", both listed, separate keys;
   - type in the canvas/autosave path → status reaches "Saved".
   Print the assertions that passed.
3. `?selftest=1` still returns its JSON.

Write `docs/CHANGES.md` (<= 40 lines): what changed per file, the defects you actually reproduced
with the command that showed them, and anything you left alone and why.
