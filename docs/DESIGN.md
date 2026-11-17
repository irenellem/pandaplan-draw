# PandaPlan Draw — Design

PandaPlan Draw is a diagram-first workspace served as static files at
`https://gantt.pandaplan.work/draw/`. The canvas is the main surface. Markdown notes sit in a drawer on
the right that you can toggle, and each note belongs to a diagram or a single node. Everything runs in the browser, and data
lives in `localStorage` under the key `pandadraw.v1`.

---

## a. Folder structure

The source project is `draw/` (this folder). The deployed output is `site/draw/` inside the Cloudflare
Pages project `dtc-gantt`, which already serves the Astro and plain pages at the site root.

```
Gantt_Preview/
├── site/                         Cloudflare Pages project root (dtc-gantt), _headers sets the CSP
│   └── draw/                     ← deployed build output: a copy of draw/dist/*
│       ├── index.html            asset URLs all start with /draw/
│       ├── favicon.svg
│       └── assets/               hashed JS + CSS bundles (no external URLs)
└── draw/                         source project (this folder)
    ├── BRIEF.md                  task brief
    ├── README.md                 run / build / deploy
    ├── docs/DESIGN.md            this file: structure, schema, notes, decision log
    ├── index.html                Vite entry (system fonts only, no inline script)
    ├── vite.config.ts            base '/draw/', Tailwind v4 plugin, __APP_VERSION__ define
    ├── tsconfig*.json            strict TypeScript (app + node configs)
    ├── public/favicon.svg        copied verbatim to dist/
    └── src/
        ├── main.tsx              entry; renders the self-test view when ?selftest=1
        ├── App.tsx               workspace shell (sidebar | library | canvas | drawer)
        ├── index.css             Tailwind import, theme CSS variables, canvas CSS
        ├── types.ts              domain types (Page, Diagram, DNode, DEdge, ...)
        ├── store/                state
        │   ├── docStore.ts       persisted zustand store (key pandadraw.v1) + preferences
        │   ├── pageActions.ts    page tree operations (create/rename/move/indent/...)
        │   ├── diagramActions.ts canvas mutations, all history-aware
        │   ├── history.ts        bounded undo/redo stacks per diagram (100 steps)
        │   ├── sessionStore.ts   non-persisted: selection, inline editing, clipboard, toasts, modals
        │   ├── persistStorage.ts debounced (300 ms) localStorage adapter + save status
        │   └── seed.ts           first-run workspace with a sample diagram
        ├── lib/                  pure logic, no React
        │   ├── shapes.ts         shape geometry → primitives (shared by canvas + SVG export)
        │   ├── shapeCatalog.ts   library groups, default sizes and styles
        │   ├── geometry.ts       ports, bounds, hit tests
        │   ├── route.ts          edge router: orthogonal / straight / bezier + arrowheads
        │   ├── svgExport.ts      hand-written SVG serializer
        │   ├── pngExport.ts      html-to-image at 2x
        │   ├── pandadraw.ts      .pandadraw envelope build / validate / merge
        │   ├── markdown.ts       marked with raw HTML escaped and unsafe URLs removed
        │   ├── tree.ts           page tree helpers (children, ancestors, search filter)
        │   ├── color.ts          palette + automatic text contrast
        │   ├── download.ts       Blob download helper
        │   ├── ids.ts            id generation
        │   └── selftest.ts       ?selftest=1 diagnostics
        ├── hooks/                useResizable, useShortcuts, useTheme, useUrlSync, useSaveStatus
        └── components/
            ├── layout/           TopBar, ExportMenu, EmptyWorkspace
            ├── sidebar/          Sidebar, PageTree, PageRow, RowMenu
            ├── canvas/           Canvas engine: viewport, nodes, edges, minimap, zoom,
            │                     context toolbar, shape library, pointer state machine
            ├── drawer/           NotesDrawer (diagram note / node note)
            ├── common/           Modal, Menu, IconButton, Toasts, ShortcutsModal, ImportReportModal
            └── selftest/         SelfTestView (JSON diagnostics)
```

Most files stay under 300 lines. Code under `lib/` is pure, so the canvas, the SVG exporter and the
self-test all use the same geometry and routing functions.

---

## b. Persistence schema

### Zustand store (localStorage, key `pandadraw.v1`, persist version 1)

