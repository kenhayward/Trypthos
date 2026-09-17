# Spec: the vault graph

**Status: specified, not built.** Nothing in this document describes code that exists today. It is
the design the work is measured against, agreed before the first line of it.

Trypthos opens Obsidian vaults. This specifies a **link graph** over one: every note, attachment and
tag drawn as a node, every link as an edge, with a **global graph** of the whole vault in a centre
tab and a **local graph** of the open note's neighbourhood in a pane under the workspace trees. A
node is navigable - double-click a note to open it, double-click an unresolved link to create the
note it names.

## Decisions taken, and why

| Decision | Choice | Reason |
|---|---|---|
| Renderer | **Sigma.js v3 + graphology** | Vaults run to thousands of notes. React Flow's DOM nodes degrade past roughly 500-1,000; Sigma draws in WebGL and stays smooth at tens of thousands. graphology is the model and brings ForceAtlas2 and neighbourhood queries. |
| Layout | **ForceAtlas2 for a fixed number of iterations, synchronously, inside an inline web worker (Vite ?worker&inline)** - ForceAtlas2 has no internal randomness, so identical input and a deterministic circular seed give identical positions. The library's own worker supervisor runs against wall-clock time and is not reproducible. An inline (blob) worker also avoids module-worker loading over file:// in the packaged app. | A link graph is not a hierarchy - it is cycles and clusters, so it wants a force layout, not dagre/elk. |
| Where indexing runs | **Main process** | Every write already passes through a main-process handler, so the index is updated where the write lands, whichever window made it. Note contents never cross into the renderer to build the graph. Option rejected: indexing in the renderer via `file:read` - thousands of IPC round trips and every note held in renderer memory. |
| Providers | **Local vaults only** | Indexing reads every note. That is instant locally and one API request per file on GitHub, which meets rate limits on a real vault. |
| Freshness | **Build on vault open (including app launch) and on refresh; incremental on the app's own writes** | The app has deliberately never watched the disk. Edits made in Obsidian meanwhile appear after a refresh. |
| Node style | **Icon discs**, both views | A pictogram inside each disc tells the kinds apart without relying on colour. |
| Node click | **Click selects, double-click opens** | Exploring a graph is mostly hovering and selecting; a single click that navigated away would punish it. |
| Positions | **Not persisted** | The fixed seed gives stability; saved positions would need a versioned file and reconciliation for added and removed notes. |
| Tags | **Included, off by default, flat** | Popular tags become hubs that pull the layout together, which is why Obsidian defaults them off. `#project/atlas` is one node named `project/atlas`, with no edge to `#project` - Obsidian's behaviour. |

## What already exists, and where the seams are

- **`packages/domain/src/wikiLink.ts`** - `parseWikiLink` reads a link; `pickWikiTarget` chooses
  among candidate files (same folder, then shortest path). The graph resolves through the **same**
  function, so the graph and following a link in the editor can never disagree.
- **An opened workspace carries `vault: true`** (`providers.js`, described in `ipcHandlers.js`).
- **`trypthos:repo/<id>`** is a reserved, read-only tab path opened by clicking a GitHub root row
  (`repoPage.ts`, `openRepoPage` in `useWorkspace`). The graph tab copies that pattern exactly.
- **`isHidden`** in `workspaceTree.ts` already excludes dot-folders, which covers `.obsidian` and
  `.trash`.
- **Main-to-renderer events** exist (`chat:event`, `window:state`, `shell:openTarget`) with preload
  `on*` subscriptions validated on arrival.
- **`NewFileDialog`** validates names; `file:saveAs` creates through the guard.

## Architecture

### Domain (`packages/domain`, pure)

**`vaultLinks.ts`** - a note's text in, its outgoing references out.

- **Links counted:** wiki links `[[...]]`, embeds `![[...]]`, markdown links `[x](path)` whose target
  is a vault path rather than a URL (URL-decoded, resolved relative to the note), and wiki links
  inside frontmatter values.
- `#heading` and `#^block` suffixes are stripped, so the edge is to the note. `[[#Heading]]` is a
  self-link and is dropped.
