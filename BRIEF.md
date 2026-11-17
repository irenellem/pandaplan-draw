# Task: Build PandaPlan Draw — a diagram-first collaborative workspace

You are a Senior Full-Stack Engineer and UI/UX Architect. Build a production-quality web app that will be
served at **https://gantt.pandaplan.work/draw/** (a static Cloudflare Pages project, subpath `/draw`).

Read this whole brief before writing code. Do not ask questions — make the senior-engineer call and note it
in `docs/DESIGN.md`.

## Concept
Inspired by **Docmost** (clean sidebar, nested pages, dark/light) but **diagram-first like Draw.io**.
The infinite canvas is the primary workspace; rich-text/markdown notes live in a toggleable right drawer
attached to the diagram (and optionally to individual nodes), not in the middle of the canvas.

## Host constraints (non-negotiable — these override the "recommended stack" in any earlier prompt)
- The host is a **static** Cloudflare Pages site (`dtc-gantt`) already serving Astro/plain pages.
  There is no Node server at runtime, so **Next.js App Router with a server is not usable here**.
- Therefore: **React + Vite + TypeScript**, `base: '/draw/'` in `vite.config.ts`, built to `dist/`,
  client-side only. This satisfies "React + Vite" from the recommended stack and avoids a server.
- Strict CSP is applied by the host: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'`. So: **no CDN, no Google Fonts, no external icon/image hosts,
  no eval, no remote API calls**. Everything self-hosted in the bundle. System font stack only.
- `X-Frame-Options: DENY` — never frame out.
- The app must work with **relative asset URLs under `/draw/`** and must survive a hard refresh at
  `/draw/` (no server-side routing; use query-string state such as `/draw/?d=<pageId>`, not path segments).
- Pages are behind Cloudflare Access already — no auth code needed, no secrets, no login UI.

## Stack
- React 18 + TypeScript, Vite.
- `@xyflow/react` (React Flow v12) as the canvas engine, customised for Draw.io-style structured
  flowcharting (custom node components, custom edge router).
- `zustand` for state, with `persist` middleware → **localStorage** now (key `pandadraw.v1`).
- `lucide-react` for icons.
- Tailwind CSS (v3, PostCSS) — theme via CSS variables so dark/light is one class toggle (`class` dark mode).
- `html-to-image` for PNG export. SVG export via a hand-written serializer of the flow graph (no DOM
  snapshot). `marked` for markdown rendering in the notes drawer (sanitise remote/unsafe HTML off).
- No other heavy deps. No telemetry.

## Deliverables, in this order
1. `docs/DESIGN.md` — three sections, written first, in plain prose + short tables:
   a. **Folder structure** for the `/draw` subpath (annotate every directory and the key files;
      include the host layout: `site/draw/` is the deployed build output inside the Pages project).
   b. **Persistence schema** — the Zustand store shape and the future Postgres/Supabase DDL
      (`workspace`, `page` (self-referencing `parent_id` for nesting, `position` for ordering),
      `diagram`, `node`, `edge`, `note`) with the JSON columns, indexes, and one row-level-security note.
   c. **Step 1 implementation notes** — what the main workspace layout is and why.
2. The working app itself (see features).
3. `README.md` — how to run (`npm install`, `npm run dev`), how to build (`npm run build` → `dist/`),
   and the deploy line (`copy dist/* into the Pages project's draw/ folder`).

## MVP features to build for real (not stubs)
1. **Docmost-style sidebar** (collapsible, resizable width): workspace title, "New diagram" primary
   button (blue #1877f2, white text), quick search box filtering the tree, nested folders/pages with
   expand-collapse chevrons, rename / duplicate / delete / move-to-folder via context or row menu,
   drag-free ordering is fine but use explicit up/down or indentation controls. Active row highlighted.
2. **Infinite canvas**:
   - Shape library panel (left, collapsible, above or beside the canvas — your call, document it):
     groups *Flowchart* (process, decision, terminator, data, document, database/cylinder), *Basic*
     (rect, rounded rect, ellipse, diamond, parallelogram, hexagon), *Cloud/Infra* (generic server, DB,
     network, queue/workflow, user, cloud), *Sticky note* (yellow, text-only), *Gantt/timeline block*
     (bar node with label + start/end text). Drag from panel onto canvas **or** click to drop at centre.
     Draw shapes as inline SVG or CSS — no icon libraries/services beyond lucide.
   - Smart connectors: orthogonal/elbow (default), straight, curved/bezier. Ports on hover
     (N/E/S/W) with snap; edges carry an editable label (double-click inline edit).
     Edge style is switchable per edge and as a canvas default.
   - Floating contextual toolbar (appears when selection exists, top-center of canvas): fill colour
     swatches, stroke colour, stroke width, font size, bold, text align, z-order (front/back),
     duplicate, delete, and "convert to" shape type for a single selected node.
   - Pan (space-drag and scroll), zoom (wheel + toolbar +/-/fit/reset), **grid snapping** toggle,
     visible background grid dots, **minimap** (React Flow MiniMap), zoom percentage readout.
   - Multi-select (shift-click and marquee), copy/paste duplicate (Cmd/Ctrl+D), delete key,
     undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z) with a bounded history (>= 50 steps).
3. **Hybrid documentation drawer** (right, toggle button in top bar): per-diagram markdown editor with
   a live preview toggle (Edit | Preview), word count, autosave. Also supports a per-node note: when
   exactly one node is selected, the drawer switches to "Node note" mode for that node. Drawer is
   resizable and remembers its width.
4. **Import / export**: PNG (html-to-image at 2x, transparent or white background toggle),
   SVG (hand-serialized, real vector), JSON `.pandadraw` (versioned envelope: `{format, version: 1,
   workspace, pages, diagrams, exportedAt}`) — plus **import** of that same `.pandadraw` file
   (validate, then merge as new pages; never silently drop data — report counts).
5. **Dark/light mode** toggle persisted; respects `prefers-color-scheme` on first load.

## Engineering standards
- TypeScript strict, no `any` in app code (React Flow generics may need careful typing), no unused
  imports, `npm run build` must succeed with zero TypeScript errors and zero Vite warnings that matter.
- Autosave to localStorage on every mutation, debounced ~300 ms. Never lose work on reload.
- Empty states and keyboard shortcuts help modal (`?` key) — short, factual copy, no marketing tone.
- Accessibility basics: focus rings, `aria-label` on icon buttons, keyboard-reachable toolbar.
- Small, readable files (roughly < 300 lines each). Components, hooks, store, lib separated.
- `?selftest=1` must return JSON diagnostics (HTTP-level not required; render a JSON view):
  `{ok, version, pages, nodes, edges, storage:"localStorage", basePath:"/draw/", checks:[...]}` —
  this is the host's standard smoke test. It must never require a network call.
- Keep a `docs/DESIGN.md` decision log at the bottom: each deviation from the original prompt and why.

## Definition of done (verify yourself, do not claim without running)
- `npm run build` succeeds; `dist/index.html` exists and all asset URLs in it start with `/draw/`.
- `npx vite preview --port 4188 --strictPort` (base path aware) loads; fetch
  `http://127.0.0.1:4188/draw/?selftest=1` and show the JSON in your final report.
- No `http://`/`https://` external URLs in `dist/` assets (grep proof in the report).
- Report at the end: files created (tree), the three DESIGN.md answers in 10 lines max, the build
  output tail, the selftest JSON, and the external-URL grep result.

Work autonomously to completion. Do not stop to ask permission. If a dependency fails to install,
choose the closest alternative that keeps the CSP and static-host constraints and record it.