| Field | Type | Notes |
|---|---|---|
| `workspace` | `{ id, name }` | one workspace per browser |
| `pages` | `Record<id, Page>` | `Page = { id, parentId: string \| null, kind: 'folder' \| 'diagram', title, position, createdAt, updatedAt }` |
| `diagrams` | `Record<pageId, Diagram>` | `Diagram = { id, nodes: DNode[], edges: DEdge[], note, defaultEdgeStyle, viewport: {x,y,zoom}, updatedAt }` |
| `activePageId` | `string \| null` | mirrored to `?d=<pageId>` |
| `prefs` | object | `theme, sidebarWidth, sidebarCollapsed, libraryCollapsed, drawerOpen, drawerWidth, snapToGrid, expanded{}, pngBackground` |

`DNode = { id, kind, x, y, w, h, z, label, style:{fill, stroke, strokeWidth, fontSize, bold, align}, note?, start?, end? }`
`DEdge = { id, source, target, sourceSide, targetSide, style:'orthogonal'|'straight'|'bezier', label, stroke, strokeWidth }`

Selection, inline editing, the clipboard, toasts and undo stacks are kept out of storage on purpose
(`sessionStore`, `history`). Every write is debounced by 300 ms. Pending writes are flushed on
`pagehide` and on `visibilitychange → hidden`, so a reload does not lose work.

### Future Postgres / Supabase DDL

```sql
create table workspace (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users(id),
  settings    jsonb not null default '{}'::jsonb,          -- theme defaults, grid size
  created_at  timestamptz not null default now()
);

create table page (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace(id) on delete cascade,
  parent_id    uuid references page(id) on delete cascade,  -- self-reference = nesting
  kind         text not null check (kind in ('folder','diagram')),
  title        text not null default 'Untitled',
  position     double precision not null default 0,         -- fractional ordering among siblings
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index page_tree_idx on page (workspace_id, parent_id, position);

create table diagram (
  page_id            uuid primary key references page(id) on delete cascade,
  default_edge_style text not null default 'orthogonal',
  viewport           jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  updated_at         timestamptz not null default now()
);

create table node (
  id          uuid primary key,
  diagram_id  uuid not null references diagram(page_id) on delete cascade,
  kind        text not null,
  geometry    jsonb not null,            -- {x,y,w,h,z}
  label       text not null default '',
  style       jsonb not null default '{}'::jsonb,   -- {fill,stroke,strokeWidth,fontSize,bold,align}
  data        jsonb not null default '{}'::jsonb    -- {start,end} for gantt blocks, future fields
);
create index node_diagram_idx on node (diagram_id);

create table edge (
  id          uuid primary key,
  diagram_id  uuid not null references diagram(page_id) on delete cascade,
  source_id   uuid not null references node(id) on delete cascade,
  target_id   uuid not null references node(id) on delete cascade,
  ports       jsonb not null,            -- {sourceSide,targetSide}
  style       jsonb not null default '{}'::jsonb,   -- {style,stroke,strokeWidth}
  label       text not null default ''
);
create index edge_diagram_idx on edge (diagram_id);
create index edge_source_idx on edge (source_id);
create index edge_target_idx on edge (target_id);

create table note (
  id          uuid primary key default gen_random_uuid(),
  diagram_id  uuid not null references diagram(page_id) on delete cascade,
  node_id     uuid references node(id) on delete cascade,  -- null = diagram-level note
  body_md     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (diagram_id, node_id)
);
create index note_diagram_idx on note (diagram_id);
```

**Row-level security:** turn on RLS for every table. Each policy resolves down to
`workspace.owner_id = auth.uid()` (or a later `workspace_member` join). For example,
`using (exists (select 1 from page p join workspace w on w.id = p.workspace_id where p.id = diagram.page_id and w.owner_id = auth.uid()))`.
Child tables never trust a `workspace_id` sent by the client.

The `.pandadraw` export envelope is `{ format: 'pandadraw', version: 1, workspace, pages[], diagrams[], exportedAt }`.
It maps one-to-one onto these tables. Node notes are stored on `DNode.note` locally and become `note`
rows with a `node_id` on the server.

---

## c. Step 1 implementation notes — main workspace layout

The layout has four columns, left to right: **sidebar | shape library | canvas | notes drawer**,
with a slim top bar spanning the canvas area.