- **Tags:** inline `#tag` and frontmatter `tags:` (list or single string). A tag must contain at least
  one non-digit (`#2024` is not a tag). Tag names compare case-insensitively.
- **Not counted:** anything in a code span, fenced or indented code block, or `%% comment %%`; `# `
  headings; URL fragments.

**`vaultGraph.ts`** - builds and updates the graph.

- `buildGraph(files, referencesByNote)` resolves every reference:
  - A **name map** (lowercase file name -> every path with that name) is built once per build, and
    `pickWikiTarget` chooses among that short candidate list. Calling `pickWikiTarget` against the
    full file list per link is O(links x files) - tens of millions of comparisons on a 3,800-note
    vault.
  - Markdown-link targets resolve **by path**, not by name.
  - A target that resolves to a note is a **note** node; to any other file, an **attachment** node;
    to nothing, a **ghost** node.
  - Frontmatter `aliases` are **not** used for resolution (Obsidian uses them only for link
    suggestions).
- `neighbourhood(graph, id, depth)` - nodes and edges within `depth` hops (1-3), ignoring direction.
- `applyIndexChange(input, change)` works on the index **input** (file list + references per note),
  not on the built graph; the shell rebuilds the graph from the updated input, which is linear and
  simpler to prove correct. Changes: `written` (a file saved or created, with its references when it
  is a note) and `renamed` (a file). A folder rename triggers a full rebuild; creating an empty folder
  changes nothing.

**`ipc.ts`** - zod schemas, `.strict()` like every other request:

```
GraphSnapshot  { workspaceId, builtAt (ISO), unreadable: number, newNotes: NewNoteLocation,
                 nodes: GraphNode[], edges: GraphEdge[] }
GraphNode      { id, kind: "note" | "attachment" | "ghost" | "tag", label, path: string | null, degree }
GraphEdge      { source, target, both: boolean }
GraphProgress  { workspaceId, read: number, total: number, walking: boolean }
GraphState     { snapshot: GraphSnapshot | null, building: GraphProgress | null, error: string | null }
NewNoteLocation { mode: "root" } | { mode: "folder", folder } | { mode: "current" }
GraphChanged   { workspaceId }
GraphRequest   { workspaceId }   // for graph:snapshot and graph:refresh
```

- **Node ids:** a note or attachment is its **qualified** path (`<workspaceId>/<path>`), the form
  `openPath`, `pickWikiTarget` and `splitQualified` use; a ghost is `ghost:` + the lowercased target
  name; a tag is `tag:` + the lowercased tag name.
- **Labels:** file name without `.md`; a ghost's target as written; a tag's name.
- **Edges:** one per unordered pair; `both` when the two link to each other. Repeated links from one
  note to the same target count once. Note -> tag edges have `both: false`.
- **Never in a snapshot:** note contents, headings, aliases.

### Shell (`apps/desktop/src/vaultIndex.js`)

- One index per open **local** vault, held beside the `open` workspace map.
- **All reads go through the workspace provider**, so the boundary guard - including its realpath
  check - applies. A symlink or junction escaping the vault is refused and skipped.
- **Build** when a vault opens (including restore at launch) and on `graph:refresh`: a breadth-first
  walk, reads in **batches of 32**, yielding between batches so the main process stays responsive.
- **Progress:** `graph:progress` after each batch. `total` grows while the walk is still finding
  folders (`walking: true`).
- **Incremental:** after a **successful** `file:write` or `file:saveAs` (a `written` change) or
  `workspace:rename` (a `renamed` change for a file, a full rebuild for a folder), the handler applies
  the change and emits `graph:changed`. A failed write changes nothing, and `workspace:createDirectory`
  changes nothing, since an empty folder contributes no references.
- **Events** go to every window with that workspace open.
- **Broadcast:** a new `broadcast(channel, payload)` dependency of `registerIpcHandlers` sends to
  every window (`BrowserWindow.getAllWindows()` in main.js). The existing `getWindow()` reaches only
  the main window.
- **Start:** indexing starts after a successful `workspace:open`, `workspace:openRef` or
  `obsidian:openVault` whose workspace is a local vault - which covers restore at launch, since the
  renderer reopens remembered workspaces through `workspace:openRef`.
- **Concurrency:** a refresh during a build is refused (the renderer disables the button as well); a
  write during a build is queued and applied to the finished index; closing a vault cancels its build
  and drops its index.

### IPC channels (new)

| Channel | Direction | Payload | Answer |
|---|---|---|---|
| `graph:snapshot` | renderer -> main | `GraphRequest` | `{ ok: true, state: GraphState }` - the last finished snapshot (null before the first build finishes), the build in progress if any, and the last error, if any |
| `graph:refresh` | renderer -> main | `GraphRequest` | accepted / refused (already building, not a local vault) |
| `graph:progress` | main -> renderer | `GraphProgress` | - |
| `graph:changed` | main -> renderer | `GraphChanged` | - |

Only a `workspaceId` ever crosses - never a path or a root. Pushed payloads are validated in the
renderer on arrival.

### Renderer (`apps/app`)

- **`useVaultGraph(workspaceId)`** - fetches the snapshot, subscribes to progress and change events,
  holds the graphology graph, and applies the **300 ms** delay before any progress is shown.
- **`graphLayout.worker.ts`** - ForceAtlas2 with a fixed seed.
- **`GraphCanvas`** - the Sigma wrapper shared by both views, using `@sigma/node-image` for icon
  discs.
- **`graphFilters.ts`** (pure) - chip filters, orphan detection, search matching.
- **`graphPage.ts`** (domain or lib, pure) - the reserved `trypthos:graph/<workspaceId>` path, its
  parse, and the guard that it never resolves against a provider.
- **Theme:** Sigma draws in WebGL and cannot read CSS variables, so a small adapter reads the tokens
  from `index.css` (`--tp-obsidian` for notes, `--tp-leaf` for attachments, `--tp-ink-4` for ghosts
  and edges, a tag colour token, `--tp-ink-3` for labels) and re-applies them on a theme change.
- **Lazy:** Sigma, graphology, the layout worker and both views load only when a graph is shown.

## The interface

### Global graph tab

Opened by clicking a **local vault's root row** (it still expands the row as today). The tab is
read-only and titled with the vault's name.

**Toolbar, two lines:**

1. A **single-line refresh button, icon only**, at the far left, then the filter chips: **Notes**
   (on), **Attachments** (off), **Tags** (off), **Unresolved** (on), **Orphans** (on). Orphans are
   notes with no edge to a note, attachment or ghost - tag edges do not count, so turning Tags on
   never changes which notes are orphans.
2. A **full-width search bar**. Typing highlights matching nodes and dims the rest; Enter centres on
   and selects the best match.

The refresh button has a tooltip and accessible name ("Refresh graph"), matches the chips' height,
and is disabled with a spinning icon while a build runs.

**Canvas:**

- Icon discs sized by degree: page glyph (note), image glyph (attachment), `#` glyph (tag), a muted
  disc (ink-4 token) with a `+` pictogram (ghost) - WebGL circles cannot be dashed cheaply.
- Edges carry arrowheads for direction; `both` edges carry one at each end.
- Labels show above a zoom threshold, and always for the selected or hovered node and its neighbours.
- The note in the active editor tab is enlarged and highlighted, its label always shown.
- Zoom in / zoom out / fit, bottom right.
- **Status line**, bottom left: `412 notes - 1,208 links - indexed 2 min ago`, or progress, or an
  error.

### Local graph pane

- At the bottom of the left panel, under the workspace trees, **present whenever at least one vault
  is open**.
- **Header:** "Local graph", a **depth dropdown** (1-3, default 1) and a **collapse button drawn with
  `Glyph`** (a chevron icon, not a text character) with a tooltip and accessible name. Collapsed, the
  pane shrinks to its header.
- **Follows the active tab.** When the active tab is not a note in a local vault (a plain-folder
  file, the guide, a graph tab, a GitHub vault note) it shows "Open a note in a vault to see its
  links".
- Filters apply as in the global tab except Orphans, and the centre note is always shown.
- Fixed height.

### Interactions (both views)