| Region | Behaviour | Why |
|---|---|---|
| Sidebar (Docmost-style) | Collapsible and resizable (200–420 px, width saved). Holds the workspace title, the blue "New diagram" button, search, and the nested tree with a ⋯ row menu and right-click menu. | Keeps navigation apart from drawing, as Docmost does. |
| Shape library | Its own collapsible column between the sidebar and the canvas. Collapses to a 44 px rail. | Draw.io users expect shapes on the left next to the canvas. A floating panel would cover content. Its own column means it never covers the canvas. |
| Canvas | Infinite pan and zoom viewport with dot grid, minimap (bottom right), zoom controls (bottom left), and a context toolbar (top centre, shown only when something is selected). | The diagram is the document. Everything else can be collapsed. |
| Notes drawer | On the right, toggled from the top bar. Resizable, width saved. Shows the diagram note, or the node note when exactly one node is selected. | Prose sits next to the diagram rather than on top of it. |
| Top bar | Diagram title (editable), save status, undo/redo, default connector style, grid snap, export/import, theme, shortcuts (`?`), drawer toggle. | Controls that apply to the whole diagram, in one place. |

State is split three ways. Persisted document data lives in `docStore`. Transient UI state lives in
`sessionStore`. Undo stacks live in `history`, so typing or selecting never creates undo steps or
storage writes. The URL holds only `?d=<pageId>`. A hard refresh at `/draw/` restores the last active
page from storage.

---

## Decision log (deviations from the original prompt, and why)

| # | Decision | Reason |
|---|---|---|
| 1 | **React + Vite + TypeScript, static, `base: '/draw/'`** instead of Next.js App Router. | The brief requires it: the static Pages host has no Node runtime. |
| 2 | **Custom canvas engine instead of `@xyflow/react`.** | The npm registry was blocked in the build environment and `@xyflow/react` was not in the local package cache, so it could not be installed. The brief allows the "closest alternative" that keeps the CSP and static constraints. I wrote a small engine (`components/canvas/*`, `lib/route.ts`, `lib/geometry.ts`) covering what the brief uses React Flow for: pan/zoom viewport, custom shape nodes, N/E/S/W ports with snap, an orthogonal/straight/bezier router, marquee and shift selection, resize handles, a minimap, a dot grid and zoom controls. It has no runtime dependencies and needs no `eval`. |
| 3 | **Tailwind CSS v4 (`@tailwindcss/vite`) instead of v3 + PostCSS.** | Tailwind v3 and autoprefixer were not in the offline cache. v4 was. The theme still runs on CSS variables with class-based dark mode (`@custom-variant dark`), so dark/light is one class toggle on `<html>`, as the brief requires. |
| 4 | **No `@vitejs/plugin-react`; esbuild compiles JSX (`jsx: 'automatic'`).** | The plugin's Babel dependency tree was not cached. The production output is the same. The only loss is React Fast Refresh in dev, so edits do a full reload. |
| 5 | **Packages were taken from the local npm cache** (exact versions are pinned in `package.json`). | No network. On a normal machine, `npm install` resolves the same pinned versions from the registry. |
| 6 | **Scroll pans; Ctrl/⌘ + wheel (and trackpad pinch) zooms.** The toolbar has +/−/fit/100%. | "Scroll pans" and "wheel zooms" conflict for one input. This split matches Figma and Draw.io's default and keeps trackpads usable. |
| 7 | **Marquee on plain drag on empty canvas.** Pan with Space + drag, middle-drag or right-drag. | This is the brief's mapping (space-drag pans), and it keeps marquee one gesture away. |
| 8 | **Edge arrowheads are computed polygons, not SVG `<marker>`s.** | Polygons follow the edge colour in every browser, and SVG export produces the same geometry. |
| 9 | **The page tree has two kinds, folder and diagram.** Only folders contain children. | Makes move-to-folder and indent/outdent unambiguous. Reordering uses explicit up/down and indent/outdent, without drag. |
| 10 | **Import merges into a new folder `Imported – <workspace name>`.** Ids are remapped, nothing is dropped, and dangling edges are kept and counted in the report. | The brief says never drop data silently and report counts. A separate folder makes a bad import easy to delete. |
| 11 | **Markdown: raw HTML is escaped, and links/images allow only `http(s)`, `mailto`, `#` and `data:image`.** Remote images are not loaded. | Enough sanitising without DOMPurify. CSP `img-src 'self' data:` would block remote images anyway. |
| 12 | **Undo history keeps 100 steps per diagram, in memory only.** | The brief asks for at least 50. Storing history would double localStorage usage. |
| 13 | **`?selftest=1` renders JSON inside `<pre id="selftest-json">` and sets `document.title`.** | The host is static, so no HTTP JSON endpoint is possible. A headless browser can read the result. |