| Action | Effect |
|---|---|
| Hover a node | Highlight it and its neighbours; dim the rest |
| Click a node | Select it; the highlight stays |
| Click empty canvas | Clear the selection |
| Double-click a note or attachment | Open it, exactly as a tree click does |
| Double-click a ghost | Open **New File** prefilled with the ghost's name and the folder from Obsidian's "Default location for new notes" (`.obsidian/app.json`: vault root, a named folder, or beside the first linking note). Creating it updates the index through the write hook, and the ghost becomes a note |
| Double-click a tag | Select it (no file to open) |
| Drag a node | Move it for this session only |
| Keyboard | Tab focuses the canvas; arrow keys move between neighbours; Enter opens |

### Progress

Shown only when a build is **still running after about 300 ms**, so small vaults never flash.

| State | Global tab | Local pane |
|---|---|---|
| First build | Centred label "Indexing <vault>", a bar, and `1,240 of 3,812 files` (`3,812+` while still walking) | A thin bar under the header and `Indexing - 33%` |
| Refresh | Previous graph stays usable; thin bar under the toolbar; status `Refreshing - 2,360 of 3,812 files - showing index from 2 min ago` | Thin bar under the header; previous graph stays |
| Collapsed pane | - | Thin bar under the header only |
| Done | Status returns to counts and "indexed just now" | Bar removed |

### Settings

A `graph` block in settings - chip states, local depth, local collapsed - global rather than per
vault. This bumps `SETTINGS_VERSION`; the migration adds the defaults and touches nothing else.
Nothing else is persisted: the index lives in memory only, so it needs no `schemaVersion`.

### Strings

Every label under `graph.*` in `en.json`, plain hyphens only.

## Errors and edge cases

- **Unreadable file** (permissions, deleted mid-walk): skipped and counted; status reads
  `3,811 notes - 1 file could not be read`.
- **Vault root vanishes or the walk fails:** the build stops, `GraphState.error` is set, the
  status line shows the error in the danger colour, and the refresh icon is the retry. The previous
  snapshot, if any, stays visible beside the error, labelled with its age. A stored snapshot is
  always a finished build; a partial walk never overwrites it.
- **Graph too large for the WebGL renderer:** an inline error in the canvas, not a crash.
- **`.obsidian/app.json` missing, unreadable or unexpected:** parsed with zod; any failure means new
  notes default to the vault root.
- **Duplicate note names:** each link resolves from its own note via `pickWikiTarget`, so two notes
  can link to different same-named files - as the editor does.
- **Case:** paths compare case-insensitively (Obsidian's rule on every platform); the real path is
  kept for opening. On a case-sensitive filesystem, two files differing only by case stay two nodes,
  and a link resolves to the first in path order.
- **Empty vault:** "No notes in this vault yet".

## Security

- Every read goes through the provider's guard; symlink escapes are refused.
- Opening a node sends only its path through the existing `file:read` channel, re-validated in the
  main process. Link targets resolve against the name map, which holds only files already inside the
  vault, so `[[../../x]]` cannot name anything outside it; markdown-link paths are normalised and
  dropped if they leave the root.
- The new channels accept only a `workspaceId`.
- Note contents never leave the main process for the graph; a hostile note can only influence a label,
  which Sigma draws as canvas text - nothing is interpreted as HTML.
- A ghost's name goes through `NewFileDialog`'s validation and the `file:saveAs` guard.

## Testing

Test first, per the project rule.

**Domain (vitest):**

- `vaultLinks.test.ts` - every link form; the skip cases (code span, fenced and indented code, `%%`);
  tags inline and in frontmatter, `#2024` and `# Heading` rejected, URL fragments rejected.
- `vaultGraph.test.ts` - resolution (same folder, shortest path, markdown by path); ghosts collapse by
  name; `both` flag; degree; **agreement with `pickWikiTarget` over every fixture**; `neighbourhood`
  at depths 1-3; `applyIndexChange` for `written` (a saved note re-extracts its edges and tags, a tag
  left with no notes is removed; a created file resolves any ghost with a matching name and moves its
  incoming edges across) and `renamed` (the node is re-keyed; links that named the old name become
  ghosts).
- `ipc.test.ts` - the new schemas reject stray fields.
- Settings migration adds the `graph` defaults and nothing else.

**Shell (`node --test`, hand-written fake provider):**

- `vaultIndex.test.js` - batched reads; progress order; dot-folders skipped; unreadable files counted;
  root failure sets `GraphState.error` and leaves the previous snapshot in place; close cancels a
  build; refresh during a build refused; write during a build queued; a symlink escape refused
  through the guard.
- Handler tests - each graph channel validates its payload; a successful write updates the index and a
  failed one does not; events reach every window showing the workspace.
- `secretsLeakGuard` stays green, and a fixture note with a unique marker proves no content reaches a
  snapshot.

**Renderer, jsdom:**

- `useVaultGraph` against snapshot, progress and change events, including the 300 ms delay.
- `graphFilters` (chips, orphans, search) as pure functions.
- Graph tab path helpers, and the guard that `trypthos:graph/` never reaches a provider.
- A local vault's root row opens the graph tab; a GitHub vault's does not.
- The local pane's placeholder, depth dropdown and persisted collapse.
- `i18nKeys.test.ts` and `noFancyDashes.test.ts` cover the new strings without change.

**Renderer, real Chromium (`test:browser`):**

- Sigma paints with theme tokens in light and dark, and a theme switch repaints.
- Single click selects, double click opens, double-clicking a ghost opens the prefilled dialog - using
  `userEvent` from `@vitest/browser/context`.
- Progress states render.
- The layout worker gives the same positions for the same seed.

**Module graph:** Sigma, graphology and the layout worker are imported only by lazy graph modules,
never by an eager one - the same shape as `richBlocksBundle.test.ts`.

## Delivery

One feature PR, a **Minor** bump. New dependencies, all MIT: `sigma`, `graphology`,
`graphology-types`, `graphology-layout`, `graphology-layout-forceatlas2`, `@sigma/node-image`.

Release checklist:

1. `version.json` and every mirror.
2. `RECENT[0]` entry.
3. About-box row "Vault graph", and third-party disclaimers for the six libraries.
4. README Features row and `docs/features.md` bullet, in lockstep.
5. `docs/Architecture.md` - the graph channels, the main-to-renderer events, the index lifecycle, the
   new dependencies.
6. Deployment surface in the PR body: needs a release.

The app has no help-article system yet (the Markdown guide is the only in-app document), so no
article ships with this feature.

## Out of scope - for future reference

Each of these was considered and deliberately left out of this version. None is blocked by the
design above; the notes say what each would need.

| Item | Why not now | What it would take |
|---|---|---|
| **GitHub vaults** | One API request per note meets rate limits on a real vault | Fetch the repository as one tree or archive, index from that; a slower first build with progress |
| **Disk watcher** | The app has never watched the disk; edits in Obsidian appear after a refresh | A per-vault watcher with debouncing and platform quirks, feeding `applyIndexChange` |
| **Saved node positions** | A fixed seed already gives a stable shape | A `schemaVersion`ed positions file per vault in app data (never in the vault), reconciled against added and removed notes |
| **Backlinks list** | Not needed for the graph itself | A keyboard- and screen-reader-friendly list of incoming and outgoing links for the open note, read from the same index |
| **Nested tag trees** | Obsidian draws tags flat | An edge from `#a/b` to `#a`, behind its own option |
| **Alias resolution** | Obsidian does not resolve links by alias | Read frontmatter `aliases` into the name map |
| **Resizable local pane** | Fixed height is enough to start | A `PanelDivider` between the trees and the pane, height persisted in settings |
| **Graph views for non-vault folders** | Scope limited to Obsidian vaults | Treat any markdown folder's links as a graph; mostly a question of which link forms count |
| **Colour groups** | Not requested | Obsidian's `graph.json` groups, or per-folder colour, through the theme adapter |
| **Display and force settings** | Toolbar kept to filters and search | Node size, link thickness and force parameters in a settings popover |
| **Worker-thread indexing** | Batched reads keep the main process responsive at expected sizes | Move `vaultIndex` parsing to a Node worker thread; the IPC contract does not change |
| **Separate graph window** | The graph lives in the main window | Window lifecycle and cross-window navigation |
