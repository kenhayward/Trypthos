# Vault Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global link graph of a local Obsidian vault in a centre tab, and a local graph of the open note in a pane under the workspace trees, both navigable, drawn with Sigma.js from an index built in the main process.

**Architecture:** Pure domain modules extract links and tags from note text and build the graph (`vaultLinks.ts`, `vaultGraph.ts`). A main-process index (`vaultIndex.js`) walks a vault through its provider, reports progress, updates on the app's own writes and broadcasts changes. The renderer fetches a contents-free snapshot, lays it out deterministically (ForceAtlas2, fixed iterations, in an inline worker) and draws it with Sigma in lazily loaded components.

**Tech Stack:** TypeScript, zod, Electron (CommonJS shell), React 19, Tailwind v4, Vite, vitest (jsdom + Playwright Chromium), `node --test`, sigma 3, graphology, graphology-layout, graphology-layout-forceatlas2, @sigma/node-image.

**Spec:** `docs/specs/vault-graph.md` (amended in Task 1 - read it after Task 1 lands).

**Delivery:** ONE feature PR from branch `spec/vault-graph` (already holds the spec commit). Commit after every task; push and open the PR in the last task only.

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine: no warnings, no `console.error` (the jsdom setup fails a test on one).
- Commands run from the repo root. Never `npm install` to restore - `npm ci`. Adding dependencies happens once, in Task 11, with `npm install --workspace trypthos-app ...`.
- Domain package: no React, Electron or `fs` imports. Tests sit beside modules, `import { describe, expect, it } from "vitest";`, relative imports.
- Shell: CommonJS, tests in `apps/desktop/test/*.test.js` with `node:test` + `node:assert/strict`. Every name destructured from `@trypthos/domain` must be exported from `packages/domain/src/index.ts` (`domainExports.test.js` enforces it). Run `npm run build --workspace @trypthos/domain` before shell tests (the desktop `pretest` does this).
- Failures are results (`{ ok: false, reason }`), not throws, across IPC.
- Only a `workspaceId` crosses the new IPC channels. Payloads are zod-validated on both sides.
- Node ids are **qualified paths** (`<workspaceId>/<path>`), the form `openPath`, `pickWikiTarget` and `splitQualified` already use.
- Every user-facing string lives in `apps/app/src/locales/en.json` under `graph.*`, read with a literal `t("graph.x")` (no computed keys, no `_one`/`_other` plural suffixes - the repo uses `{{count}} files` style). Plain hyphen `-` only, never em/en dashes.
- Colours come from tokens (`--tp-*` in `apps/app/src/index.css`); the WebGL canvas reads them through `getComputedStyle`, never hex literals.
- sigma pinned `^3.0.3` (sigma 4 is beta). Sigma must never be constructed under jsdom; canvas components are injected in jsdom tests with hand-written fakes.
- Sigma, graphology, `@sigma/*` and the layout worker are imported statically ONLY by: `apps/app/src/components/GraphPage.tsx`, `apps/app/src/components/LocalGraph.tsx`, `apps/app/src/components/GraphCanvas.tsx`, `apps/app/src/lib/graphLayout.ts`, `apps/app/src/lib/graphLayout.worker.ts`, `apps/app/src/lib/layoutClient.ts`. Those files are reached from elsewhere only through `lazy(() => import(...))`.
- When writing files containing regex escapes use the editor tools, never a shell heredoc (backslashes get halved on this machine).
- Version: `0.83.0` -> `0.84.0` (functional enhancement). Settings: `SETTINGS_VERSION` `20` -> `21`.

## File Map

**Domain (`packages/domain/src`)**
| File | Responsibility |
|---|---|
| `vaultLinks.ts` (+test) | Note text -> `{ links, tags }`, ignoring code and `%%` comments |
| `vaultGraph.ts` (+test) | Index input -> nodes/edges; `neighbourhood`; `applyIndexChange` |
| `graphPage.ts` (+test) | Reserved tab path `trypthos:graph/<workspaceId>` |
| `obsidianAppConfig.ts` (+test) | `.obsidian/app.json` -> new-note location; directory for a ghost |
| `ipc.ts`, `ipc.test.ts` | Graph schemas, channels, push-channel constants |
| `settings.ts`, `settings.test.ts` | `graph` block, version 21 |
| `index.ts` | Barrel exports |

**Shell (`apps/desktop`)**
| File | Responsibility |
|---|---|
| `src/vaultIndex.js`, `test/vaultIndex.test.js` | Per-vault index: walk, batched reads, progress, cancel, queue, incremental |
| `src/ipcHandlers.js`, `test/graphIpc.test.js` | Channels, start on open, drop on close, update on writes, `broadcast` dependency |
| `src/preload.js`, `test/preloadBridge.test.js` | Bridge methods and subscriptions |
| `src/main.js` | Passes `broadcast` |
| `test/secretsIpc.test.js` | (unchanged unless it fails - it enumerates channels) |

**Renderer (`apps/app/src`)**
| File | Responsibility |
|---|---|
| `lib/workspaceClient.ts` | Bridge typing + `browserClient` stubs |
| `hooks/useVaultGraph.ts` (+test) | Snapshot, progress (300 ms delay), change events, refresh |
| `lib/graphFilters.ts` (+test) | Chips, orphans, search, neighbours - pure |
| `lib/graphStatus.ts` (+test) | Index age and percent - pure |
| `lib/graphTheme.ts` (+test) | Token palette, theme observer, pictogram data URIs |
| `lib/graphLayout.ts` (+test) | Deterministic layout (circular seed + ForceAtlas2) |
| `lib/graphLayout.worker.ts`, `lib/layoutClient.ts` | Inline worker and its promise client |
| `hooks/useGraphLayout.ts` (+test) | Runs a layout runner when the graph changes |
| `components/GraphCanvas.tsx` (+browser test) | Sigma wrapper: programs, reducers, events, drag, keyboard, zoom |
| `components/GraphPage.tsx` (+test) | Global tab: toolbar, search, status, progress, errors |
| `components/LocalGraphPane.tsx` (+test) | Eager pane shell: header, depth, collapse, placeholder, progress |
| `components/LocalGraph.tsx` (+test) | Lazy body: neighbourhood + canvas |
| `components/NewFileDialog.tsx` (+test) | `initialName` prop |
| `components/WorkspacePanel.tsx` (+test) | `vault` on workspaces, root click opens graph, `bottomPane` slot |
| `hooks/useWorkspace.ts` (+test) | `openGraphPage` |
| `App.tsx` (+test) | Page slot, chat exclusion, ghost dialog, local pane, settings |
| `lib/graphBundle.test.ts` | Module-graph guard |
| `locales/en.json` | `graph.*` strings |

**Docs / release:** `version.json` + mirrors, `apps/app/src/lib/releaseNotes/current.ts`, `apps/app/src/lib/appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`.

---
### Task 1: Amend the spec with what research found

Docs-only; no test. These corrections came from reading the code and the library sources after the spec was approved. Every later task follows the amended spec.

**Files:**
- Modify: `docs/specs/vault-graph.md`

- [ ] **Step 1: Apply the amendments**

Make these edits in `docs/specs/vault-graph.md`:

1. In "Decisions taken", Layout row, replace the cell text with: `**ForceAtlas2 for a fixed number of iterations, synchronously, inside an inline web worker (Vite ?worker&inline)** - ForceAtlas2 has no internal randomness, so identical input and a deterministic circular seed give identical positions. The library's own worker supervisor runs against wall-clock time and is not reproducible. An inline (blob) worker also avoids module-worker loading over file:// in the packaged app.`
2. In "Domain", `ipc.ts` block, replace the schema listing with:
```
GraphSnapshot  { workspaceId, builtAt (ISO), unreadable: number, newNotes: NewNoteLocation,
                 nodes: GraphNode[], edges: GraphEdge[] }
GraphNode      { id, kind: "note" | "attachment" | "ghost" | "tag", label, path: string | null, degree }
GraphEdge      { source, target, both: boolean }
GraphProgress  { workspaceId, read: number, total: number, walking: boolean }
GraphState     { snapshot: GraphSnapshot | null, building: GraphProgress | null, error: string | null }
NewNoteLocation { mode: "root" } | { mode: "folder", folder } | { mode: "current" }
GraphChanged   { workspaceId }
GraphRequest   { workspaceId }
```
   and replace the "Node ids" bullet with: `**Node ids:** a note or attachment is its **qualified** path (\`<workspaceId>/<path>\`), the form \`openPath\`, \`pickWikiTarget\` and \`splitQualified\` use; a ghost is \`ghost:\` + the lowercased target name; a tag is \`tag:\` + the lowercased tag name.` Remove every other mention of `complete` (a stored snapshot is always a finished build; a failed build is `GraphState.error` beside the previous snapshot).
3. In the IPC table, the `graph:snapshot` answer becomes `{ ok: true, state: GraphState }`.
4. Replace `applyIndexChange(graph, change)` bullet list with: `applyIndexChange(input, change)` works on the index **input** (file list + references per note), not on the built graph; the shell rebuilds the graph from the updated input, which is linear and simpler to prove correct. Changes: \`written\` (a file saved or created, with its references when it is a note) and \`renamed\` (a file). A folder rename triggers a full rebuild; creating an empty folder changes nothing.
5. Orphans (toolbar list item 1): `Orphans are notes with no edge to a note, attachment or ghost - tag edges do not count, so turning Tags on never changes which notes are orphans.`
6. Canvas bullets: ghost is `a muted disc (ink-4 token) with a + pictogram` (WebGL circles cannot be dashed cheaply); the active note is `enlarged and highlighted, its label always shown` instead of "ringed".
7. Shell section: add bullet `**Broadcast:** a new \`broadcast(channel, payload)\` dependency of \`registerIpcHandlers\` sends to every window (\`BrowserWindow.getAllWindows()\` in main.js). The existing \`getWindow()\` reaches only the main window.` and bullet `**Start:** indexing starts after a successful \`workspace:open\`, \`workspace:openRef\` or \`obsidian:openVault\` whose workspace is a local vault - which covers restore at launch, since the renderer reopens remembered workspaces through \`workspace:openRef\`.`
8. Delivery: dependencies become `sigma`, `graphology`, `graphology-types`, `graphology-layout`, `graphology-layout-forceatlas2`, `@sigma/node-image` (all MIT). Remove checklist item 6 (help article) and add under it: `The app has no help-article system yet (the Markdown guide is the only in-app document), so no article ships with this feature.`
9. Local graph pane: `Filters apply as in the global tab except Orphans, and the centre note is always shown.`

- [ ] **Step 2: Commit**

```bash
git add docs/specs/vault-graph.md
git commit -m "Amend the vault graph spec with findings from the code and library sources"
```

---

### Task 2: Extract links and tags from a note (`vaultLinks.ts`)

**Files:**
- Create: `packages/domain/src/vaultLinks.ts`
- Test: `packages/domain/src/vaultLinks.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `splitFrontMatter(text): { properties: { key: string; values: string[] }[] | null; body: string }` from `./frontMatter`; `parseWikiLink(inner): { target; heading; block; alias }` from `./wikiLink`; `isExternalUrl(url): boolean`, `isUnsupportedScheme(href): boolean` from `./markdownLink`.
- Produces:
```ts
export type NoteReference = { kind: "wiki"; target: string } | { kind: "path"; path: string };
export interface NoteReferences { links: NoteReference[]; tags: string[] }
export function extractReferences(text: string): NoteReferences;
export function maskIgnored(body: string): string;
```
`wiki.target` is the target as written, without heading/block. `path.path` is the decoded href without `#`/`?`, not yet resolved. `tags` are lowercase, without `#`, unique, in first-seen order. Links are unique by kind+value, in first-seen order.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/vaultLinks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractReferences, maskIgnored } from "./vaultLinks";

const wiki = (target: string) => ({ kind: "wiki" as const, target });
const path = (value: string) => ({ kind: "path" as const, path: value });

describe("the links a note makes", () => {
  it("reads wiki links, dropping headings, blocks and aliases", () => {
    const text = "See [[Plan]], [[Plan#Goals]], [[Road map|the map]] and [[Risks#^b1]].";
    expect(extractReferences(text).links).toEqual([wiki("Plan"), wiki("Road map"), wiki("Risks")]);
  });

  it("reads embeds as links", () => {
    expect(extractReferences("![[diagram.png]]\n![[Plan#Goals]]").links).toEqual([
      wiki("diagram.png"),
      wiki("Plan"),
    ]);
  });

  it("drops a link to a heading in the same note", () => {
    expect(extractReferences("Jump to [[#Later]].").links).toEqual([]);
  });

  it("reads markdown links to vault files, decoded, without fragments", () => {
    const text = "[a](Plan.md) [b](../Other%20note.md#top) [c](<Folder/Road map.md>) ![d](img/x.png?raw=1)";
    expect(extractReferences(text).links).toEqual([
      path("Plan.md"),
      path("../Other note.md"),
      path("Folder/Road map.md"),
      path("img/x.png"),
    ]);
  });

  it("ignores web addresses, other schemes and bare anchors", () => {
    const text = "[w](https://example.com/a.md) [m](mailto:ada@example.com) [f](file:///x.md) [h](#top)";
    expect(extractReferences(text).links).toEqual([]);
  });

  it("keeps a malformed escape out rather than throwing", () => {
    expect(extractReferences("[x](bad%E0%A4%A.md)").links).toEqual([]);
  });

  it("reads wiki links in front matter values", () => {
    const text = "---\nrelated: \"[[Plan]]\"\nup:\n  - \"[[Index]]\"\n---\nBody";
    expect(extractReferences(text).links).toEqual([wiki("Plan"), wiki("Index")]);
  });

  it("counts a repeated link once", () => {
    expect(extractReferences("[[Plan]] [[Plan]] [[plan#x]]").links).toEqual([wiki("Plan"), wiki("plan")]);
  });

  it("ignores links in code spans, fenced and indented code, and comments", () => {
    const text = [
      "Real [[One]].",
      "`[[InSpan]]`",
      "```",
      "[[InFence]]",
      "```",
      "~~~md",
      "[[InTilde]]",
      "~~~",
      "",
      "    [[Indented]]",
      "",
      "%% [[Hidden]] %%",
      "%%",
      "[[HiddenBlock]]",
      "%%",
      "Real [[Two]].",
    ].join("\n");
    expect(extractReferences(text).links).toEqual([wiki("One"), wiki("Two")]);
  });

  it("does not take a nested list item for indented code", () => {
    expect(extractReferences("- item\n    - [[Nested]]").links).toEqual([wiki("Nested")]);
  });
});

describe("the tags a note carries", () => {
  it("reads inline tags, lowercased and unique", () => {
    expect(extractReferences("#Inbox and (#project/atlas) then #inbox").tags).toEqual([
      "inbox",
      "project/atlas",
    ]);
  });

  it("rejects numbers, headings, words with a hash inside and URL fragments", () => {
    const text = "# Heading\n#2024 is a year, a#b is not a tag, see https://example.com/#frag";
    expect(extractReferences(text).tags).toEqual([]);
  });

  it("accepts a tag with digits when it has a letter", () => {
    expect(extractReferences("#y2024").tags).toEqual(["y2024"]);
  });

  it("reads front matter tags as a list or a string, with or without hashes", () => {
    expect(extractReferences("---\ntags: [Alpha, \"#beta\"]\n---\n").tags).toEqual(["alpha", "beta"]);
    expect(extractReferences("---\ntags:\n  - gamma\n---\n").tags).toEqual(["gamma"]);
    expect(extractReferences("---\ntag: delta, epsilon\n---\n").tags).toEqual(["delta", "epsilon"]);
  });

  it("ignores tags in code and comments", () => {
    expect(extractReferences("`#code`\n```\n#fence\n```\n%% #comment %%").tags).toEqual([]);
  });
});

describe("masking what Obsidian does not read", () => {
  it("keeps line structure so positions stay put", () => {
    const text = "a `b` c\n```\nx\n```\nd";
    const masked = maskIgnored(text);
    expect(masked.length).toBe(text.length);
    expect(masked.split("\n").length).toBe(text.split("\n").length);
    expect(masked).toContain("a");
    expect(masked).not.toContain("b");
    expect(masked).not.toContain("x");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/domain vaultLinks`
Expected: FAIL - `Failed to resolve import "./vaultLinks"`.

- [ ] **Step 3: Implement**

`packages/domain/src/vaultLinks.ts`:

```ts
import { splitFrontMatter } from "./frontMatter";
import { isExternalUrl, isUnsupportedScheme } from "./markdownLink";
import { parseWikiLink } from "./wikiLink";

/// The links and tags one note carries, as the vault graph reads them.
///
/// Nothing here resolves anything: a wiki link is kept as the name written, and a markdown link as
/// the path written. Resolution needs the whole vault, which is `vaultGraph.ts`'s job, and keeping it
/// out of here is what lets the shell extract a note once and resolve it again whenever the file
/// list changes.

export type NoteReference = { kind: "wiki"; target: string } | { kind: "path"; path: string };

export interface NoteReferences {
  links: NoteReference[];
  tags: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const WIKI = /!?\[\[([^[\]\n]+)\]\]/g;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\s*\)/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const COMMENT = /%%[\s\S]*?%%/g;
const CODE_SPAN = /(`+)[^`\n]*?\1/g;
const TAG_KEYS = new Set(["tags", "tag"]);

/// Every character Obsidian does not read as markup replaced by a space, newlines kept.
///
/// Masking rather than deleting keeps a tag's neighbour a neighbour: deleting a code span would glue
/// the words either side together, and `a`x`#b` would read as a tag.
export function maskIgnored(body: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const lines = body.split("\n");
  let fence: string | null = null;
  let previousBlank = true;
  let inIndented = false;

  const masked = lines.map((line) => {
    if (fence !== null) {
      const closing = FENCE.exec(line);
      if (closing !== null && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length) fence = null;
      return blank(line);
    }
    const opening = FENCE.exec(line);
    if (opening !== null) {
      fence = opening[1]!;
      previousBlank = false;
      inIndented = false;
      return blank(line);
    }
    const isBlank = line.trim() === "";
    const indented = /^( {4}|\t)/.test(line) && !isBlank;
    if (indented && (previousBlank || inIndented)) {
      inIndented = true;
      previousBlank = false;
      return blank(line);
    }
    inIndented = indented && inIndented;
    previousBlank = isBlank;
    return line;
  });

  return masked.join("\n").replace(COMMENT, blank).replace(CODE_SPAN, blank);
}

function pathOf(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  if (isExternalUrl(trimmed) || isUnsupportedScheme(trimmed)) return null;
  const bare = trimmed.split(/[#?]/)[0]!;
  try {
    const decoded = decodeURIComponent(bare);
    return decoded === "" || decoded.includes("\0") ? null : decoded.replace(/\\/g, "/");
  } catch {
    return null;
  }
}

export function extractReferences(text: string): NoteReferences {
  const { properties, body } = splitFrontMatter(text);
  const links: NoteReference[] = [];
  const seenLinks = new Set<string>();
  const tags: string[] = [];
  const seenTags = new Set<string>();

  const addLink = (reference: NoteReference) => {
    const key = reference.kind === "wiki" ? `w:${reference.target}` : `p:${reference.path}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push(reference);
  };
  const addTag = (raw: string) => {
    const tag = raw.replace(/^#/, "").toLowerCase();
    if (!/^[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*$/u.test(tag) || seenTags.has(tag)) return;
    seenTags.add(tag);
    tags.push(tag);
  };
  const readWiki = (source: string) => {
    for (const match of source.matchAll(WIKI)) {
      const target = parseWikiLink(match[1]!).target;
      if (target !== "") addLink({ kind: "wiki", target });
    }
  };

  for (const property of properties ?? []) {
    for (const value of property.values) {
      readWiki(value);
      if (TAG_KEYS.has(property.key.toLowerCase())) {
        for (const part of value.split(/[,\s]+/)) if (part !== "") addTag(part);
      }
    }
  }

  const masked = maskIgnored(body);
  readWiki(masked);
  for (const match of masked.matchAll(MARKDOWN_LINK)) {
    const found = pathOf(match[1] ?? match[2] ?? "");
    if (found !== null) addLink({ kind: "path", path: found });
  }
  for (const match of masked.matchAll(TAG)) addTag(match[2]!);

  return { links, tags };
}
```

Note on ordering in the first test: wiki links are read before markdown links, and front matter before body, so the expected arrays above follow that order.

Add to `packages/domain/src/index.ts` beside the `wikiLink` exports:

```ts
export { extractReferences, maskIgnored } from "./vaultLinks";
export type { NoteReference, NoteReferences } from "./vaultLinks";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --root packages/domain vaultLinks`
Expected: PASS (all tests). If "does not take a nested list item" fails, the rule is: an indented line only starts indented code after a blank line.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/vaultLinks.ts packages/domain/src/vaultLinks.test.ts packages/domain/src/index.ts
git commit -m "Extract a note's links and tags for the vault graph"
```

---
### Task 3: Build the graph from an index (`vaultGraph.ts`)

**Files:**
- Create: `packages/domain/src/vaultGraph.ts`
- Test: `packages/domain/src/vaultGraph.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `NoteReferences` (Task 2); `pickWikiTarget(found, fileName, fromPath)`, `wikiLinkFileName(target)` from `./wikiLink`; `splitQualified(q): { workspaceId; path } | null`, `qualifyPath(id, path)` from `./qualifiedPath`; `matchesFileType(type, name)`, `MARKDOWN_FILE_TYPE` from `./fileTypes`.
- Produces:
```ts
export type GraphNodeKind = "note" | "attachment" | "ghost" | "tag";
export interface GraphNode { id: string; kind: GraphNodeKind; label: string; path: string | null; degree: number }
export interface GraphEdge { source: string; target: string; both: boolean }
export interface VaultGraph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface VaultIndexInput { files: readonly string[]; references: ReadonlyMap<string, NoteReferences> }
export type IndexChange =
  | { kind: "written"; path: string; references: NoteReferences | null }
  | { kind: "renamed"; from: string; to: string };
export function isNotePath(path: string): boolean;
export function buildGraph(input: VaultIndexInput): VaultGraph;
export function neighbourhood(graph: VaultGraph, centre: string, depth: number): VaultGraph;
export function applyIndexChange(input: VaultIndexInput, change: IndexChange): VaultIndexInput;
export const EMPTY_INDEX: VaultIndexInput;
```
All paths are qualified. Output nodes are sorted by `id`, edges by `source` then `target` (plain code-unit comparison), so the same vault always produces the same arrays - the layout depends on it.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/vaultGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyIndexChange, buildGraph, EMPTY_INDEX, isNotePath, neighbourhood } from "./vaultGraph";
import type { VaultIndexInput } from "./vaultGraph";
import type { NoteReferences } from "./vaultLinks";
import { pickWikiTarget, wikiLinkFileName } from "./wikiLink";

const refs = (links: NoteReferences["links"] = [], tags: string[] = []): NoteReferences => ({ links, tags });
const wiki = (target: string) => ({ kind: "wiki" as const, target });
const path = (value: string) => ({ kind: "path" as const, path: value });

function input(files: string[], references: Record<string, NoteReferences>): VaultIndexInput {
  return { files, references: new Map(Object.entries(references)) };
}

const node = (graph: ReturnType<typeof buildGraph>, id: string) => graph.nodes.find((n) => n.id === id);

describe("which files are notes", () => {
  it("is decided by the markdown file type", () => {
    expect(isNotePath("V/Plan.md")).toBe(true);
    expect(isNotePath("V/a/Plan.MARKDOWN")).toBe(true);
    expect(isNotePath("V/diagram.png")).toBe(false);
  });
});

describe("building the graph", () => {
  it("draws every file, notes and attachments, with labels", () => {
    const graph = buildGraph(input(["V/Plan.md", "V/img/diagram.png"], { "V/Plan.md": refs() }));
    expect(graph.nodes).toEqual([
      { id: "V/Plan.md", kind: "note", label: "Plan", path: "V/Plan.md", degree: 0 },
      { id: "V/img/diagram.png", kind: "attachment", label: "diagram.png", path: "V/img/diagram.png", degree: 0 },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("resolves a wiki link to the note in the linking note's folder first, then the shortest path", () => {
    const files = ["V/a/Plan.md", "V/b/Plan.md", "V/b/deep/Plan.md", "V/a/Home.md", "V/Top.md"];
    const graph = buildGraph(
      input(files, {
        "V/a/Home.md": refs([wiki("Plan")]),
        "V/Top.md": refs([wiki("Plan")]),
        "V/a/Plan.md": refs(),
        "V/b/Plan.md": refs(),
        "V/b/deep/Plan.md": refs(),
      }),
    );
    expect(graph.edges).toContainEqual({ source: "V/a/Home.md", target: "V/a/Plan.md", both: false });
    expect(graph.edges).toContainEqual({ source: "V/Top.md", target: "V/a/Plan.md", both: false });
  });

  it("agrees with pickWikiTarget for every link, so the graph and the editor never disagree", () => {
    const files = ["V/x/Note.md", "V/y/Note.md", "V/y/From.md", "V/Other.md"];
    const links = ["Note", "y/Note", "Other", "x/Note"];
    const graph = buildGraph(input(files, { "V/y/From.md": refs(links.map(wiki)) }));
    for (const target of links) {
      const expected = pickWikiTarget(files, wikiLinkFileName(target), "V/y/From.md");
      expect(graph.edges).toContainEqual({ source: "V/y/From.md", target: expected!, both: false });
    }
  });

  it("resolves a markdown link by path, with or without the extension", () => {
    const files = ["V/notes/From.md", "V/Other note.md", "V/img/x.png"];
    const graph = buildGraph(
      input(files, { "V/notes/From.md": refs([path("../Other note.md"), path("../img/x.png"), path("/Other note")]) }),
    );
    expect(graph.edges).toEqual([
      { source: "V/notes/From.md", target: "V/Other note.md", both: false },
      { source: "V/notes/From.md", target: "V/img/x.png", both: false },
    ]);
  });

  it("drops a markdown link that climbs out of the vault", () => {
    const graph = buildGraph(input(["V/From.md"], { "V/From.md": refs([path("../../etc/passwd")]) }));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
  });

  it("collapses every unresolved link to one name into one ghost", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("Risks")]), "V/B.md": refs([wiki("risks")]) }),
    );
    expect(node(graph, "ghost:risks")).toEqual({ id: "ghost:risks", kind: "ghost", label: "Risks", path: null, degree: 2 });
  });

  it("draws two notes linking to each other as one edge marked both", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("B")]), "V/B.md": refs([wiki("A")]) }),
    );
    expect(graph.edges).toEqual([{ source: "V/A.md", target: "V/B.md", both: true }]);
    expect(node(graph, "V/A.md")!.degree).toBe(1);
  });

  it("drops a note's link to itself", () => {
    const graph = buildGraph(input(["V/A.md"], { "V/A.md": refs([wiki("A")]) }));
    expect(graph.edges).toEqual([]);
  });

  it("links notes to shared tag nodes", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([], ["inbox"]), "V/B.md": refs([], ["inbox", "project/atlas"]) }),
    );
    expect(node(graph, "tag:inbox")).toEqual({ id: "tag:inbox", kind: "tag", label: "#inbox", path: null, degree: 2 });
    expect(node(graph, "tag:project/atlas")!.label).toBe("#project/atlas");
    expect(graph.edges).toContainEqual({ source: "V/B.md", target: "tag:inbox", both: false });
  });

  it("is deterministic whatever order the files arrive in", () => {
    const refsFor = { "V/A.md": refs([wiki("B")]), "V/B.md": refs([wiki("C")]), "V/C.md": refs() };
    const one = buildGraph(input(["V/A.md", "V/B.md", "V/C.md"], refsFor));
    const two = buildGraph(input(["V/C.md", "V/A.md", "V/B.md"], refsFor));
    expect(two).toEqual(one);
  });
});

describe("a note's neighbourhood", () => {
  const graph = buildGraph(
    input(["V/A.md", "V/B.md", "V/C.md", "V/D.md"], {
      "V/A.md": refs([wiki("B")]),
      "V/B.md": refs([wiki("C")]),
      "V/C.md": refs([wiki("D")]),
      "V/D.md": refs(),
    }),
  );

  it("follows links in either direction to the depth asked", () => {
    expect(neighbourhood(graph, "V/B.md", 1).nodes.map((n) => n.id)).toEqual(["V/A.md", "V/B.md", "V/C.md"]);
    expect(neighbourhood(graph, "V/A.md", 3).nodes.map((n) => n.id)).toEqual(["V/A.md", "V/B.md", "V/C.md", "V/D.md"]);
  });

  it("keeps only edges between the nodes it kept", () => {
    expect(neighbourhood(graph, "V/A.md", 1).edges).toEqual([{ source: "V/A.md", target: "V/B.md", both: false }]);
  });

  it("is empty for a node that is not in the graph", () => {
    expect(neighbourhood(graph, "V/Missing.md", 2)).toEqual({ nodes: [], edges: [] });
  });
});

describe("updating the index", () => {
  it("adds a newly written note and turns the ghost it satisfies into a note", () => {
    const before = input(["V/A.md"], { "V/A.md": refs([wiki("Risks")]) });
    const after = applyIndexChange(before, { kind: "written", path: "V/Risks.md", references: refs() });
    const graph = buildGraph(after);
    expect(node(graph, "ghost:risks")).toBeUndefined();
    expect(graph.edges).toEqual([{ source: "V/A.md", target: "V/Risks.md", both: false }]);
    expect(before.files).toEqual(["V/A.md"]);
  });

  it("replaces a saved note's links and drops a tag no note carries any more", () => {
    const before = input(["V/A.md"], { "V/A.md": refs([], ["inbox"]) });
    const after = applyIndexChange(before, { kind: "written", path: "V/A.md", references: refs() });
    expect(node(buildGraph(after), "tag:inbox")).toBeUndefined();
  });

  it("renames a file, leaving links to the old name as ghosts", () => {
    const before = input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("B")]), "V/B.md": refs([], ["x"]) });
    const after = applyIndexChange(before, { kind: "renamed", from: "V/B.md", to: "V/C.md" });
    const graph = buildGraph(after);
    expect(node(graph, "V/C.md")!.kind).toBe("note");
    expect(node(graph, "ghost:b")).toBeDefined();
    expect(graph.edges).toContainEqual({ source: "V/C.md", target: "tag:x", both: false });
  });

  it("leaves the index alone for a rename it does not know as a file", () => {
    const before = input(["V/a/A.md"], { "V/a/A.md": refs() });
    expect(applyIndexChange(before, { kind: "renamed", from: "V/a", to: "V/b" })).toBe(before);
  });

  it("starts empty", () => {
    expect(buildGraph(EMPTY_INDEX)).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/domain vaultGraph`
Expected: FAIL - `Failed to resolve import "./vaultGraph"`.

- [ ] **Step 3: Implement**

`packages/domain/src/vaultGraph.ts`:

```ts
import { MARKDOWN_FILE_TYPE, matchesFileType } from "./fileTypes";
import { qualifyPath, splitQualified } from "./qualifiedPath";
import type { NoteReference, NoteReferences } from "./vaultLinks";
import { pickWikiTarget, wikiLinkFileName } from "./wikiLink";

/// The vault graph: every file, tag and unresolved link as a node, every link as an edge.
///
/// **Built from the index input, never patched in place.** The shell keeps the file list and each
/// note's references, applies a change to those, and builds again. A build is linear in the vault,
/// and one function that turns an input into a graph is one thing to prove correct - a patcher and
/// a builder would be two that have to agree.
///
/// **Sorted output.** The layout seeds positions from node order, so the same vault must give the
/// same arrays whatever order the disk listed it in.

export type GraphNodeKind = "note" | "attachment" | "ghost" | "tag";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  path: string | null;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  both: boolean;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VaultIndexInput {
  files: readonly string[];
  references: ReadonlyMap<string, NoteReferences>;
}

export type IndexChange =
  | { kind: "written"; path: string; references: NoteReferences | null }
  | { kind: "renamed"; from: string; to: string };

export const EMPTY_INDEX: VaultIndexInput = { files: [], references: new Map() };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function isNotePath(path: string): boolean {
  return matchesFileType(MARKDOWN_FILE_TYPE, nameOf(path));
}

function withoutMarkdownExtension(name: string): string {
  return isNotePath(name) ? name.slice(0, name.lastIndexOf(".")) : name;
}

/// A markdown link's target against the linking note's folder, or null when it leaves the vault.
function resolveRelative(fromPath: string, target: string): string | null {
  const from = splitQualified(fromPath);
  if (from === null) return null;
  const segments = target.startsWith("/") ? [] : from.path.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? null : qualifyPath(from.workspaceId, segments.join("/"));
}

export function buildGraph(input: VaultIndexInput): VaultGraph {
  const files = [...input.files].sort(byCodeUnit);
  const byLowerPath = new Map(files.map((file) => [file.toLowerCase(), file]));
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const key = nameOf(file).toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), file]);
  }

  const nodes = new Map<string, GraphNode>();
  for (const file of files) {
    const name = nameOf(file);
    nodes.set(file, {
      id: file,
      kind: isNotePath(file) ? "note" : "attachment",
      label: isNotePath(file) ? withoutMarkdownExtension(name) : name,
      path: file,
      degree: 0,
    });
  }

  const ghost = (written: string): string => {
    const label = withoutMarkdownExtension(written);
    const id = `ghost:${label.toLowerCase()}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: "ghost", label, path: null, degree: 0 });
    return id;
  };

  const resolve = (from: string, reference: NoteReference): string | null => {
    if (reference.kind === "wiki") {
      const fileName = wikiLinkFileName(reference.target);
      const candidates = byName.get(nameOf(fileName).toLowerCase()) ?? [];
      return pickWikiTarget(candidates, fileName, from) ?? ghost(reference.target);
    }
    const resolved = resolveRelative(from, reference.path);
    if (resolved === null) return null;
    const found = byLowerPath.get(resolved.toLowerCase()) ?? byLowerPath.get(`${resolved.toLowerCase()}.md`);
    return found ?? ghost(nameOf(reference.path));
  };

  const directed = new Set<string>();
  const tagEdges = new Set<string>();
  const notes = [...input.references.keys()].filter((note) => nodes.has(note)).sort(byCodeUnit);
  for (const note of notes) {
    const references = input.references.get(note)!;
    for (const reference of references.links) {
      const target = resolve(note, reference);
      if (target !== null && target !== note) directed.add(`${note}\n${target}`);
    }
    for (const tag of references.tags) {
      const id = `tag:${tag}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: "tag", label: `#${tag}`, path: null, degree: 0 });
      tagEdges.add(`${note}\n${id}`);
    }
  }

  const edges: GraphEdge[] = [];
  for (const pair of [...directed].sort(byCodeUnit)) {
    const [source, target] = pair.split("\n") as [string, string];
    const both = directed.has(`${target}\n${source}`);
    if (both && source > target) continue;
    edges.push({ source, target, both });
  }
  for (const pair of [...tagEdges].sort(byCodeUnit)) {
    const [source, target] = pair.split("\n") as [string, string];
    edges.push({ source, target, both: false });
  }
  edges.sort((a, b) => byCodeUnit(a.source, b.source) || byCodeUnit(a.target, b.target));

  for (const edge of edges) {
    nodes.get(edge.source)!.degree += 1;
    nodes.get(edge.target)!.degree += 1;
  }

  return { nodes: [...nodes.values()].sort((a, b) => byCodeUnit(a.id, b.id)), edges };
}

export function neighbourhood(graph: VaultGraph, centre: string, depth: number): VaultGraph {
  if (!graph.nodes.some((node) => node.id === centre)) return { nodes: [], edges: [] };
  const adjacent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  }
  const kept = new Set([centre]);
  let frontier = [centre];
  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adjacent.get(id) ?? []) {
        if (!kept.has(other)) {
          kept.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  };
}

export function applyIndexChange(input: VaultIndexInput, change: IndexChange): VaultIndexInput {
  if (change.kind === "written") {
    const files = input.files.includes(change.path) ? input.files : [...input.files, change.path];
    const references = new Map(input.references);
    if (change.references === null || !isNotePath(change.path)) references.delete(change.path);
    else references.set(change.path, change.references);
    return { files, references };
  }

  if (!input.files.includes(change.from)) return input;
  const files = input.files.map((file) => (file === change.from ? change.to : file));
  const references = new Map(input.references);
  const moved = references.get(change.from);
  references.delete(change.from);
  if (moved !== undefined && isNotePath(change.to)) references.set(change.to, moved);
  return { files, references };
}
```

Add to `packages/domain/src/index.ts`:

```ts
export { applyIndexChange, buildGraph, EMPTY_INDEX, isNotePath, neighbourhood } from "./vaultGraph";
export type { GraphEdge, GraphNode, GraphNodeKind, IndexChange, VaultGraph, VaultIndexInput } from "./vaultGraph";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --root packages/domain vaultGraph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/vaultGraph.ts packages/domain/src/vaultGraph.test.ts packages/domain/src/index.ts
git commit -m "Build the vault graph from an index of files and references"
```

---
### Task 4: Reserved graph tab path and Obsidian's new-note location

**Files:**
- Create: `packages/domain/src/graphPage.ts`, `packages/domain/src/obsidianAppConfig.ts`
- Test: `packages/domain/src/graphPage.test.ts`, `packages/domain/src/obsidianAppConfig.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `splitQualified`, `qualifyPath` from `./qualifiedPath`.
- Produces:
```ts
// graphPage.ts
export const GRAPH_PAGE_PREFIX = "trypthos:graph/";
export function graphPagePath(workspaceId: string): string;
export function graphPageWorkspaceId(path: string): string | null;
export function isGraphPagePath(path: string): boolean;
// obsidianAppConfig.ts
export type NewNoteLocation = { mode: "root" } | { mode: "folder"; folder: string } | { mode: "current" };
export const OBSIDIAN_APP_CONFIG = ".obsidian/app.json";
export function newNoteLocationFrom(raw: unknown): NewNoteLocation;
export function newNoteDirectory(location: NewNoteLocation, workspaceId: string, linkingNote: string | null): string;
```

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/graphPage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GRAPH_PAGE_PREFIX, graphPagePath, graphPageWorkspaceId, isGraphPagePath } from "./graphPage";
import { splitQualified } from "./qualifiedPath";

describe("the path a vault graph is a tab under", () => {
  it("is built from the workspace it belongs to", () => {
    expect(graphPagePath("Notes")).toBe(`${GRAPH_PAGE_PREFIX}Notes`);
    expect(graphPageWorkspaceId(graphPagePath("Notes"))).toBe("Notes");
    expect(isGraphPagePath(graphPagePath("Notes"))).toBe(true);
  });

  it("answers null for anything that is not one", () => {
    expect(graphPageWorkspaceId("Notes/graph.md")).toBe(null);
    expect(graphPageWorkspaceId("trypthos:repo/Notes")).toBe(null);
    expect(graphPageWorkspaceId(GRAPH_PAGE_PREFIX)).toBe(null);
  });

  it("can never be resolved against a provider", () => {
    expect(splitQualified(graphPagePath("Notes"))).toBe(null);
  });
});
```

`packages/domain/src/obsidianAppConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newNoteDirectory, newNoteLocationFrom } from "./obsidianAppConfig";

describe("where Obsidian puts a new note", () => {
  it("reads each of Obsidian's three settings", () => {
    expect(newNoteLocationFrom({ newFileLocation: "root" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "current" })).toEqual({ mode: "current" });
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "Inbox/New" })).toEqual({
      mode: "folder",
      folder: "Inbox/New",
    });
  });

  it("falls back to the vault root for anything missing, unknown or unsafe", () => {
    expect(newNoteLocationFrom(null)).toEqual({ mode: "root" });
    expect(newNoteLocationFrom("not an object")).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({})).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "elsewhere" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "folder" })).toEqual({ mode: "root" });
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "../outside" })).toEqual({ mode: "root" });
  });

  it("normalises a folder's slashes", () => {
    expect(newNoteLocationFrom({ newFileLocation: "folder", newFileFolderPath: "/Inbox//New/" })).toEqual({
      mode: "folder",
      folder: "Inbox/New",
    });
  });

  it("turns a location into the directory a new note is created in", () => {
    expect(newNoteDirectory({ mode: "root" }, "V", "V/a/From.md")).toBe("V");
    expect(newNoteDirectory({ mode: "folder", folder: "Inbox" }, "V", null)).toBe("V/Inbox");
    expect(newNoteDirectory({ mode: "current" }, "V", "V/a/b/From.md")).toBe("V/a/b");
    expect(newNoteDirectory({ mode: "current" }, "V", "V/From.md")).toBe("V");
    expect(newNoteDirectory({ mode: "current" }, "V", null)).toBe("V");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/domain graphPage obsidianAppConfig`
Expected: FAIL - both imports unresolved.

- [ ] **Step 3: Implement**

`packages/domain/src/graphPage.ts`:

```ts
/// The vault graph tab: a document identity like the repository page, never a file.
///
/// `splitQualified` refuses the whole `trypthos:` prefix, which is what keeps this path away from
/// every code path that would resolve it against a provider.

export const GRAPH_PAGE_PREFIX = "trypthos:graph/";

export function graphPagePath(workspaceId: string): string {
  return `${GRAPH_PAGE_PREFIX}${workspaceId}`;
}

export function graphPageWorkspaceId(path: string): string | null {
  if (!path.startsWith(GRAPH_PAGE_PREFIX)) return null;
  const id = path.slice(GRAPH_PAGE_PREFIX.length);
  return id === "" ? null : id;
}

export function isGraphPagePath(path: string): boolean {
  return graphPageWorkspaceId(path) !== null;
}
```

`packages/domain/src/obsidianAppConfig.ts`:

```ts
import { z } from "zod";
import { qualifyPath, splitQualified } from "./qualifiedPath";

/// Where Obsidian creates a new note, read from the vault's `.obsidian/app.json`.
///
/// The file is Obsidian's, not ours, so everything about it is untrusted: an unknown value, a
/// missing folder or a folder that climbs out of the vault all mean the vault root.

export type NewNoteLocation = { mode: "root" } | { mode: "folder"; folder: string } | { mode: "current" };

export const OBSIDIAN_APP_CONFIG = ".obsidian/app.json";

const AppConfig = z.object({
  newFileLocation: z.enum(["root", "current", "folder"]).optional(),
  newFileFolderPath: z.string().optional(),
});

export function newNoteLocationFrom(raw: unknown): NewNoteLocation {
  const parsed = AppConfig.safeParse(raw);
  if (!parsed.success) return { mode: "root" };
  const { newFileLocation, newFileFolderPath } = parsed.data;
  if (newFileLocation === "current") return { mode: "current" };
  if (newFileLocation !== "folder" || newFileFolderPath === undefined) return { mode: "root" };
  const segments = newFileFolderPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return { mode: "root" };
  return { mode: "folder", folder: segments.join("/") };
}

export function newNoteDirectory(location: NewNoteLocation, workspaceId: string, linkingNote: string | null): string {
  if (location.mode === "folder") return qualifyPath(workspaceId, location.folder);
  if (location.mode === "current" && linkingNote !== null) {
    const split = splitQualified(linkingNote);
    if (split !== null && split.workspaceId === workspaceId) {
      return qualifyPath(workspaceId, split.path.slice(0, Math.max(split.path.lastIndexOf("/"), 0)));
    }
  }
  return workspaceId;
}
```

Add to `packages/domain/src/index.ts`:

```ts
export { GRAPH_PAGE_PREFIX, graphPagePath, graphPageWorkspaceId, isGraphPagePath } from "./graphPage";
export { newNoteDirectory, newNoteLocationFrom, OBSIDIAN_APP_CONFIG } from "./obsidianAppConfig";
export type { NewNoteLocation } from "./obsidianAppConfig";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --root packages/domain graphPage obsidianAppConfig`
Expected: PASS. (`qualifyPath("V", "")` returns `"V"`, which the "current, root-level note" case relies on.)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/graphPage.ts packages/domain/src/graphPage.test.ts packages/domain/src/obsidianAppConfig.ts packages/domain/src/obsidianAppConfig.test.ts packages/domain/src/index.ts
git commit -m "Add the graph tab path and read where Obsidian creates new notes"
```

---

### Task 5: IPC schemas, channels and the `graph` settings block

**Files:**
- Modify: `packages/domain/src/ipc.ts`, `packages/domain/src/ipc.test.ts`, `packages/domain/src/settings.ts`, `packages/domain/src/settings.test.ts`, `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge` (Task 3), `NewNoteLocation` (Task 4).
- Produces (`ipc.ts`):
```ts
export const GraphRequest: z.ZodType<{ workspaceId: string }>;
export const GraphNodeSchema, GraphEdgeSchema, NewNoteLocationSchema, GraphSnapshotSchema, GraphProgressSchema, GraphStateSchema, GraphChangedSchema;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type GraphProgress = z.infer<typeof GraphProgressSchema>;
export type GraphState = z.infer<typeof GraphStateSchema>;
export const GRAPH_PROGRESS_CHANNEL = "graph:progress";
export const GRAPH_CHANGED_CHANNEL = "graph:changed";
// IPC_CHANNELS gains, at the end: "graph:snapshot", "graph:refresh"
```
- Produces (`settings.ts`): `Settings["graph"] = { notes: boolean; attachments: boolean; tags: boolean; unresolved: boolean; orphans: boolean; localDepth: number /*1-3*/; localCollapsed: boolean }`, `SETTINGS_VERSION = 21`, defaults `{ notes: true, attachments: false, tags: false, unresolved: true, orphans: true, localDepth: 1, localCollapsed: false }`.

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/ipc.test.ts`, append `"graph:snapshot", "graph:refresh"` to the end of the expected array in the `"is a closed list, so the preload bridge stays enumerable"` test (after `"obsidian:openVault"`), and add to the imports `GraphProgressSchema, GraphRequest, GraphSnapshotSchema, GraphStateSchema`, then add:

```ts
describe("the vault graph contract", () => {
  const snapshot = {
    workspaceId: "V",
    builtAt: "2026-09-17T10:00:00.000Z",
    unreadable: 0,
    newNotes: { mode: "folder", folder: "Inbox" },
    nodes: [{ id: "V/A.md", kind: "note", label: "A", path: "V/A.md", degree: 1 }],
    edges: [{ source: "V/A.md", target: "ghost:b", both: false }],
  };

  it("accepts a snapshot and a state carrying one", () => {
    expect(GraphSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      GraphStateSchema.safeParse({ snapshot, building: { workspaceId: "V", read: 1, total: 2, walking: false }, error: null })
        .success,
    ).toBe(true);
  });

  it("refuses stray fields, so the two sides cannot drift", () => {
    expect(GraphSnapshotSchema.safeParse({ ...snapshot, content: "secret" }).success).toBe(false);
    expect(GraphSnapshotSchema.safeParse({ ...snapshot, nodes: [{ ...snapshot.nodes[0], text: "x" }] }).success).toBe(false);
    expect(GraphRequest.safeParse({ workspaceId: "V", path: "/" }).success).toBe(false);
  });

  it("refuses a node kind it does not know and negative progress", () => {
    expect(GraphSnapshotSchema.safeParse({ ...snapshot, nodes: [{ ...snapshot.nodes[0], kind: "folder" }] }).success).toBe(false);
    expect(GraphProgressSchema.safeParse({ workspaceId: "V", read: -1, total: 0, walking: true }).success).toBe(false);
  });
});
```

In `packages/domain/src/settings.test.ts`, add:

```ts
/// The graph's filters and local pane, added at version 21.
///
/// Settings are strict, so a file from before the block existed has to be given it, with the
/// defaults the graph shipped with.
describe("the vault graph settings", () => {
  it("brings an older file forward with the graph defaults and nothing else changed", () => {
    const older: Record<string, unknown> = { ...DEFAULT_SETTINGS, schemaVersion: 20, panels: { ...DEFAULT_SETTINGS.panels, chatWidth: 420 } };
    delete older.graph;

    const loaded = loadSettings(older);
    expect(loaded.schemaVersion).toBe(SETTINGS_VERSION);
    expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(21);
    expect(loaded.graph).toEqual({
      notes: true,
      attachments: false,
      tags: false,
      unresolved: true,
      orphans: true,
      localDepth: 1,
      localCollapsed: false,
    });
    expect(loaded.panels.chatWidth).toBe(420);
  });

  it("remembers the filters and the local pane", () => {
    const chosen = { ...DEFAULT_SETTINGS, graph: { ...DEFAULT_SETTINGS.graph, tags: true, localDepth: 3, localCollapsed: true } };
    expect(loadSettings(chosen).graph).toEqual(chosen.graph);
  });

  it("refuses a local depth outside one to three", () => {
    const deep = { ...DEFAULT_SETTINGS, graph: { ...DEFAULT_SETTINGS.graph, localDepth: 4 } };
    expect(SettingsSchema.safeParse(deep).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root packages/domain ipc settings`
Expected: FAIL - missing exports `GraphSnapshotSchema` etc., the channel list mismatch, and `loaded.graph` undefined.

- [ ] **Step 3: Implement the IPC contract**

In `packages/domain/src/ipc.ts`:
1. Append `"graph:snapshot",` and `"graph:refresh",` to `IPC_CHANNELS` after `"obsidian:openVault",`.
2. Add after `RefreshWorkspaceRequest`:

```ts
/// The vault graph. Only a workspace id ever crosses - never a path or a root - and nothing in a
/// snapshot carries a note's contents: nodes are names and paths, edges are pairs of ids.
export const GraphRequest = z.object({ workspaceId: z.string().min(1) }).strict();

export const GraphNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["note", "attachment", "ghost", "tag"]),
    label: z.string(),
    path: z.string().nullable(),
    degree: z.number().int().min(0),
  })
  .strict();

export const GraphEdgeSchema = z
  .object({ source: z.string().min(1), target: z.string().min(1), both: z.boolean() })
  .strict();

export const NewNoteLocationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("root") }).strict(),
  z.object({ mode: z.literal("folder"), folder: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("current") }).strict(),
]);

export const GraphSnapshotSchema = z
  .object({
    workspaceId: z.string().min(1),
    builtAt: z.string().min(1),
    unreadable: z.number().int().min(0),
    newNotes: NewNoteLocationSchema,
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
  })
  .strict();

export const GraphProgressSchema = z
  .object({
    workspaceId: z.string().min(1),
    read: z.number().int().min(0),
    total: z.number().int().min(0),
    walking: z.boolean(),
  })
  .strict();

export const GraphStateSchema = z
  .object({ snapshot: GraphSnapshotSchema.nullable(), building: GraphProgressSchema.nullable(), error: z.string().nullable() })
  .strict();

export const GraphChangedSchema = z.object({ workspaceId: z.string().min(1) }).strict();

export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type GraphProgress = z.infer<typeof GraphProgressSchema>;
export type GraphState = z.infer<typeof GraphStateSchema>;

/// Pushed from main while a vault is indexed, and when its graph is rebuilt or updated.
export const GRAPH_PROGRESS_CHANNEL = "graph:progress";
export const GRAPH_CHANGED_CHANNEL = "graph:changed";
```

Export them from `packages/domain/src/index.ts` next to the other `ipc` exports:

```ts
export {
  GRAPH_CHANGED_CHANNEL,
  GRAPH_PROGRESS_CHANNEL,
  GraphChangedSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  GraphProgressSchema,
  GraphRequest,
  GraphSnapshotSchema,
  GraphStateSchema,
  NewNoteLocationSchema,
} from "./ipc";
export type { GraphProgress, GraphSnapshot, GraphState } from "./ipc";
```

- [ ] **Step 4: Implement the settings block**

In `packages/domain/src/settings.ts`:
1. `export const SETTINGS_VERSION = 21;`
2. Add to `SettingsSchema`, after `editor`:

```ts
    /// The vault graph's filter chips and the local graph pane, added at version 21. Global rather
    /// than per vault: they describe how somebody likes to look at a graph, not a fact about one.
    graph: z
      .object({
        notes: z.boolean(),
        attachments: z.boolean(),
        tags: z.boolean(),
        unresolved: z.boolean(),
        orphans: z.boolean(),
        localDepth: z.number().int().min(1).max(3),
        localCollapsed: z.boolean(),
      })
      .strict(),
```

3. Add to `DEFAULT_SETTINGS`: `graph: { notes: true, attachments: false, tags: false, unresolved: true, orphans: true, localDepth: 1, localCollapsed: false },`
4. Add at the TOP of `SETTINGS_MIGRATIONS`:

```ts
  {
    to: 21,
    // Version 21 adds the vault graph's filters and local pane. Written out rather than read from
    // the defaults, because a migration is a record of what a version did.
    migrate: (input) => ({
      ...input,
      graph: { notes: true, attachments: false, tags: false, unresolved: true, orphans: true, localDepth: 1, localCollapsed: false },
    }),
  },
```

- [ ] **Step 5: Run the domain suite to see it pass**

Run: `npm test --workspace @trypthos/domain`
Expected: PASS, whole suite. Then `npm run typecheck` - expected clean. If a renderer test constructs a full `Settings` literal and now fails typecheck, add `graph: DEFAULT_SETTINGS.graph` to that literal.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/ipc.ts packages/domain/src/ipc.test.ts packages/domain/src/settings.ts packages/domain/src/settings.test.ts packages/domain/src/index.ts
git commit -m "Add the vault graph IPC contract and settings block"
```

---
### Task 6: The main-process vault index (`vaultIndex.js`)

**Files:**
- Create: `apps/desktop/src/vaultIndex.js`
- Test: `apps/desktop/test/vaultIndex.test.js`

**Interfaces:**
- Consumes (from `@trypthos/domain`, built): `EMPTY_INDEX`, `GRAPH_CHANGED_CHANNEL`, `GRAPH_PROGRESS_CHANNEL`, `OBSIDIAN_APP_CONFIG`, `applyIndexChange`, `buildGraph`, `extractReferences`, `isHidden`, `isNotePath`, `newNoteLocationFrom`, `qualifyPath`, `sortNodes`. The workspace record from `providers.js`/`ipcHandlers.js`: `{ id, ref: { kind }, root, provider: { list(path), read(path) }, vault }`. `provider.list(dir)` -> `{ ok: true, nodes: { name, kind: "file"|"directory", id }[] } | { ok: false, reason }`; `provider.read(path)` -> `{ ok: true, content } | { ok: false, reason }` and may THROW for an unmapped errno.
- Produces:
```js
createVaultIndexes({ emit, now = () => new Date(), batchSize = 32 }) => {
  isIndexable(workspace): boolean,           // local vault with a root
  start(workspace): void,                    // no-op if not indexable or already indexed
  refresh(workspace): { ok: true } | { ok: false, reason: "unsupported" | "building" },
  close(workspaceId): void,                  // cancels a build, drops the index
  state(workspaceId): GraphState | null,     // { snapshot, building, error }
  written(workspace, relativePath, content): void,
  renamed(workspace, fromRelative, toRelative): void,
  idle(workspaceId): Promise<void>,          // resolves when no build is running (tests)
}
```
`emit(channel, payload)` is called with `GRAPH_PROGRESS_CHANNEL` + `GraphProgress`, and `GRAPH_CHANGED_CHANNEL` + `{ workspaceId }`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/vaultIndex.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GRAPH_CHANGED_CHANNEL, GRAPH_PROGRESS_CHANNEL } = require("@trypthos/domain");
const { createVaultIndexes } = require("../src/vaultIndex");
const { openWorkspaceFor } = require("../src/providers");

/// A provider over an in-memory tree of `path -> content`, with switches for the failures a disk
/// produces. `hold()` stops every read until the returned release is called, which is how the tests
/// get a build to sit still while something else happens.
function fakeProvider(files, options = {}) {
  const failList = options.failList ?? new Set();
  const failRead = options.failRead ?? new Set();
  const throwRead = options.throwRead ?? new Set();
  let gate = Promise.resolve();
  const reads = [];
  return {
    reads,
    hold() {
      let release;
      gate = new Promise((resolve) => (release = resolve));
      return () => release();
    },
    async list(directory) {
      if (failList.has(directory)) return { ok: false, reason: "not-found" };
      const prefix = directory === "" ? "" : `${directory}/`;
      const children = new Map();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...rest] = file.slice(prefix.length).split("/");
        children.set(name, rest.length > 0 ? "directory" : "file");
      }
      return { ok: true, nodes: [...children].map(([name, kind]) => ({ name, kind, id: `${prefix}${name}` })) };
    },
    async read(file) {
      await gate;
      reads.push(file);
      if (throwRead.has(file)) throw Object.assign(new Error("odd"), { code: "EIO" });
      if (failRead.has(file) || !(file in files)) return { ok: false, reason: "not-found" };
      return { ok: true, content: files[file] };
    },
  };
}

function vault(provider, id = "V") {
  return { id, ref: { kind: "local", root: "/v" }, root: "/v", provider, vault: true };
}

function recorder() {
  const events = [];
  return { events, emit: (channel, payload) => events.push({ channel, payload }) };
}

const NOW = () => new Date("2026-09-17T10:00:00.000Z");

test("builds a snapshot of a vault's notes, links, tags and attachments", async () => {
  const provider = fakeProvider({
    "Home.md": "[[Plan]] #inbox ![[img/diagram.png]] [[Missing]]",
    "Projects/Plan.md": "back to [[Home]]",
    "img/diagram.png": "",
    ".obsidian/app.json": JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "Inbox" }),
    ".trash/Old.md": "[[Home]]",
  });
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });

  indexes.start(vault(provider));
  await indexes.idle("V");

  const { snapshot, building, error } = indexes.state("V");
  assert.equal(building, null);
  assert.equal(error, null);
  assert.equal(snapshot.builtAt, "2026-09-17T10:00:00.000Z");
  assert.deepEqual(snapshot.newNotes, { mode: "folder", folder: "Inbox" });
  const kinds = Object.fromEntries(snapshot.nodes.map((node) => [node.id, node.kind]));
  assert.deepEqual(kinds, {
    "V/Home.md": "note",
    "V/Projects/Plan.md": "note",
    "V/img/diagram.png": "attachment",
    "ghost:missing": "ghost",
    "tag:inbox": "tag",
  });
  assert.ok(snapshot.edges.some((edge) => edge.source === "V/Home.md" && edge.target === "V/Projects/Plan.md" && edge.both));
  assert.ok(!provider.reads.some((file) => file.startsWith(".trash")));
  assert.equal(events.at(-1).channel, GRAPH_CHANGED_CHANNEL);
  assert.deepEqual(events.at(-1).payload, { workspaceId: "V" });
});

test("reports progress in batches, walking first and then reading", async () => {
  const files = Object.fromEntries(["a", "b", "c", "d", "e"].map((name) => [`${name}.md`, ""]));
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW, batchSize: 2 });

  indexes.start(vault(fakeProvider(files)));
  await indexes.idle("V");

  const progress = events.filter((event) => event.channel === GRAPH_PROGRESS_CHANNEL).map((event) => event.payload);
  assert.equal(progress[0].walking, true);
  assert.deepEqual(
    progress.filter((p) => !p.walking).map((p) => p.read),
    [0, 2, 4, 5],
  );
  assert.ok(progress.every((p) => p.workspaceId === "V" && p.read <= p.total));
});

test("skips and counts files it cannot read, including ones whose read throws", async () => {
  const provider = fakeProvider(
    { "A.md": "[[B]]", "B.md": "", "C.md": "" },
    { failRead: new Set(["B.md"]), throwRead: new Set(["C.md"]) },
  );
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });

  indexes.start(vault(provider));
  await indexes.idle("V");

  const { snapshot } = indexes.state("V");
  assert.equal(snapshot.unreadable, 2);
  assert.ok(snapshot.nodes.some((node) => node.id === "V/B.md"));
});

test("says why when the vault root cannot be listed, and keeps the last good graph on a refresh", async () => {
  const failList = new Set();
  const provider = fakeProvider({ "A.md": "" }, { failList });
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  await indexes.idle("V");
  const good = indexes.state("V").snapshot;

  failList.add("");
  assert.deepEqual(indexes.refresh(workspace), { ok: true });
  await indexes.idle("V");

  assert.equal(indexes.state("V").error, "not-found");
  assert.equal(indexes.state("V").snapshot, good);
});

test("refuses a refresh while a build is running", async () => {
  const provider = fakeProvider({ "A.md": "" });
  const release = provider.hold();
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  assert.deepEqual(indexes.refresh(workspace), { ok: false, reason: "building" });
  release();
  await indexes.idle("V");
});

test("stops a build and forgets the vault when it is closed", async () => {
  const provider = fakeProvider({ "A.md": "" });
  const release = provider.hold();
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });

  indexes.start(vault(provider));
  indexes.close("V");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(indexes.state("V"), null);
  assert.ok(!events.some((event) => event.channel === GRAPH_CHANGED_CHANNEL));
});

test("applies a write made during a build once the build finishes", async () => {
  const provider = fakeProvider({ "A.md": "[[Risks]]" });
  const release = provider.hold();
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  indexes.written(workspace, "Risks.md", "");
  release();
  await indexes.idle("V");

  const { snapshot } = indexes.state("V");
  assert.ok(snapshot.nodes.some((node) => node.id === "V/Risks.md"));
  assert.ok(!snapshot.nodes.some((node) => node.id === "ghost:risks"));
});

test("updates the graph and says so when a note is written after the build", async () => {
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });
  const workspace = vault(fakeProvider({ "A.md": "" }));
  indexes.start(workspace);
  await indexes.idle("V");
  events.length = 0;

  indexes.written(workspace, "A.md", "[[B]] #new");

  const { snapshot } = indexes.state("V");
  assert.ok(snapshot.nodes.some((node) => node.id === "ghost:b"));
  assert.ok(snapshot.nodes.some((node) => node.id === "tag:new"));
  assert.deepEqual(events, [{ channel: GRAPH_CHANGED_CHANNEL, payload: { workspaceId: "V" } }]);
});

test("follows a renamed file, and rebuilds for a renamed folder", async () => {
  const files = { "A.md": "[[B]]", "B.md": "", "f/C.md": "" };
  const provider = fakeProvider(files);
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);
  indexes.start(workspace);
  await indexes.idle("V");

  indexes.renamed(workspace, "B.md", "D.md");
  assert.ok(indexes.state("V").snapshot.nodes.some((node) => node.id === "ghost:b"));

  delete files["f/C.md"];
  files["g/C.md"] = "";
  indexes.renamed(workspace, "f", "g");
  await indexes.idle("V");
  assert.ok(indexes.state("V").snapshot.nodes.some((node) => node.id === "V/g/C.md"));
});

test("does not index a folder that is not a vault, or a repository", async () => {
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const plain = { ...vault(fakeProvider({ "A.md": "" })), vault: false };
  const repo = { ...vault(fakeProvider({ "A.md": "" }), "R"), ref: { kind: "github" }, root: null };

  indexes.start(plain);
  indexes.start(repo);

  assert.equal(indexes.state("V"), null);
  assert.equal(indexes.state("R"), null);
  assert.deepEqual(indexes.refresh(repo), { ok: false, reason: "unsupported" });
});

test("never puts a note's contents into a snapshot", async () => {
  const marker = "MARKER-7f3a-never-leaves-main";
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  indexes.start(vault(fakeProvider({ "A.md": `${marker} [[B]] #tag` })));
  await indexes.idle("V");

  assert.ok(!JSON.stringify(indexes.state("V")).includes(marker));
});

test("does not follow a junction out of a real vault", async (t) => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graph-")));
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-outside-")));
  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(base, ".obsidian"));
  await fs.writeFile(path.join(base, "Home.md"), "[[Secret]]");
  await fs.writeFile(path.join(outside, "Secret.md"), "outside");
  try {
    await fs.symlink(outside, path.join(base, "escape"), "junction");
  } catch {
    t.skip("this machine cannot create a junction or symlink");
    return;
  }

  const opened = await openWorkspaceFor({ kind: "local", root: base });
  assert.equal(opened.ok, true);
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  indexes.start({ ...opened.workspace, id: "V" });
  await indexes.idle("V");

  const ids = indexes.state("V").snapshot.nodes.map((node) => node.id);
  assert.ok(ids.includes("ghost:secret"));
  assert.ok(!ids.some((id) => id.includes("escape")));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/vaultIndex.test.js`
Expected: FAIL - `Cannot find module '../src/vaultIndex'`.

- [ ] **Step 3: Implement**

`apps/desktop/src/vaultIndex.js`:

```js
"use strict";

const {
  EMPTY_INDEX,
  GRAPH_CHANGED_CHANNEL,
  GRAPH_PROGRESS_CHANNEL,
  OBSIDIAN_APP_CONFIG,
  applyIndexChange,
  buildGraph,
  extractReferences,
  isHidden,
  isNotePath,
  newNoteLocationFrom,
  qualifyPath,
  sortNodes,
} = require("@trypthos/domain");

/// The vault graph's index: one per open local vault, held here in the main process.
///
/// **Every read goes through the workspace's provider**, so the boundary guard - including its
/// realpath check - applies to the index exactly as it does to the tree. Nothing here touches `fs`.
///
/// **Note contents never leave this module.** A note is read, its references extracted, and the text
/// dropped; a snapshot is names, paths and pairs of ids.
///
/// **Batched, and yielding between batches.** The main process also runs every window's events, so a
/// vault of thousands of notes is read 32 at a time with a turn of the event loop between batches.

const READ_BATCH = 32;
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function settled(call) {
  try {
    return await call();
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function parsedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createVaultIndexes({ emit, now = () => new Date(), batchSize = READ_BATCH }) {
  const entries = new Map();

  const isIndexable = (workspace) =>
    workspace.vault === true && workspace.ref?.kind === "local" && typeof workspace.root === "string";

  function publish(entry) {
    entry.snapshot = {
      workspaceId: entry.workspace.id,
      builtAt: now().toISOString(),
      unreadable: entry.unreadable,
      newNotes: entry.newNotes,
      ...buildGraph(entry.input),
    };
  }

  const changed = (entry) => emit(GRAPH_CHANGED_CHANNEL, { workspaceId: entry.workspace.id });
  const progress = (entry, building) => {
    entry.building = building;
    emit(GRAPH_PROGRESS_CHANNEL, building);
  };

  async function build(entry) {
    const token = Symbol("build");
    entry.token = token;
    const id = entry.workspace.id;
    const { provider } = entry.workspace;
    const alive = () => entry.token === token && entries.get(id) === entry;

    entry.error = null;
    progress(entry, { workspaceId: id, read: 0, total: 0, walking: true });

    const files = [];
    let unreadable = 0;
    let queue = [""];
    while (queue.length > 0) {
      const next = [];
      for (const directory of queue) {
        const listed = await settled(() => provider.list(directory));
        if (!alive()) return;
        if (!listed.ok) {
          if (directory === "") {
            entry.building = null;
            entry.error = listed.reason ?? "not-found";
            changed(entry);
            return;
          }
          unreadable += 1;
          continue;
        }
        for (const node of sortNodes(listed.nodes)) {
          if (isHidden(node.name)) continue;
          if (node.kind === "directory") next.push(node.id);
          else files.push(node.id);
        }
      }
      queue = next;
      progress(entry, { workspaceId: id, read: 0, total: files.filter(isNotePath).length, walking: queue.length > 0 });
      await nextTurn();
      if (!alive()) return;
    }

    const notes = files.filter(isNotePath);
    const references = new Map();
    for (let start = 0; start < notes.length; start += batchSize) {
      const batch = notes.slice(start, start + batchSize);
      const results = await Promise.all(batch.map((file) => settled(() => provider.read(file))));
      if (!alive()) return;
      results.forEach((result, index) => {
        if (result.ok) references.set(qualifyPath(id, batch[index]), extractReferences(result.content));
        else unreadable += 1;
      });
      progress(entry, { workspaceId: id, read: start + batch.length, total: notes.length, walking: false });
      await nextTurn();
      if (!alive()) return;
    }

    const config = await settled(() => provider.read(OBSIDIAN_APP_CONFIG));
    if (!alive()) return;
    entry.newNotes = newNoteLocationFrom(config.ok ? parsedJson(config.content) : null);

    let input = { files: files.map((file) => qualifyPath(id, file)), references };
    let rebuild = false;
    for (const change of entry.pending.splice(0)) {
      if (change === "rebuild") rebuild = true;
      else input = applyIndexChange(input, change);
    }
    entry.input = input;
    entry.unreadable = unreadable;
    entry.building = null;
    publish(entry);
    changed(entry);
    if (rebuild) run(entry);
  }

  function run(entry) {
    entry.running = build(entry);
  }

  function apply(workspace, change) {
    const entry = entries.get(workspace.id);
    if (entry === undefined) return;
    if (entry.building !== null) {
      entry.pending.push(change);
      return;
    }
    if (entry.snapshot === null) return;
    entry.input = applyIndexChange(entry.input, change);
    publish(entry);
    changed(entry);
  }

  return {
    isIndexable,

    start(workspace) {
      if (!isIndexable(workspace) || entries.has(workspace.id)) return;
      const entry = {
        workspace,
        input: EMPTY_INDEX,
        snapshot: null,
        building: null,
        error: null,
        pending: [],
        token: null,
        running: Promise.resolve(),
        newNotes: { mode: "root" },
        unreadable: 0,
      };
      entries.set(workspace.id, entry);
      run(entry);
    },

    refresh(workspace) {
      if (!isIndexable(workspace)) return { ok: false, reason: "unsupported" };
      const entry = entries.get(workspace.id);
      if (entry === undefined) {
        this.start(workspace);
        return { ok: true };
      }
      if (entry.building !== null) return { ok: false, reason: "building" };
      run(entry);
      return { ok: true };
    },

    close(workspaceId) {
      entries.delete(workspaceId);
    },

    state(workspaceId) {
      const entry = entries.get(workspaceId);
      if (entry === undefined) return null;
      return { snapshot: entry.snapshot, building: entry.building, error: entry.error };
    },

    written(workspace, relativePath, content) {
      const file = qualifyPath(workspace.id, relativePath);
      apply(workspace, {
        kind: "written",
        path: file,
        references: isNotePath(file) ? extractReferences(content) : null,
      });
    },

    renamed(workspace, fromRelative, toRelative) {
      const entry = entries.get(workspace.id);
      if (entry === undefined) return;
      if (entry.building !== null) {
        entry.pending.push("rebuild");
        return;
      }
      const from = qualifyPath(workspace.id, fromRelative);
      if (entry.input.files.includes(from)) {
        apply(workspace, { kind: "renamed", from, to: qualifyPath(workspace.id, toRelative) });
      } else if (entry.input.files.some((file) => file.startsWith(`${from}/`))) {
        run(entry);
      }
    },

    async idle(workspaceId) {
      for (;;) {
        const entry = entries.get(workspaceId);
        if (entry === undefined || entry.building === null) return;
        await entry.running;
      }
    },
  };
}

module.exports = { createVaultIndexes, READ_BATCH };
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test apps/desktop/test/vaultIndex.test.js`
Expected: PASS (the junction test may report `skipped` on a machine that cannot create one).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/vaultIndex.js apps/desktop/test/vaultIndex.test.js
git commit -m "Index local vaults in the main process with batched reads and progress"
```

---
### Task 7: Wire the index into IPC, the preload bridge and every window

Task 5 added `graph:snapshot` and `graph:refresh` to `IPC_CHANNELS`, so `secretsIpc.test.js` (registered handlers must equal the channel list; every channel must appear in preload) is red until this task lands. That is the failing test this task starts from, plus the new ones below.

**Files:**
- Modify: `apps/desktop/src/ipcHandlers.js`, `apps/desktop/src/preload.js`, `apps/desktop/src/main.js`
- Test: create `apps/desktop/test/graphIpc.test.js`; modify `apps/desktop/test/preloadBridge.test.js`

**Interfaces:**
- Consumes: `createVaultIndexes` (Task 6); `GraphRequest` (Task 5); existing `guarded`, `locateById`, `open`, `openWorkspaceRef`.
- Produces:
  - `registerIpcHandlers({ ..., broadcast = () => {} })` - `broadcast(channel, payload)` sends to every window.
  - `graph:snapshot` `{ workspaceId }` -> `{ ok: true, state: GraphState }`; for an open workspace that is not indexable, `state = { snapshot: null, building: null, error: "unsupported" }`; for an unknown id `{ ok: false, reason: "no-workspace" }`.
  - `graph:refresh` `{ workspaceId }` -> `{ ok: true } | { ok: false, reason: "unsupported" | "building" | "no-workspace" | "bad-request" }`.
  - Preload: `graphState(workspaceId)`, `refreshGraph(workspaceId)`, `onGraphProgress(listener)`, `onGraphChanged(listener)` (each `on*` returns an unsubscribe function).

- [ ] **Step 1: Confirm the existing red**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL in `secretsIpc.test.js` - handler list and preload channel checks name `graph:snapshot` / `graph:refresh`.

- [ ] **Step 2: Write the failing tests**

`apps/desktop/test/graphIpc.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GRAPH_CHANGED_CHANNEL } = require("@trypthos/domain");
const { registerIpcHandlers } = require("../src/ipcHandlers");

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

async function folder(files, { vault }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graphipc-")));
  if (vault) await fs.mkdir(path.join(root, ".obsidian"));
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

async function withShell(root, body) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graphipc-data-"));
  const broadcasts = [];
  const ipcMain = fakeIpcMain();
  registerIpcHandlers({
    ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    getWindow: () => null,
    userDataDir: userData,
    secrets: { endpointsWithKeys: async () => [], setKey: async () => {}, deleteKey: async () => {}, retainOnly: async () => {} },
    explorerIntegration: { supported: () => false, isRegistered: async () => false, register: async () => ({ ok: true }), unregister: async () => ({ ok: true }) },
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  });
  try {
    const opened = await ipcMain.invoke("workspace:open");
    assert.equal(opened.ok, true);
    await body({ ipcMain, id: opened.workspace.id, broadcasts });
    await ipcMain.invoke("workspace:close", { workspaceId: opened.workspace.id });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
}

async function builtState(ipcMain, id) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await ipcMain.invoke("graph:snapshot", { workspaceId: id });
    if (answer.ok && answer.state.snapshot !== null && answer.state.building === null) return answer.state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the graph never finished building");
}

test("opening a vault indexes it and tells every window when the graph is ready", async () => {
  const root = await folder({ "Home.md": "[[Plan]]", "Plan.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id, broadcasts }) => {
    const state = await builtState(ipcMain, id);
    assert.ok(state.snapshot.edges.some((edge) => edge.source === `${id}/Home.md` && edge.target === `${id}/Plan.md`));
    assert.ok(broadcasts.some((event) => event.channel === GRAPH_CHANGED_CHANNEL && event.payload.workspaceId === id));
  });
});

test("a successful write updates the graph", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    await builtState(ipcMain, id);
    const written = await ipcMain.invoke("file:write", { path: `${id}/Home.md`, content: "[[Later]]", expectedRevision: null });
    assert.equal(written.ok, true);
    const { snapshot } = (await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state;
    assert.ok(snapshot.nodes.some((node) => node.id === "ghost:later"));
  });
});

test("a failed write leaves the graph alone", async () => {
  const root = await folder({ "Home.md": "" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    const before = (await builtState(ipcMain, id)).snapshot;
    const refused = await ipcMain.invoke("file:write", {
      path: `${id}/Home.md`,
      content: "[[Later]]",
      expectedRevision: { id: "not-the-current-revision" },
    });
    assert.equal(refused.ok, false);
    assert.deepEqual((await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state.snapshot, before);
  });
});

test("a renamed note moves in the graph", async () => {
  const root = await folder({ "Home.md": "", "Plan.md": "[[Home]]" }, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    await builtState(ipcMain, id);
    const renamed = await ipcMain.invoke("workspace:rename", { path: `${id}/Home.md`, name: "Start.md" });
    assert.equal(renamed.ok, true);
    const { snapshot } = (await ipcMain.invoke("graph:snapshot", { workspaceId: id })).state;
    assert.ok(snapshot.nodes.some((node) => node.id === `${id}/Start.md`));
    assert.ok(snapshot.nodes.some((node) => node.id === "ghost:home"));
  });
});

test("a folder that is not a vault has no graph to build", async () => {
  const root = await folder({ "Home.md": "" }, { vault: false });
  await withShell(root, async ({ ipcMain, id }) => {
    assert.deepEqual(await ipcMain.invoke("graph:snapshot", { workspaceId: id }), {
      ok: true,
      state: { snapshot: null, building: null, error: "unsupported" },
    });
    assert.deepEqual(await ipcMain.invoke("graph:refresh", { workspaceId: id }), { ok: false, reason: "unsupported" });
  });
});

test("the graph channels take a workspace id and nothing else", async () => {
  const root = await folder({}, { vault: true });
  await withShell(root, async ({ ipcMain, id }) => {
    for (const channel of ["graph:snapshot", "graph:refresh"]) {
      assert.deepEqual(await ipcMain.invoke(channel, { workspaceId: id, path: "/" }), { ok: false, reason: "bad-request" });
      assert.deepEqual(await ipcMain.invoke(channel, undefined), { ok: false, reason: "bad-request" });
      assert.deepEqual(await ipcMain.invoke(channel, { workspaceId: "Nobody" }), { ok: false, reason: "no-workspace" });
    }
  });
});
```

Check `WriteRequest` in `packages/domain/src/ipc.ts` before running: if it requires `message`, add `message: null` to both `file:write` payloads above.

In `apps/desktop/test/preloadBridge.test.js`, add a test modelled on "the vault calls reach their handlers with what the renderer passed":

```js
test("the graph calls reach their handlers by workspace id", async () => {
  const { bridge, handlers } = loadPreload();
  const calls = [];
  handlers.set("graph:snapshot", (_event, payload) => calls.push(["graph:snapshot", payload]));
  handlers.set("graph:refresh", (_event, payload) => calls.push(["graph:refresh", payload]));

  await bridge.graphState("Notes");
  await bridge.refreshGraph("Notes");

  assert.deepEqual(calls, [
    ["graph:snapshot", { workspaceId: "Notes" }],
    ["graph:refresh", { workspaceId: "Notes" }],
  ]);
  assert.equal(typeof bridge.onGraphProgress(() => {}), "function");
  assert.equal(typeof bridge.onGraphChanged(() => {}), "function");
});
```

Use the file's existing loader helper and handler map - rename `loadPreload`/`handlers` to whatever that file already calls them.

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/graphIpc.test.js apps/desktop/test/preloadBridge.test.js`
Expected: FAIL - `graph:snapshot` handler undefined (`handlers.get(...) is not a function`), `bridge.graphState is not a function`.

- [ ] **Step 4: Implement the handlers**

In `apps/desktop/src/ipcHandlers.js`:

1. Add `GraphRequest` to the existing `require("@trypthos/domain")` destructure (the same statement - `domainExports.test.js` reads only the first one), and add `const { createVaultIndexes } = require("./vaultIndex");` beside the other local requires.
2. Add `broadcast = () => {},` to the `registerIpcHandlers({ ... })` parameter list, after `obsidianConfigPath = null,`, with the comment `/// Sends to every window. The graph index is shared by all of them, and \`getWindow\` reaches only the main one.`
3. At the top of the function body:

```js
  /// The vault graph's indexes. One per open local vault, started when a vault opens and dropped when
  /// it closes - see `vaultIndex.js`.
  const indexes = createVaultIndexes({ emit: broadcast });

  /// Starts indexing whatever an open just produced, when it is a local vault. Returns the result
  /// untouched, so each open handler stays one expression.
  function indexing(result) {
    if (result?.ok) {
      const workspace = open.get(result.workspace.id);
      if (workspace !== undefined) indexes.start(workspace);
    }
    return result;
  }
```

4. In `workspace:open`, `obsidian:openVault` and `workspace:openRef`, change each `return await openWorkspaceRef(...);` to `return indexing(await openWorkspaceRef(...));`.
5. In `workspace:close`, before `open.delete(parsed.data.workspaceId);` add `indexes.close(parsed.data.workspaceId);`.
6. `file:write` becomes:

```js
    guarded(locateQualified, WriteRequest, async (request, workspace) => {
      const written = await workspace.provider.write(request.path, request.content, request.expectedRevision, {
        message: request.message ?? undefined,
      });
      // Only a write that landed changes the graph. A conflict wrote nothing.
      if (written.ok) indexes.written(workspace, request.path, request.content);
      return written;
    }),
```

7. In `file:saveAs`, immediately before `return written.ok ? ...`, add `if (written.ok) indexes.written(workspace, relative, request.content);`.
8. In `workspace:rename`, after `const result = await workspace.provider.rename(request.path, request.name);` add `if (result.ok) indexes.renamed(workspace, request.path, result.path);`.
9. After the `workspace:refresh` handler, register:

```js
  /// The graph of one open vault: the last finished snapshot, the build in progress, and why the
  /// last build failed. By id only - the renderer never names a path or a root here.
  ipcMain.handle(
    "graph:snapshot",
    guarded(locateById, GraphRequest, (request, workspace) => ({
      ok: true,
      state: indexes.state(workspace.id) ?? {
        snapshot: null,
        building: null,
        error: indexes.isIndexable(workspace) ? null : "unsupported",
      },
    })),
  );

  /// Rebuilds one vault's graph. Refused while a build is running, which the renderer also shows by
  /// disabling the button - this is the check that holds.
  ipcMain.handle(
    "graph:refresh",
    guarded(locateById, GraphRequest, (_request, workspace) => indexes.refresh(workspace)),
  );
```

In `apps/desktop/src/main.js`, add to the `registerIpcHandlers({ ... })` call (after `obsidianConfigPath`):

```js
      broadcast: (channel, payload) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload);
        }
      },
```

In `apps/desktop/src/preload.js`, after `openObsidianVault`:

```js
  /// The vault graph, by workspace id. The snapshot is names, paths and links - never a note's text.
  graphState: (workspaceId) => ipcRenderer.invoke("graph:snapshot", { workspaceId }),
  refreshGraph: (workspaceId) => ipcRenderer.invoke("graph:refresh", { workspaceId }),
  /// Indexing progress and "the graph changed", pushed to every window. Wrapped like `onChatEvent`,
  /// so the renderer never receives the IpcRendererEvent.
  onGraphProgress: (listener) => {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("graph:progress", wrapped);
    return () => ipcRenderer.removeListener("graph:progress", wrapped);
  },
  onGraphChanged: (listener) => {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("graph:changed", wrapped);
    return () => ipcRenderer.removeListener("graph:changed", wrapped);
  },
```

- [ ] **Step 5: Run the shell suite to see it pass**

Run: `npm test --workspace trypthos-desktop`
Expected: PASS, whole suite, including `secretsIpc.test.js` (the leak guard calls the graph handlers with junk payloads; they answer `bad-request`/`no-workspace`) and `domainExports.test.js`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/src/main.js apps/desktop/test/graphIpc.test.js apps/desktop/test/preloadBridge.test.js
git commit -m "Serve vault graph snapshots over IPC and keep them current on writes"
```

---

### Task 8: Renderer bridge and `useVaultGraph`

**Files:**
- Modify: `apps/app/src/lib/workspaceClient.ts`
- Create: `apps/app/src/hooks/useVaultGraph.ts`
- Test: `apps/app/src/hooks/useVaultGraph.test.ts`

**Interfaces:**
- Consumes: `GraphStateSchema`, `GraphProgressSchema`, `GraphChangedSchema`, `GraphSnapshot`, `GraphProgress`, `GraphState` from `@trypthos/domain`.
- Produces:
```ts
// workspaceClient.ts, inside interface WorkspaceClient (two-space indented method signatures, so bridgeSurface.test.ts finds them)
  graphState(workspaceId: string): Promise<GraphStateResult>;
  refreshGraph(workspaceId: string): Promise<RefreshGraphResult>;
  onGraphProgress(listener: (message: unknown) => void): () => void;
  onGraphChanged(listener: (message: unknown) => void): () => void;
export type GraphStateResult = { ok: true; state: GraphState } | Failure;
export type RefreshGraphResult = { ok: true } | Failure;
export type GraphClient = Pick<WorkspaceClient, "graphState" | "refreshGraph" | "onGraphProgress" | "onGraphChanged">;
// useVaultGraph.ts
export const PROGRESS_DELAY_MS = 300;
export interface VaultGraphView {
  snapshot: GraphSnapshot | null;
  building: GraphProgress | null;   // the raw build state, immediately
  progress: GraphProgress | null;   // the build, only once it has run PROGRESS_DELAY_MS
  error: string | null;
  refresh(): void;
}
export function useVaultGraph(client: GraphClient, workspaceId: string | null): VaultGraphView;
```

- [ ] **Step 1: Write the failing tests**

`apps/app/src/hooks/useVaultGraph.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphState } from "@trypthos/domain";
import type { GraphClient } from "../lib/workspaceClient";
import { PROGRESS_DELAY_MS, useVaultGraph } from "./useVaultGraph";

const snapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "root" as const },
  nodes: [{ id: "V/A.md", kind: "note" as const, label: "A", path: "V/A.md", degree: 0 }],
  edges: [],
};

/// A hand-written bridge: answers what `state` holds, and lets a test push events.
function fakeClient(initial: GraphState) {
  let state = initial;
  const progress = new Set<(message: unknown) => void>();
  const changed = new Set<(message: unknown) => void>();
  const client: GraphClient & { refreshed: string[] } = {
    refreshed: [],
    graphState: vi.fn(async () => ({ ok: true as const, state })),
    refreshGraph: vi.fn(async (id: string) => {
      client.refreshed.push(id);
      return { ok: true as const };
    }),
    onGraphProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    onGraphChanged: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
  };
  return {
    client,
    set: (next: GraphState) => (state = next),
    pushProgress: (message: unknown) => progress.forEach((listener) => listener(message)),
    pushChanged: (message: unknown) => changed.forEach((listener) => listener(message)),
    listeners: () => progress.size + changed.size,
  };
}

const flush = () => act(async () => {});

describe("useVaultGraph", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads the vault's graph", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(result.current.snapshot).toEqual(snapshot);
    expect(result.current.error).toBe(null);
  });

  it("shows progress only once a build has run past the delay", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "V", read: 1, total: 10, walking: false }));
    expect(result.current.building).toEqual({ workspaceId: "V", read: 1, total: 10, walking: false });
    expect(result.current.progress).toBe(null);

    await act(async () => vi.advanceTimersByTime(PROGRESS_DELAY_MS));
    expect(result.current.progress).toEqual({ workspaceId: "V", read: 1, total: 10, walking: false });
  });

  it("never flashes progress for a build that finishes inside the delay", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "V", read: 0, total: 1, walking: true }));
    fake.set({ snapshot, building: null, error: null });
    act(() => fake.pushChanged({ workspaceId: "V" }));
    await flush();
    await act(async () => vi.advanceTimersByTime(PROGRESS_DELAY_MS * 2));

    expect(result.current.progress).toBe(null);
    expect(result.current.snapshot).toEqual(snapshot);
  });

  it("ignores events for other vaults and events that do not parse", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();

    act(() => fake.pushProgress({ workspaceId: "Other", read: 1, total: 2, walking: false }));
    act(() => fake.pushProgress({ workspaceId: "V", read: "one" }));
    act(() => fake.pushChanged({ workspaceId: "Other" }));
    await flush();

    expect(result.current.building).toBe(null);
    expect(fake.client.graphState).toHaveBeenCalledTimes(1);
  });

  it("reports a build that failed", async () => {
    const fake = fakeClient({ snapshot: null, building: null, error: "not-found" });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(result.current.error).toBe("not-found");
  });

  it("asks for a rebuild when refreshed", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const { result } = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    await act(async () => result.current.refresh());
    await flush();
    expect(fake.client.refreshed).toEqual(["V"]);
    // The previous graph stays while the new one builds.
    expect(result.current.snapshot).toEqual(snapshot);
    expect(fake.client.graphState).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a vault, and stops listening when unmounted", async () => {
    const fake = fakeClient({ snapshot, building: null, error: null });
    const none = renderHook(() => useVaultGraph(fake.client, null));
    await flush();
    expect(none.result.current.snapshot).toBe(null);
    expect(fake.client.graphState).not.toHaveBeenCalled();
    none.unmount();

    const some = renderHook(() => useVaultGraph(fake.client, "V"));
    await flush();
    expect(fake.listeners()).toBe(2);
    some.unmount();
    expect(fake.listeners()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root apps/app useVaultGraph`
Expected: FAIL - `./useVaultGraph` does not exist.

- [ ] **Step 3: Implement the bridge types**

In `apps/app/src/lib/workspaceClient.ts`:
1. Import `type GraphState` from `@trypthos/domain` in the existing domain import.
2. Near `ListResult`, add:

```ts
export type GraphStateResult = { ok: true; state: GraphState } | Failure;
export type RefreshGraphResult = { ok: true } | Failure;
```

3. Inside `interface WorkspaceClient`, after `openObsidianVault`:

```ts
  /// The vault graph by workspace id: the last finished snapshot, the build running, the last error.
  graphState(workspaceId: string): Promise<GraphStateResult>;
  /// Rebuilds a vault's graph. Refused while a build is running.
  refreshGraph(workspaceId: string): Promise<RefreshGraphResult>;
  /// Indexing progress, pushed to every window. Unparsed: `useVaultGraph` validates on arrival.
  onGraphProgress(listener: (message: unknown) => void): () => void;
  /// A vault's graph was rebuilt or updated; fetch it again.
  onGraphChanged(listener: (message: unknown) => void): () => void;
```

4. After the interface: `export type GraphClient = Pick<WorkspaceClient, "graphState" | "refreshGraph" | "onGraphProgress" | "onGraphChanged">;`
5. In `browserClient`, add:

```ts
  graphState: async () => unavailable(),
  refreshGraph: async () => unavailable(),
  onGraphProgress: () => () => {},
  onGraphChanged: () => () => {},
```

- [ ] **Step 4: Implement the hook**

`apps/app/src/hooks/useVaultGraph.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { GraphChangedSchema, GraphProgressSchema, GraphStateSchema } from "@trypthos/domain";
import type { GraphProgress, GraphSnapshot } from "@trypthos/domain";
import type { GraphClient } from "../lib/workspaceClient";

/// One vault's graph as the renderer sees it.
///
/// **Everything from the bridge is parsed on arrival.** Main is trusted, but the schema is what stops
/// the two sides drifting silently - a shape change would otherwise show as a graph that stops
/// updating rather than as an error.
///
/// **Progress waits.** A small vault indexes in well under a second, and a bar that flashes for a
/// frame reads as something going wrong. `building` is immediate (the refresh button needs it);
/// `progress` appears only once a build has run for `PROGRESS_DELAY_MS`.

export const PROGRESS_DELAY_MS = 300;

export interface VaultGraphView {
  snapshot: GraphSnapshot | null;
  building: GraphProgress | null;
  progress: GraphProgress | null;
  error: string | null;
  refresh(): void;
}

export function useVaultGraph(client: GraphClient, workspaceId: string | null): VaultGraphView {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [building, setBuilding] = useState<GraphProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delayed, setDelayed] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Cleared only when the vault changes. A refresh keeps the previous graph on screen while the new
  // one builds - that is the whole point of showing "showing index from 2 min ago".
  useEffect(() => {
    setSnapshot(null);
    setBuilding(null);
    setError(null);
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId === null) return;
    let live = true;

    const load = async () => {
      const answer = await client.graphState(workspaceId);
      if (!live) return;
      if (!answer.ok) {
        setError(answer.reason);
        return;
      }
      const parsed = GraphStateSchema.safeParse(answer.state);
      if (!parsed.success) return;
      setSnapshot(parsed.data.snapshot);
      setBuilding(parsed.data.building);
      setError(parsed.data.error);
    };

    const offProgress = client.onGraphProgress((message) => {
      const parsed = GraphProgressSchema.safeParse(message);
      if (parsed.success && parsed.data.workspaceId === workspaceId) setBuilding(parsed.data);
    });
    const offChanged = client.onGraphChanged((message) => {
      const parsed = GraphChangedSchema.safeParse(message);
      if (parsed.success && parsed.data.workspaceId === workspaceId) void load();
    });
    void load();

    return () => {
      live = false;
      offProgress();
      offChanged();
    };
  }, [client, workspaceId, generation]);

  const isBuilding = building !== null;
  useEffect(() => {
    setDelayed(false);
    if (!isBuilding) return;
    const timer = setTimeout(() => setDelayed(true), PROGRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isBuilding]);

  const refresh = useCallback(() => {
    if (workspaceId === null) return;
    void client.refreshGraph(workspaceId).then((answer) => {
      if (answer.ok) setGeneration((value) => value + 1);
    });
  }, [client, workspaceId]);

  return { snapshot, building, progress: delayed ? building : null, error, refresh };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root apps/app useVaultGraph bridgeSurface`
Expected: PASS. `bridgeSurface.test.ts` passes because the four new `WorkspaceClient` methods exist in `preload.js` (Task 7). Also run `npm run typecheck` - any other object typed `WorkspaceClient` (test fakes) must gain the four members; add the same `browserClient` stubs there.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/workspaceClient.ts apps/app/src/hooks/useVaultGraph.ts apps/app/src/hooks/useVaultGraph.test.ts
git commit -m "Follow a vault's graph, its build progress and its changes in the renderer"
```

---
### Task 9: Pure graph view logic - filters, status and theme

**Files:**
- Create: `apps/app/src/lib/graphFilters.ts`, `apps/app/src/lib/graphStatus.ts`, `apps/app/src/lib/graphTheme.ts`
- Test: `apps/app/src/lib/graphFilters.test.ts`, `apps/app/src/lib/graphStatus.test.ts`, `apps/app/src/lib/graphTheme.test.ts`

**Interfaces:**
- Consumes: `VaultGraph`, `GraphNodeKind`, `GraphProgress` types from `@trypthos/domain`.
- Produces:
```ts
// graphFilters.ts
export interface GraphFilter { notes: boolean; attachments: boolean; tags: boolean; unresolved: boolean; orphans: boolean }
export function hiddenNodes(graph: VaultGraph, filter: GraphFilter, keep?: string | null): Set<string>;
export function searchMatches(graph: VaultGraph, query: string): string[];
export function neighboursOf(graph: VaultGraph, id: string): Set<string>;
export function stepSelection(graph: VaultGraph, hidden: ReadonlySet<string>, current: string | null, fallback: string | null, direction: 1 | -1): string | null;
export function linkingNote(graph: VaultGraph, id: string): string | null;
// graphStatus.ts
export interface IndexAge { unit: "now" | "minutes" | "hours" | "days"; count: number }
export function indexAge(builtAt: string, now: number): IndexAge;
export function percentRead(progress: Pick<GraphProgress, "read" | "total">): number;
export function noteCount(graph: VaultGraph): number;
export function linkCount(graph: VaultGraph): number;
// graphTheme.ts
export interface GraphPalette { note: string; attachment: string; ghost: string; tag: string; edge: string; label: string; dim: string; pictogram: string; font: string }
export const GRAPH_TOKENS: Record<Exclude<keyof GraphPalette, "font">, string>;
export function readGraphPalette(style: { getPropertyValue(name: string): string }, font: string): GraphPalette;
export function observeTheme(onChange: () => void): () => void;
export const PICTOGRAMS: Record<GraphNodeKind, string>;   // data:image/svg+xml URIs
```

- [ ] **Step 1: Write the failing tests**

`apps/app/src/lib/graphFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { hiddenNodes, linkingNote, neighboursOf, searchMatches, stepSelection } from "./graphFilters";

const graph: VaultGraph = {
  nodes: [
    { id: "V/Alpha.md", kind: "note", label: "Alpha", path: "V/Alpha.md", degree: 3 },
    { id: "V/Beta.md", kind: "note", label: "Beta", path: "V/Beta.md", degree: 1 },
    { id: "V/Lonely.md", kind: "note", label: "Lonely", path: "V/Lonely.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 1 },
    { id: "ghost:gamma", kind: "ghost", label: "Gamma", path: null, degree: 1 },
    { id: "tag:inbox", kind: "tag", label: "#inbox", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/Alpha.md", target: "V/Beta.md", both: false },
    { source: "V/Alpha.md", target: "V/pic.png", both: false },
    { source: "V/Alpha.md", target: "ghost:gamma", both: false },
    { source: "V/Lonely.md", target: "tag:inbox", both: false },
  ],
};

const all = { notes: true, attachments: true, tags: true, unresolved: true, orphans: true };

describe("which nodes a filter hides", () => {
  it("hides nothing with every chip on", () => {
    expect([...hiddenNodes(graph, all)]).toEqual([]);
  });

  it("hides each kind by its own chip", () => {
    expect([...hiddenNodes(graph, { ...all, attachments: false })]).toEqual(["V/pic.png"]);
    expect([...hiddenNodes(graph, { ...all, tags: false })]).toEqual(["tag:inbox"]);
    expect([...hiddenNodes(graph, { ...all, unresolved: false })]).toEqual(["ghost:gamma"]);
    expect([...hiddenNodes(graph, { ...all, notes: false })]).toEqual(["V/Alpha.md", "V/Beta.md", "V/Lonely.md"]);
  });

  it("counts a note linked only to tags as an orphan, whether or not tags are shown", () => {
    expect([...hiddenNodes(graph, { ...all, orphans: false })]).toEqual(["V/Lonely.md"]);
    expect([...hiddenNodes(graph, { ...all, orphans: false, tags: false })].sort()).toEqual(["V/Lonely.md", "tag:inbox"]);
  });

  it("never hides the node it is told to keep", () => {
    expect([...hiddenNodes(graph, { ...all, orphans: false }, "V/Lonely.md")]).toEqual([]);
  });
});

describe("searching the graph", () => {
  it("matches labels case-insensitively, exact first, then prefix, then anywhere", () => {
    const withMore: VaultGraph = {
      nodes: [...graph.nodes, { id: "V/Alphabet.md", kind: "note", label: "Alphabet", path: "V/Alphabet.md", degree: 0 }, { id: "V/Beta alpha.md", kind: "note", label: "Beta alpha", path: "V/Beta alpha.md", degree: 0 }],
      edges: graph.edges,
    };
    expect(searchMatches(withMore, "ALPHA")).toEqual(["V/Alpha.md", "V/Alphabet.md", "V/Beta alpha.md"]);
  });

  it("matches nothing for an empty query", () => {
    expect(searchMatches(graph, "   ")).toEqual([]);
  });
});

describe("moving around the graph", () => {
  it("knows a node's neighbours in both directions", () => {
    expect([...neighboursOf(graph, "V/Beta.md")]).toEqual(["V/Alpha.md"]);
    expect([...neighboursOf(graph, "V/Alpha.md")].sort()).toEqual(["V/Beta.md", "V/pic.png", "ghost:gamma"]);
  });

  it("starts from the fallback, then steps to visible neighbours in label order", () => {
    const hidden = new Set(["V/pic.png"]);
    expect(stepSelection(graph, hidden, null, "V/Alpha.md", 1)).toBe("V/Alpha.md");
    expect(stepSelection(graph, hidden, "V/Alpha.md", null, 1)).toBe("V/Beta.md");
    expect(stepSelection(graph, hidden, "V/Alpha.md", null, -1)).toBe("ghost:gamma");
  });

  it("stays put on a node with no visible neighbours", () => {
    expect(stepSelection(graph, new Set(["tag:inbox"]), "V/Lonely.md", null, 1)).toBe("V/Lonely.md");
  });

  it("finds the note that links to a ghost", () => {
    expect(linkingNote(graph, "ghost:gamma")).toBe("V/Alpha.md");
    expect(linkingNote(graph, "ghost:none")).toBe(null);
  });
});
```

`apps/app/src/lib/graphStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { indexAge, linkCount, noteCount, percentRead } from "./graphStatus";

const at = Date.parse("2026-09-17T10:00:00.000Z");

describe("how old an index is", () => {
  it("rounds down to the largest whole unit", () => {
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 59_000)).toEqual({ unit: "now", count: 0 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 2 * 60_000)).toEqual({ unit: "minutes", count: 2 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 3 * 3_600_000)).toEqual({ unit: "hours", count: 3 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 50 * 3_600_000)).toEqual({ unit: "days", count: 2 });
  });

  it("calls a clock that runs behind 'now' rather than a negative age", () => {
    expect(indexAge("2026-09-17T10:00:00.000Z", at - 60_000)).toEqual({ unit: "now", count: 0 });
  });
});

describe("progress and counts", () => {
  it("gives a whole percentage, zero before anything is known", () => {
    expect(percentRead({ read: 1, total: 3 })).toBe(33);
    expect(percentRead({ read: 0, total: 0 })).toBe(0);
    expect(percentRead({ read: 5, total: 4 })).toBe(100);
  });

  it("counts notes, and links other than tags", () => {
    const graph: VaultGraph = {
      nodes: [
        { id: "V/A.md", kind: "note", label: "A", path: "V/A.md", degree: 2 },
        { id: "V/B.md", kind: "note", label: "B", path: "V/B.md", degree: 1 },
        { id: "tag:x", kind: "tag", label: "#x", path: null, degree: 1 },
      ],
      edges: [
        { source: "V/A.md", target: "V/B.md", both: true },
        { source: "V/A.md", target: "tag:x", both: false },
      ],
    };
    expect(noteCount(graph)).toBe(2);
    expect(linkCount(graph)).toBe(1);
  });
});
```

`apps/app/src/lib/graphTheme.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { GRAPH_TOKENS, observeTheme, PICTOGRAMS, readGraphPalette } from "./graphTheme";

describe("the graph's palette", () => {
  it("reads every colour from a theme token", () => {
    const style = { getPropertyValue: (name: string) => ` value-of${name} ` };
    const palette = readGraphPalette(style, "Segoe UI");
    expect(palette.font).toBe("Segoe UI");
    for (const [key, token] of Object.entries(GRAPH_TOKENS)) {
      expect(token.startsWith("--tp-")).toBe(true);
      expect(palette[key as keyof typeof GRAPH_TOKENS]).toBe(`value-of${token}`);
    }
  });

  it("notices an explicit theme being chosen", async () => {
    const changed = vi.fn();
    const stop = observeTheme(changed);
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.documentElement.removeAttribute("data-theme");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("the pictograms drawn in node discs", () => {
  it("has an SVG data URI with a fixed size for every kind", () => {
    for (const kind of ["note", "attachment", "ghost", "tag"] as const) {
      const uri = PICTOGRAMS[kind];
      expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
      const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
      expect(svg).toContain('width="64"');
      expect(svg).toContain('height="64"');
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root apps/app graphFilters graphStatus graphTheme`
Expected: FAIL - modules not found.

- [ ] **Step 3: Implement**

`apps/app/src/lib/graphFilters.ts`:

```ts
import type { VaultGraph } from "@trypthos/domain";

/// What the graph's chips and search do, as data. Kept out of the canvas so it is tested without
/// WebGL, and shared by the global tab and the local pane.

export interface GraphFilter {
  notes: boolean;
  attachments: boolean;
  tags: boolean;
  unresolved: boolean;
  orphans: boolean;
}

export function hiddenNodes(graph: VaultGraph, filter: GraphFilter, keep: string | null = null): Set<string> {
  const linked = new Set<string>();
  const tagIds = new Set(graph.nodes.filter((node) => node.kind === "tag").map((node) => node.id));
  for (const edge of graph.edges) {
    if (tagIds.has(edge.source) || tagIds.has(edge.target)) continue;
    linked.add(edge.source);
    linked.add(edge.target);
  }

  const hidden = new Set<string>();
  for (const node of graph.nodes) {
    if (node.id === keep) continue;
    const byKind =
      (node.kind === "note" && !filter.notes) ||
      (node.kind === "attachment" && !filter.attachments) ||
      (node.kind === "tag" && !filter.tags) ||
      (node.kind === "ghost" && !filter.unresolved);
    const orphan = node.kind === "note" && !filter.orphans && !linked.has(node.id);
    if (byKind || orphan) hidden.add(node.id);
  }
  return hidden;
}

export function searchMatches(graph: VaultGraph, query: string): string[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return [];
  const rank = (label: string) => (label === wanted ? 0 : label.startsWith(wanted) ? 1 : 2);
  return graph.nodes
    .map((node) => ({ id: node.id, label: node.label.toLowerCase() }))
    .filter((node) => node.label.includes(wanted))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.length - b.label.length || (a.id < b.id ? -1 : 1))
    .map((node) => node.id);
}

export function neighboursOf(graph: VaultGraph, id: string): Set<string> {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === id) found.add(edge.target);
    else if (edge.target === id) found.add(edge.source);
  }
  return found;
}

export function stepSelection(
  graph: VaultGraph,
  hidden: ReadonlySet<string>,
  current: string | null,
  fallback: string | null,
  direction: 1 | -1,
): string | null {
  const visible = (id: string) => !hidden.has(id);
  if (current === null) {
    if (fallback !== null && visible(fallback)) return fallback;
    return graph.nodes.find((node) => visible(node.id))?.id ?? null;
  }
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label.toLowerCase()]));
  const neighbours = [...neighboursOf(graph, current)]
    .filter(visible)
    .sort((a, b) => (labels.get(a)! < labels.get(b)! ? -1 : 1));
  if (neighbours.length === 0) return current;
  return direction === 1 ? neighbours[0]! : neighbours[neighbours.length - 1]!;
}

export function linkingNote(graph: VaultGraph, id: string): string | null {
  const sources = graph.edges.filter((edge) => edge.target === id).map((edge) => edge.source).sort();
  return sources[0] ?? null;
}
```

`apps/app/src/lib/graphStatus.ts`:

```ts
import type { GraphProgress, VaultGraph } from "@trypthos/domain";

/// The graph's status line as numbers. Wording lives in the component, which has `t`.

export interface IndexAge {
  unit: "now" | "minutes" | "hours" | "days";
  count: number;
}

export function indexAge(builtAt: string, now: number): IndexAge {
  const minutes = Math.floor(Math.max(now - Date.parse(builtAt), 0) / 60_000);
  if (minutes < 1) return { unit: "now", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}

export function percentRead(progress: Pick<GraphProgress, "read" | "total">): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.floor((progress.read * 100) / progress.total));
}

export function noteCount(graph: VaultGraph): number {
  return graph.nodes.filter((node) => node.kind === "note").length;
}

export function linkCount(graph: VaultGraph): number {
  return graph.edges.filter((edge) => !edge.target.startsWith("tag:")).length;
}
```

`apps/app/src/lib/graphTheme.ts`:

```ts
import type { GraphNodeKind } from "@trypthos/domain";

/// The graph canvas's colours, read from the same tokens as the chrome around it.
///
/// Sigma draws in WebGL and cannot read a CSS variable, so the values are read with
/// `getComputedStyle` and handed over - and read again whenever the theme changes, which is why
/// `observeTheme` exists. A hex written here would be the second palette `index.css` warns about.

export interface GraphPalette {
  note: string;
  attachment: string;
  ghost: string;
  tag: string;
  edge: string;
  label: string;
  dim: string;
  pictogram: string;
  font: string;
}

export const GRAPH_TOKENS: Record<Exclude<keyof GraphPalette, "font">, string> = {
  note: "--tp-obsidian",
  attachment: "--tp-leaf",
  ghost: "--tp-ink-4",
  tag: "--tp-accent",
  edge: "--tp-rule",
  label: "--tp-ink-3",
  dim: "--tp-hairline",
  pictogram: "--tp-app",
};

export function readGraphPalette(style: { getPropertyValue(name: string): string }, font: string): GraphPalette {
  const read = (token: string) => style.getPropertyValue(token).trim();
  return {
    note: read(GRAPH_TOKENS.note),
    attachment: read(GRAPH_TOKENS.attachment),
    ghost: read(GRAPH_TOKENS.ghost),
    tag: read(GRAPH_TOKENS.tag),
    edge: read(GRAPH_TOKENS.edge),
    label: read(GRAPH_TOKENS.label),
    dim: read(GRAPH_TOKENS.dim),
    pictogram: read(GRAPH_TOKENS.pictogram),
    font,
  };
}

/// Calls `onChange` when the theme a user sees could have changed: an explicit choice stamped on the
/// root, or the OS setting flipping while "system" is chosen.
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  )}`;

/// One pictogram per kind, drawn in the disc in the palette's `pictogram` colour. A page for a note,
/// a picture for an attachment, a hash for a tag, and a plus on a ghost - the note it would create.
export const PICTOGRAMS: Record<GraphNodeKind, string> = {
  note: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  attachment: svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 16l4-4 4 4 3-3 5 5"/>'),
  tag: svg('<path d="M10 4L8 20M16 4l-2 16M5 9h15M4 15h15"/>'),
  ghost: svg('<path d="M12 6v12M6 12h12"/>'),
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --root apps/app graphFilters graphStatus graphTheme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/graphFilters.ts apps/app/src/lib/graphFilters.test.ts apps/app/src/lib/graphStatus.ts apps/app/src/lib/graphStatus.test.ts apps/app/src/lib/graphTheme.ts apps/app/src/lib/graphTheme.test.ts
git commit -m "Add the graph view's filters, status numbers and token palette"
```

---

### Task 10: Dependencies and a deterministic layout

**Files:**
- Modify: `apps/app/package.json`, `package-lock.json` (by `npm install`)
- Create: `apps/app/src/lib/graphLayoutTypes.ts`, `apps/app/src/lib/graphLayout.ts`, `apps/app/src/lib/graphLayout.worker.ts`, `apps/app/src/lib/layoutClient.ts`, `apps/app/src/hooks/useGraphLayout.ts`
- Test: `apps/app/src/lib/graphLayout.test.ts`, `apps/app/src/hooks/useGraphLayout.test.ts`

**Interfaces:**
- Produces:
```ts
// graphLayoutTypes.ts (types only - safe to import anywhere)
export interface LayoutInput { nodes: { id: string }[]; edges: { source: string; target: string }[] }
export type Positions = Record<string, { x: number; y: number }>;
export type LayoutRunner = (input: LayoutInput) => Promise<Positions>;
// graphLayout.ts (lazy-only: imports graphology)
export function layoutIterations(order: number): number;
export function computeLayout(input: LayoutInput): Positions;
// layoutClient.ts (lazy-only: imports the inline worker)
export function createWorkerLayout(): { run: LayoutRunner; dispose(): void };
export function useLayoutRunner(injected: LayoutRunner | undefined): LayoutRunner | null;
// hooks/useGraphLayout.ts (eager-safe: types only)
export function useGraphLayout(input: LayoutInput | null, run: LayoutRunner): Positions | null;
```

- [ ] **Step 1: Add the dependencies**

Run:

```bash
npm install --workspace trypthos-app sigma@^3.0.3 graphology@^0.26.0 graphology-types@^0.24.8 graphology-layout@^0.6.1 graphology-layout-forceatlas2@^0.10.1 @sigma/node-image@^3.0.0
```

Then run `git diff package-lock.json | grep '"version": "0.83.0"'` - expected: no lines (our five version entries unchanged), and `npx vitest run --root apps/app versionMirrors` - expected PASS.

- [ ] **Step 2: Write the failing tests**

`apps/app/src/lib/graphLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLayout, layoutIterations } from "./graphLayout";

const input = {
  nodes: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "d", target: "e" },
    { source: "a", target: "missing" },
  ],
};

describe("laying out a graph", () => {
  it("places every node at a finite position", () => {
    const positions = computeLayout(input);
    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    for (const { x, y } of Object.values(positions)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("gives the same vault the same shape every time", () => {
    expect(computeLayout(input)).toEqual(computeLayout(input));
  });

  it("gives distinct positions, since nodes on one spot never separate", () => {
    const keys = Object.values(computeLayout(input)).map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("handles nothing and one node", () => {
    expect(computeLayout({ nodes: [], edges: [] })).toEqual({});
    expect(Object.keys(computeLayout({ nodes: [{ id: "only" }], edges: [] }))).toEqual(["only"]);
  });

  it("spends fewer iterations on bigger graphs", () => {
    expect(layoutIterations(100)).toBeGreaterThan(layoutIterations(1000));
    expect(layoutIterations(1000)).toBeGreaterThan(layoutIterations(5000));
  });
});
```

`apps/app/src/hooks/useGraphLayout.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LayoutInput, Positions } from "../lib/graphLayoutTypes";
import { useGraphLayout } from "./useGraphLayout";

function deferredRunner() {
  const pending: { input: LayoutInput; resolve: (positions: Positions) => void }[] = [];
  const run = (input: LayoutInput) => new Promise<Positions>((resolve) => pending.push({ input, resolve }));
  return { run, pending };
}

describe("useGraphLayout", () => {
  it("lays out a graph and hands back its positions", async () => {
    const runner = deferredRunner();
    const input = { nodes: [{ id: "a" }], edges: [] };
    const { result } = renderHook(() => useGraphLayout(input, runner.run));
    expect(result.current).toBe(null);
    await act(async () => runner.pending[0]!.resolve({ a: { x: 1, y: 2 } }));
    expect(result.current).toEqual({ a: { x: 1, y: 2 } });
  });

  it("drops a layout that finishes after the graph has changed", async () => {
    const runner = deferredRunner();
    const first = { nodes: [{ id: "a" }], edges: [] };
    const second = { nodes: [{ id: "b" }], edges: [] };
    const { result, rerender } = renderHook(({ input }) => useGraphLayout(input, runner.run), { initialProps: { input: first } });
    rerender({ input: second });
    await act(async () => runner.pending[0]!.resolve({ a: { x: 1, y: 1 } }));
    expect(result.current).toBe(null);
    await act(async () => runner.pending[1]!.resolve({ b: { x: 2, y: 2 } }));
    expect(result.current).toEqual({ b: { x: 2, y: 2 } });
  });

  it("has nothing to lay out without a graph", () => {
    const runner = deferredRunner();
    const { result } = renderHook(() => useGraphLayout(null, runner.run));
    expect(result.current).toBe(null);
    expect(runner.pending).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --root apps/app graphLayout useGraphLayout`
Expected: FAIL - modules not found.

- [ ] **Step 4: Implement**

`apps/app/src/lib/graphLayoutTypes.ts`:

```ts
/// The layout's shapes, apart from the layout itself, so eager modules can name them without
/// importing graphology.

export interface LayoutInput {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

export type Positions = Record<string, { x: number; y: number }>;

export type LayoutRunner = (input: LayoutInput) => Promise<Positions>;
```

`apps/app/src/lib/graphLayout.ts`:

```ts
import Graph from "graphology";
import { circular } from "graphology-layout";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { LayoutInput, Positions } from "./graphLayoutTypes";

/// A force layout that gives the same vault the same shape every time.
///
/// ForceAtlas2 has no randomness of its own, so identical starting positions, insertion order,
/// settings and iteration count give identical output. The start is a circle in node order - the
/// snapshot's sorted order - rather than random positions, and the iteration count is fixed rather
/// than "run until it looks settled", which would depend on how fast the machine is.

export function layoutIterations(order: number): number {
  if (order > 2000) return 60;
  if (order > 500) return 150;
  return 300;
}

export function computeLayout(input: LayoutInput): Positions {
  const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const node of input.nodes) graph.mergeNode(node.id);
  for (const edge of input.edges) {
    if (edge.source === edge.target || !graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (!graph.hasEdge(edge.source, edge.target)) graph.addEdge(edge.source, edge.target);
  }
  if (graph.order === 0) return {};

  circular.assign(graph, { scale: 100 });
  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: layoutIterations(graph.order),
      settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 500 },
    });
  }

  const positions: Positions = {};
  graph.forEachNode((id, attributes) => {
    positions[id] = { x: attributes.x as number, y: attributes.y as number };
  });
  return positions;
}
```

`apps/app/src/lib/graphLayout.worker.ts`:

```ts
import { computeLayout } from "./graphLayout";
import type { LayoutInput, Positions } from "./graphLayoutTypes";

/// Runs the layout off the renderer's main thread. Loaded as an inline (blob) worker, so it needs no
/// separate file at runtime - a module worker loaded from file:// is refused in the packaged app.

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; input: LayoutInput }>) => void) | null;
  postMessage(message: { id: number; positions: Positions }): void;
};

scope.onmessage = (event) => {
  scope.postMessage({ id: event.data.id, positions: computeLayout(event.data.input) });
};
```

`apps/app/src/lib/layoutClient.ts`:

```ts
import { useEffect, useState } from "react";
import type { LayoutRunner, Positions } from "./graphLayoutTypes";
import LayoutWorker from "./graphLayout.worker?worker&inline";

/// The layout runner a graph view uses: the one a test injects, or a worker of its own. The worker
/// is made in an effect, not during render, so StrictMode's second mount gets a live one.
export function useLayoutRunner(injected: LayoutRunner | undefined): LayoutRunner | null {
  const [run, setRun] = useState<LayoutRunner | null>(() => injected ?? null);
  useEffect(() => {
    if (injected !== undefined) return;
    const worker = createWorkerLayout();
    setRun(() => worker.run);
    return () => worker.dispose();
  }, [injected]);
  return run;
}

/// A promise per layout request, answered by the inline worker. One worker per graph view, disposed
/// with it.
export function createWorkerLayout(): { run: LayoutRunner; dispose(): void } {
  const worker = new LayoutWorker();
  const waiting = new Map<number, { resolve: (positions: Positions) => void; reject: (error: Error) => void }>();
  let next = 0;

  worker.onmessage = (event: MessageEvent<{ id: number; positions: Positions }>) => {
    waiting.get(event.data.id)?.resolve(event.data.positions);
    waiting.delete(event.data.id);
  };
  worker.onerror = () => {
    for (const { reject } of waiting.values()) reject(new Error("The graph layout failed."));
    waiting.clear();
  };

  return {
    run: (input) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, input });
      }),
    dispose: () => {
      worker.terminate();
      waiting.clear();
    },
  };
}
```

`apps/app/src/hooks/useGraphLayout.ts`:

```ts
import { useEffect, useState } from "react";
import type { LayoutInput, LayoutRunner, Positions } from "../lib/graphLayoutTypes";

/// Positions for a graph, recomputed when the graph object changes. A layout that finishes after the
/// graph has moved on is dropped - drawing it would put the old vault's shape under the new nodes.
/// A failed layout leaves `null`, which the views show as "not drawn yet" rather than crashing.
export function useGraphLayout(input: LayoutInput | null, run: LayoutRunner): Positions | null {
  const [positions, setPositions] = useState<Positions | null>(null);

  useEffect(() => {
    setPositions(null);
    if (input === null) return;
    let live = true;
    run(input).then(
      (result) => {
        if (live) setPositions(result);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [input, run]);

  return positions;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root apps/app graphLayout useGraphLayout` then `npm run typecheck`.
Expected: PASS and a clean typecheck (Vite's client types declare `*?worker&inline`; if tsc reports the module unresolved, add `/// <reference types="vite/client" />` to `apps/app/src/vite-env.d.ts` if it is not already there).

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json package-lock.json apps/app/src/lib/graphLayoutTypes.ts apps/app/src/lib/graphLayout.ts apps/app/src/lib/graphLayout.test.ts apps/app/src/lib/graphLayout.worker.ts apps/app/src/lib/layoutClient.ts apps/app/src/hooks/useGraphLayout.ts apps/app/src/hooks/useGraphLayout.test.ts
git commit -m "Add sigma and graphology, and lay out a graph deterministically in a worker"
```

---
### Task 11: The Sigma canvas and the bundle guard

**Files:**
- Create: `apps/app/src/components/GraphCanvas.tsx`, `apps/app/src/lib/graphBundle.test.ts`
- Test: `apps/app/src/components/GraphCanvas.browser.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `VaultGraph`, `GraphNode` (domain); `Positions`, `LayoutInput` (Task 10); `readGraphPalette`, `observeTheme`, `PICTOGRAMS`, `GraphPalette` (Task 9); `stepSelection` (Task 9); `computeLayout`, `createWorkerLayout` (Task 10, browser test only).
- Produces:
```ts
export interface GraphCanvasProps {
  graph: VaultGraph;
  positions: Positions;
  hidden: ReadonlySet<string>;
  highlighted: ReadonlySet<string> | null;   // search matches; null when not searching
  activeId: string | null;                   // the note in the active editor tab
  focusId: string | null;                    // select and centre on this node when it changes
  compact?: boolean;                         // the local pane: smaller nodes, no zoom buttons
  label: string;                             // accessible name of the canvas
  onOpen(node: GraphNode): void;             // double-click or Enter
  onRenderer?(renderer: Sigma | null): void; // tests only
}
export default function GraphCanvas(props: GraphCanvasProps): JSX.Element;
```
The container carries `data-testid="graph-canvas"` and `data-selected="<id or empty>"`.

- [ ] **Step 1: Write the failing bundle guard**

`apps/app/src/lib/graphBundle.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { stripComments } from "../testing/stripComments";

/// The graph libraries and the modules built on them stay out of the initial bundle.
///
/// Nothing but who imports what enforces it: a static import of sigma from an eager module
/// type-checks, renders and passes every other test while putting WebGL programs and a layout
/// engine on every page load. So the allowed importers are listed, and everyone else must reach
/// them through `lazy(() => import(...))`.

const SRC = repoPath("apps", "app", "src");

const GRAPH_ONLY = new Set([
  "components/GraphPage.tsx",
  "components/LocalGraph.tsx",
  "components/GraphCanvas.tsx",
  "lib/graphLayout.ts",
  "lib/graphLayout.worker.ts",
  "lib/layoutClient.ts",
]);

const LIBRARY_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s+["'](?:sigma|graphology|graphology-[\w-]+|@sigma\/[\w-]+)(?:\/[^"']*)?["']/m;
const GRAPH_MODULE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s+["']\.{1,2}\/(?:[\w.]+\/)*(?:GraphPage|LocalGraph|GraphCanvas|graphLayout|graphLayout\.worker|layoutClient)(?:\?[^"']*)?["']/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .map((file) => ({ file: relative(SRC, file).split(sep).join("/"), text: stripComments(readFileSync(file, "utf8")) }))
    .filter(({ file, text }) => pattern.test(text) && !GRAPH_ONLY.has(file))
    .map(({ file }) => file);
}

describe("the graph stays out of the initial bundle", () => {
  it("imports sigma and graphology only from the lazy graph modules", () => {
    expect(offenders(LIBRARY_IMPORT)).toEqual([]);
  });

  it("reaches the lazy graph modules only through a dynamic import", () => {
    expect(offenders(GRAPH_MODULE_IMPORT)).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(LIBRARY_IMPORT.test('import Sigma from "sigma";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { EdgeArrowProgram } from "sigma/rendering";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import forceAtlas2 from "graphology-layout-forceatlas2";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { createNodeImageProgram } from "@sigma/node-image";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import type Sigma from "sigma";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('import GraphPage from "./components/GraphPage";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import Worker from "./graphLayout.worker?worker&inline";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import type { Positions } from "../lib/graphLayoutTypes";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('const GraphPage = lazy(() => import("./components/GraphPage"));')).toBe(false);
  });
});
```

- [ ] **Step 2: Prove the guard can fail, then run it**

Temporarily add `import Graph from "graphology";` to the top of `apps/app/src/App.tsx`, run `npx vitest run --root apps/app graphBundle` - expected FAIL listing `App.tsx`. Remove the line, run again - expected PASS (no graph modules exist yet, so both lists are empty).

- [ ] **Step 3: Write the failing browser test**

`apps/app/src/components/GraphCanvas.browser.test.tsx`:

```tsx
import { render, waitFor } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
import type Sigma from "sigma";
import { describe, expect, it, vi } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { computeLayout } from "../lib/graphLayout";
import { createWorkerLayout } from "../lib/layoutClient";
import { readGraphPalette } from "../lib/graphTheme";
import GraphCanvas from "./GraphCanvas";

const graph: VaultGraph = {
  nodes: [
    { id: "V/Alpha.md", kind: "note", label: "Alpha", path: "V/Alpha.md", degree: 2 },
    { id: "V/Beta.md", kind: "note", label: "Beta", path: "V/Beta.md", degree: 1 },
    { id: "ghost:gamma", kind: "ghost", label: "Gamma", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/Alpha.md", target: "V/Beta.md", both: true },
    { source: "V/Alpha.md", target: "ghost:gamma", both: false },
  ],
};

async function mount(overrides: Partial<Parameters<typeof GraphCanvas>[0]> = {}) {
  await page.viewport(900, 700);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:400px";
  document.body.append(host);
  let renderer: Sigma | null = null;
  const onOpen = vi.fn();
  const view = render(
    <div style={{ width: 600, height: 400 }}>
      <GraphCanvas
        graph={graph}
        positions={computeLayout(graph)}
        hidden={new Set()}
        highlighted={null}
        activeId={null}
        focusId={null}
        label="Link graph of V"
        onOpen={onOpen}
        onRenderer={(value) => (renderer = value)}
        {...overrides}
      />
    </div>,
    { container: host },
  );
  await waitFor(() => expect(renderer).not.toBe(null));
  const canvas = view.getByTestId("graph-canvas");
  const pointAt = (id: string) => {
    const attributes = renderer!.getGraph().getNodeAttributes(id);
    return renderer!.graphToViewport({ x: attributes.x as number, y: attributes.y as number });
  };
  return { view, canvas, onOpen, pointAt, renderer: () => renderer! };
}

describe("GraphCanvas", () => {
  it("opens a note on double-click and selects on a single click", async () => {
    const { canvas, onOpen, pointAt } = await mount();
    const beta = pointAt("V/Beta.md");

    await userEvent.click(canvas, { position: { x: beta.x, y: beta.y } });
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Beta.md"));

    await userEvent.dblClick(canvas, { position: { x: beta.x, y: beta.y } });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(graph.nodes[1]));
  });

  it("walks neighbours with the arrow keys and opens with Enter", async () => {
    const { canvas, onOpen } = await mount({ activeId: "V/Alpha.md" });
    canvas.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Alpha.md"));
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Beta.md"));
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(graph.nodes[1]);
  });

  it("paints in theme tokens that differ between light and dark", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const light = readGraphPalette(getComputedStyle(document.documentElement), "x");
    document.documentElement.setAttribute("data-theme", "dark");
    const dark = readGraphPalette(getComputedStyle(document.documentElement), "x");
    document.documentElement.removeAttribute("data-theme");

    for (const key of ["note", "attachment", "ghost", "tag", "edge", "label", "dim", "pictogram"] as const) {
      expect(light[key]).not.toBe("");
      expect(dark[key]).not.toBe("");
    }
    expect(light.note).not.toBe(dark.note);
  });

  it("repaints node colours when the theme changes", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { renderer } = await mount();
    const before = renderer().getGraph().getNodeAttribute("V/Alpha.md", "color");
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(renderer().getGraph().getNodeAttribute("V/Alpha.md", "color")).not.toBe(before));
    document.documentElement.removeAttribute("data-theme");
  });

  it("lays out the same positions in the worker as on the main thread", async () => {
    const layout = createWorkerLayout();
    try {
      expect(await layout.run(graph)).toEqual(computeLayout(graph));
    } finally {
      layout.dispose();
    }
  });
});
```

Add the strings the canvas uses to `apps/app/src/locales/en.json` as a new top-level group after `"obsidian"` (later tasks add more keys to this group):

```json
  "graph": {
    "zoomIn": "Zoom in",
    "zoomOut": "Zoom out",
    "fit": "Fit graph",
    "tooLarge": "This graph is too large to draw on this computer."
  },
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm run test:browser --workspace trypthos-app -- GraphCanvas`
Expected: FAIL - `./GraphCanvas` not found.

- [ ] **Step 5: Implement**

`apps/app/src/components/GraphCanvas.tsx`:

```tsx
import { createNodeImageProgram } from "@sigma/node-image";
import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Sigma from "sigma";
import {
  EdgeArrowProgram,
  EdgeDoubleArrowProgram,
  EdgeLineProgram,
  NodeCircleProgram,
  createNodeCompoundProgram,
} from "sigma/rendering";
import type { GraphNode, VaultGraph } from "@trypthos/domain";
import { stepSelection } from "../lib/graphFilters";
import type { Positions } from "../lib/graphLayoutTypes";
import { observeTheme, PICTOGRAMS, readGraphPalette } from "../lib/graphTheme";
import type { GraphPalette } from "../lib/graphTheme";
import Glyph from "./Glyph";

/// The vault graph, drawn with Sigma in WebGL.
///
/// **Lazy only.** This module and the libraries it imports are reached through `lazy()`; see
/// `graphBundle.test.ts`.
///
/// **Interaction state lives in a ref, not in React state.** Hover and selection change on every
/// mouse move, and Sigma's reducers read them at draw time - a re-render per hover would rebuild
/// nothing useful and cost a frame.

export interface GraphCanvasProps {
  graph: VaultGraph;
  positions: Positions;
  hidden: ReadonlySet<string>;
  highlighted: ReadonlySet<string> | null;
  activeId: string | null;
  focusId: string | null;
  compact?: boolean;
  label: string;
  onOpen(node: GraphNode): void;
  onRenderer?(renderer: Sigma | null): void;
}

const NodeDiscProgram = createNodeCompoundProgram([
  NodeCircleProgram,
  createNodeImageProgram({ padding: 0.22, size: { mode: "force", value: 64 }, drawingMode: "color", colorAttribute: "pictoColor" }),
]);

function currentPalette(): GraphPalette {
  return readGraphPalette(getComputedStyle(document.documentElement), getComputedStyle(document.body).fontFamily);
}

function nodeSize(degree: number, compact: boolean): number {
  return compact ? Math.min(4 + Math.sqrt(degree) * 1.5, 11) : Math.min(5 + Math.sqrt(degree) * 2, 18);
}

export default function GraphCanvas({
  graph,
  positions,
  hidden,
  highlighted,
  activeId,
  focusId,
  compact = false,
  label,
  onOpen,
  onRenderer,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma | null>(null);
  const view = useRef({ hidden, highlighted, activeId, hovered: null as string | null, selected: null as string | null });
  const callbacks = useRef({ onOpen, onRenderer });
  const [palette, setPalette] = useState(currentPalette);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbacks.current = { onOpen, onRenderer };
  }, [onOpen, onRenderer]);

  useEffect(() => observeTheme(() => setPalette(currentPalette())), []);

  const select = (id: string | null) => {
    view.current.selected = id;
    if (container.current !== null) container.current.dataset.selected = id ?? "";
    renderer.current?.refresh({ skipIndexation: true });
  };

  const centreOn = (id: string) => {
    const shown = renderer.current?.getNodeDisplayData(id);
    if (shown !== undefined) void renderer.current!.getCamera().animate({ x: shown.x, y: shown.y }, { duration: 250 });
  };

  const open = (id: string | null) => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (node !== undefined) callbacks.current.onOpen(node);
  };

  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    const model = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
    for (const node of graph.nodes) {
      const at = positions[node.id];
      if (at === undefined) continue;
      model.addNode(node.id, {
        x: at.x,
        y: at.y,
        size: nodeSize(node.degree, compact),
        label: node.label,
        color: palette[node.kind],
        image: PICTOGRAMS[node.kind],
        pictoColor: palette.pictogram,
      });
    }
    for (const edge of graph.edges) {
      if (!model.hasNode(edge.source) || !model.hasNode(edge.target) || model.hasEdge(edge.source, edge.target)) continue;
      model.addEdge(edge.source, edge.target, {
        type: edge.target.startsWith("tag:") ? "line" : edge.both ? "doubleArrow" : "arrow",
        size: 1,
        color: palette.edge,
      });
    }

    let sigma: Sigma;
    try {
      sigma = new Sigma(model, host, {
        allowInvalidContainer: true,
        defaultNodeType: "disc",
        nodeProgramClasses: { disc: NodeDiscProgram },
        edgeProgramClasses: { arrow: EdgeArrowProgram, doubleArrow: EdgeDoubleArrowProgram, line: EdgeLineProgram },
        labelColor: { color: palette.label },
        labelFont: palette.font,
        labelSize: compact ? 10 : 12,
        labelRenderedSizeThreshold: compact ? 10 : 8,
        zIndex: true,
        nodeReducer: (node, data) => {
          const state = view.current;
          if (state.hidden.has(node)) return { ...data, hidden: true };
          const focus = state.hovered ?? state.selected;
          const near = focus === null || node === focus || model.areNeighbors(focus, node);
          const found = state.highlighted === null || state.highlighted.has(node);
          const shown = { ...data };
          if (!near || !found) {
            shown.color = palette.dim;
            shown.label = null;
            shown.zIndex = 0;
          } else if (focus !== null || state.highlighted !== null) {
            shown.forceLabel = true;
            shown.zIndex = 1;
          }
          if (node === state.activeId || node === state.selected) {
            shown.highlighted = true;
            shown.forceLabel = true;
            shown.zIndex = 2;
          }
          if (node === state.activeId) shown.size = data.size * 1.4;
          return shown;
        },
        edgeReducer: (edge, data) => {
          const state = view.current;
          const [source, target] = model.extremities(edge);
          if (state.hidden.has(source) || state.hidden.has(target)) return { ...data, hidden: true };
          const focus = state.hovered ?? state.selected;
          if (focus !== null && source !== focus && target !== focus) return { ...data, color: palette.dim };
          return data;
        },
      });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    renderer.current = sigma;
    host.dataset.selected = view.current.selected ?? "";

    let dragging: string | null = null;
    sigma.on("enterNode", ({ node }) => {
      view.current.hovered = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      view.current.hovered = null;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => select(node));
    sigma.on("clickStage", () => select(null));
    sigma.on("doubleClickNode", (event) => {
      event.preventSigmaDefault();
      open(event.node);
    });
    sigma.on("downNode", ({ node }) => {
      dragging = node;
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.on("moveBody", ({ event }) => {
      if (dragging === null) return;
      const at = sigma.viewportToGraph(event);
      model.setNodeAttribute(dragging, "x", at.x);
      model.setNodeAttribute(dragging, "y", at.y);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const stopDragging = () => {
      dragging = null;
    };
    sigma.on("upNode", stopDragging);
    sigma.on("upStage", stopDragging);

    callbacks.current.onRenderer?.(sigma);
    return () => {
      callbacks.current.onRenderer?.(null);
      sigma.kill();
      renderer.current = null;
    };
    // `open` and `select` read refs and `graph`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, positions, palette, compact]);

  useEffect(() => {
    view.current.hidden = hidden;
    view.current.highlighted = highlighted;
    view.current.activeId = activeId;
    renderer.current?.refresh({ skipIndexation: true });
  }, [hidden, highlighted, activeId]);

  useEffect(() => {
    if (focusId === null) return;
    select(focusId);
    centreOn(focusId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key] as 1 | -1 | undefined;
    if (step !== undefined) {
      event.preventDefault();
      const next = stepSelection(graph, view.current.hidden, view.current.selected, view.current.activeId, step);
      select(next);
      if (next !== null) centreOn(next);
    } else if (event.key === "Enter") {
      open(view.current.selected);
    } else if (event.key === "Escape") {
      select(null);
    }
  };

  if (failed) {
    return <p className="p-4 text-sm text-danger">{t("graph.tooLarge")}</p>;
  }

  const camera = () => renderer.current?.getCamera();
  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        data-testid="graph-canvas"
        role="application"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {!compact && (
        <div className="absolute right-2 bottom-2 flex flex-col gap-0.5">
          <button type="button" title={t("graph.zoomIn")} aria-label={t("graph.zoomIn")} onClick={() => void camera()?.animatedZoom({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M12 5v14M5 12h14" /></Glyph>
          </button>
          <button type="button" title={t("graph.zoomOut")} aria-label={t("graph.zoomOut")} onClick={() => void camera()?.animatedUnzoom({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M5 12h14" /></Glyph>
          </button>
          <button type="button" title={t("graph.fit")} aria-label={t("graph.fit")} onClick={() => void camera()?.animatedReset({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Glyph>
          </button>
        </div>
      )}
    </div>
  );
}
```

Two typecheck notes, decided here so nobody guesses:
- If `forceLabel` is not in sigma 3.0.3's `NodeDisplayData` type, delete the two `shown.forceLabel = true;` lines and rely on `highlighted` (Sigma draws a highlighted node's label regardless of size).
- If the `Glyph` import path or its default-vs-named export differs, match `WorkspacePanel.tsx`'s import of it.

- [ ] **Step 6: Run the browser test and the guard to see them pass**

Run: `npm run test:browser --workspace trypthos-app -- GraphCanvas` then `npx vitest run --root apps/app graphBundle i18nKeys noFancyDashes` then `npm run typecheck` and `npm run lint`.
Expected: all PASS / clean. `i18nKeys` passes because every `graph.*` key added is used by a literal `t("graph.x")` call.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/components/GraphCanvas.tsx apps/app/src/components/GraphCanvas.browser.test.tsx apps/app/src/lib/graphBundle.test.ts apps/app/src/locales/en.json
git commit -m "Draw the vault graph with Sigma, and keep it out of the initial bundle"
```

---
### Task 12: The global graph tab (`GraphPage`)

**Files:**
- Create: `apps/app/src/lib/graphActions.ts`, `apps/app/src/components/GraphPage.tsx`, `apps/app/src/testing/fakeGraphClient.ts`
- Test: `apps/app/src/lib/graphActions.test.ts`, `apps/app/src/components/GraphPage.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `useVaultGraph` (Task 8), `GraphClient` (Task 8), `useGraphLayout` + `LayoutRunner` (Task 10), `createWorkerLayout` (Task 10), `GraphCanvas` + `GraphCanvasProps` (Task 11), `GraphFilter`, `hiddenNodes`, `searchMatches`, `linkingNote` (Task 9), `indexAge`, `percentRead`, `noteCount`, `linkCount` (Task 9), `newNoteDirectory` (Task 4).
- Produces:
```ts
// graphActions.ts
export type GraphNodeAction = { kind: "open"; path: string } | { kind: "create"; directory: string; name: string } | null;
export function graphNodeAction(node: GraphNode, snapshot: GraphSnapshot): GraphNodeAction;
// GraphPage.tsx (default export, lazy only)
export interface GraphPageProps {
  workspaceId: string;
  vaultName: string;
  client: GraphClient;
  activePath: string | null;
  filter: GraphFilter;
  onFilterChange(change: Partial<GraphFilter>): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
  now?: () => number;
}
// testing/fakeGraphClient.ts
export function fakeGraphClient(initial: GraphState): { client: GraphClient; set(state: GraphState): void; pushProgress(message: unknown): void; pushChanged(message: unknown): void };
export function FakeCanvas(props: GraphCanvasProps): JSX.Element;   // renders nodes as buttons; data-* mirrors props
export const instantLayout: LayoutRunner;
```

- [ ] **Step 1: Write the failing tests**

`apps/app/src/lib/graphActions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { graphNodeAction } from "./graphActions";

const snapshot = (newNotes: GraphSnapshot["newNotes"]): GraphSnapshot => ({
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes,
  nodes: [
    { id: "V/a/From.md", kind: "note", label: "From", path: "V/a/From.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 0 },
    { id: "ghost:plans/risks", kind: "ghost", label: "Plans/Risks", path: null, degree: 1 },
    { id: "tag:x", kind: "tag", label: "#x", path: null, degree: 0 },
  ],
  edges: [{ source: "V/a/From.md", target: "ghost:plans/risks", both: false }],
});

describe("what double-clicking a node does", () => {
  it("opens a note or an attachment by its path", () => {
    const shot = snapshot({ mode: "root" });
    expect(graphNodeAction(shot.nodes[0]!, shot)).toEqual({ kind: "open", path: "V/a/From.md" });
    expect(graphNodeAction(shot.nodes[1]!, shot)).toEqual({ kind: "open", path: "V/pic.png" });
  });

  it("creates a ghost's note where Obsidian would, named by the last part of the link", () => {
    const beside = snapshot({ mode: "current" });
    expect(graphNodeAction(beside.nodes[2]!, beside)).toEqual({ kind: "create", directory: "V/a", name: "Risks" });
    const inbox = snapshot({ mode: "folder", folder: "Inbox" });
    expect(graphNodeAction(inbox.nodes[2]!, inbox)).toEqual({ kind: "create", directory: "V/Inbox", name: "Risks" });
  });

  it("does nothing for a tag", () => {
    const shot = snapshot({ mode: "root" });
    expect(graphNodeAction(shot.nodes[3]!, shot)).toBe(null);
  });
});
```

`apps/app/src/testing/fakeGraphClient.ts`:

```tsx
import type { GraphState } from "@trypthos/domain";
import type { GraphCanvasProps } from "../components/GraphCanvas";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import type { GraphClient } from "../lib/workspaceClient";

/// A hand-written graph bridge for jsdom tests: answers `state`, and lets a test push events.
export function fakeGraphClient(initial: GraphState) {
  let state = initial;
  const progress = new Set<(message: unknown) => void>();
  const changed = new Set<(message: unknown) => void>();
  const refreshed: string[] = [];
  const client: GraphClient = {
    graphState: async () => ({ ok: true as const, state }),
    refreshGraph: async (workspaceId) => {
      refreshed.push(workspaceId);
      return { ok: true as const };
    },
    onGraphProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    onGraphChanged: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
  };
  return {
    client,
    refreshed,
    set: (next: GraphState) => (state = next),
    pushProgress: (message: unknown) => progress.forEach((listener) => listener(message)),
    pushChanged: (message: unknown) => changed.forEach((listener) => listener(message)),
  };
}

/// Stands in for the WebGL canvas, which jsdom cannot run. Every node is a button, so a test can
/// double-click one, and the props a test cares about are mirrored onto data attributes.
export function FakeCanvas(props: GraphCanvasProps) {
  return (
    <div
      data-testid="fake-canvas"
      data-hidden={[...props.hidden].sort().join(",")}
      data-highlighted={props.highlighted === null ? "" : [...props.highlighted].join(",")}
      data-active={props.activeId ?? ""}
      data-focus={props.focusId ?? ""}
      data-compact={props.compact ? "true" : "false"}
      aria-label={props.label}
    >
      {props.graph.nodes.map((node) => (
        <button key={node.id} type="button" onDoubleClick={() => props.onOpen(node)}>
          {node.label}
        </button>
      ))}
    </div>
  );
}

export const instantLayout: LayoutRunner = async (input) =>
  Object.fromEntries(input.nodes.map((node, index) => [node.id, { x: index, y: 0 }]));
```

The `import type` from `../components/GraphCanvas` is type-only, so the bundle guard allows it (and `testing/` holds no production code).

`apps/app/src/components/GraphPage.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { FakeCanvas, fakeGraphClient, instantLayout } from "../testing/fakeGraphClient";
import GraphPage from "./GraphPage";

const NOW = Date.parse("2026-09-17T10:00:00.000Z");
const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "folder", folder: "Inbox" },
  nodes: [
    { id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 2 },
    { id: "V/B.md", kind: "note", label: "Beta", path: "V/B.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 0 },
    { id: "ghost:risks", kind: "ghost", label: "Risks", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/A.md", target: "V/B.md", both: false },
    { source: "V/A.md", target: "ghost:risks", both: false },
  ],
};
const filter = { notes: true, attachments: false, tags: false, unresolved: true, orphans: true };

function page(fake: ReturnType<typeof fakeGraphClient>, overrides = {}) {
  const props = {
    workspaceId: "V",
    vaultName: "Research",
    client: fake.client,
    activePath: "V/B.md",
    filter,
    onFilterChange: vi.fn(),
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    layout: instantLayout,
    Canvas: FakeCanvas,
    now: () => NOW,
    ...overrides,
  };
  render(<GraphPage {...props} />);
  return props;
}

const flush = () => act(async () => {});

describe("GraphPage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the first build's progress once it has run a moment", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 10, walking: false }, error: null });
    page(fake);
    await flush();
    expect(screen.queryByText("Indexing Research")).toBeNull();
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByText("Indexing Research")).toBeTruthy();
    expect(screen.getByText("1 of 10 files")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("10");
  });

  it("draws the graph with the filter applied and says how big and how fresh it is", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const canvas = screen.getByTestId("fake-canvas");
    expect(canvas.dataset.hidden).toBe("V/pic.png");
    expect(canvas.dataset.active).toBe("V/B.md");
    expect(canvas.getAttribute("aria-label")).toBe("Link graph of Research");
    expect(screen.getByText("2 notes - 2 links - indexed just now")).toBeTruthy();
  });

  it("toggles a chip through the settings, and shows each chip's state", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    const props = page(fake);
    await flush();
    const attachments = screen.getByRole("button", { name: "Attachments" });
    expect(attachments.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(attachments);
    expect(props.onFilterChange).toHaveBeenCalledWith({ attachments: true });
  });

  it("highlights search matches and centres on the best one with Enter", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const search = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(search, { target: { value: "be" } });
    expect(screen.getByTestId("fake-canvas").dataset.highlighted).toBe("V/B.md");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("fake-canvas").dataset.focus).toBe("V/B.md");
  });

  it("opens a note and offers to create a ghost's note on double-click", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    const props = page(fake);
    await flush();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Alpha" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("V/A.md");
    fireEvent.doubleClick(screen.getByRole("button", { name: "Risks" }));
    expect(props.onCreateNote).toHaveBeenCalledWith({ directory: "V/Inbox", name: "Risks" });
  });

  it("refreshes, keeps the old graph on screen, and disables refresh while building", async () => {
    const fake = fakeGraphClient({ snapshot, building: null, error: null });
    page(fake);
    await flush();
    const refresh = screen.getByRole("button", { name: "Refresh graph" });
    await act(async () => fireEvent.click(refresh));
    expect(fake.refreshed).toEqual(["V"]);

    act(() => fake.pushProgress({ workspaceId: "V", read: 2, total: 4, walking: false }));
    expect((screen.getByRole("button", { name: "Refresh graph" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("fake-canvas")).toBeTruthy();
    expect(screen.getByText("Refreshing - 2 of 4 files - showing index from just now")).toBeTruthy();
  });

  it("says when a build failed", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: null, error: "not-found" });
    page(fake);
    await flush();
    expect(screen.getByText("The graph could not be built. Refresh to try again.")).toBeTruthy();
  });

  it("says when a vault has no notes", async () => {
    const fake = fakeGraphClient({ snapshot: { ...snapshot, nodes: [], edges: [] }, building: null, error: null });
    page(fake);
    await flush();
    expect(screen.getByText("No notes in this vault yet")).toBeTruthy();
  });

  it("counts files it could not read", async () => {
    const fake = fakeGraphClient({ snapshot: { ...snapshot, unreadable: 3 }, building: null, error: null });
    page(fake);
    await flush();
    expect(screen.getByText((text) => text.includes("Files that could not be read: 3"))).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root apps/app graphActions GraphPage`
Expected: FAIL - modules not found.

- [ ] **Step 3: Add the strings**

Extend the `"graph"` group in `apps/app/src/locales/en.json` (keep the four keys from Task 11):

```json
    "refresh": "Refresh graph",
    "filters": "Graph filters",
    "chipNotes": "Notes",
    "chipAttachments": "Attachments",
    "chipTags": "Tags",
    "chipUnresolved": "Unresolved",
    "chipOrphans": "Orphans",
    "search": "Search notes",
    "searchPlaceholder": "Search notes...",
    "canvas": "Link graph of {{name}}",
    "indexing": "Indexing {{name}}",
    "progress": "{{read}} of {{total}} files",
    "progressWalking": "{{read}} of {{total}}+ files",
    "refreshing": "Refreshing - {{read}} of {{total}} files - showing index from {{age}}",
    "status": "{{notes}} notes - {{links}} links - indexed {{age}}",
    "unreadable": "Files that could not be read: {{count}}",
    "ageNow": "just now",
    "ageMinutes": "{{count}} min ago",
    "ageHours": "{{count}} h ago",
    "ageDays": "{{count}} days ago",
    "buildFailed": "The graph could not be built. Refresh to try again.",
    "empty": "No notes in this vault yet"
```

- [ ] **Step 4: Implement**

`apps/app/src/lib/graphActions.ts`:

```ts
import { newNoteDirectory } from "@trypthos/domain";
import type { GraphNode, GraphSnapshot } from "@trypthos/domain";
import { linkingNote } from "./graphFilters";

/// What double-clicking a node means, as data, shared by the global tab and the local pane.
///
/// A ghost is a note somebody linked to and nobody wrote, so its action is to create it - in the
/// folder Obsidian's own "default location for new notes" names, and named by the last part of the
/// link, since a file name cannot hold the folders a link like `[[Plans/Risks]]` spells out.

export type GraphNodeAction =
  | { kind: "open"; path: string }
  | { kind: "create"; directory: string; name: string }
  | null;

export function graphNodeAction(node: GraphNode, snapshot: GraphSnapshot): GraphNodeAction {
  if ((node.kind === "note" || node.kind === "attachment") && node.path !== null) return { kind: "open", path: node.path };
  if (node.kind !== "ghost") return null;
  const directory = newNoteDirectory(snapshot.newNotes, snapshot.workspaceId, linkingNote(snapshot, node.id));
  return { kind: "create", directory, name: node.label.slice(node.label.lastIndexOf("/") + 1) };
}
```

`apps/app/src/components/GraphPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { useVaultGraph } from "../hooks/useVaultGraph";
import { graphNodeAction } from "../lib/graphActions";
import { hiddenNodes, searchMatches } from "../lib/graphFilters";
import type { GraphFilter } from "../lib/graphFilters";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import { indexAge, linkCount, noteCount, percentRead } from "../lib/graphStatus";
import type { IndexAge } from "../lib/graphStatus";
import { useLayoutRunner } from "../lib/layoutClient";
import type { GraphClient } from "../lib/workspaceClient";
import GraphCanvas from "./GraphCanvas";
import type { GraphCanvasProps } from "./GraphCanvas";
import Glyph from "./Glyph";

/// The vault graph tab. Lazy only - see `graphBundle.test.ts`.

export interface GraphPageProps {
  workspaceId: string;
  vaultName: string;
  client: GraphClient;
  activePath: string | null;
  filter: GraphFilter;
  onFilterChange(change: Partial<GraphFilter>): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
  now?: () => number;
}

const never: LayoutRunner = () => new Promise(() => {});

function useAgeText(): (age: IndexAge) => string {
  const { t } = useTranslation();
  return (age) => {
    if (age.unit === "minutes") return t("graph.ageMinutes", { count: age.count });
    if (age.unit === "hours") return t("graph.ageHours", { count: age.count });
    if (age.unit === "days") return t("graph.ageDays", { count: age.count });
    return t("graph.ageNow");
  };
}

export default function GraphPage({
  workspaceId,
  vaultName,
  client,
  activePath,
  filter,
  onFilterChange,
  onOpenPath,
  onCreateNote,
  layout,
  Canvas = GraphCanvas,
  now = Date.now,
}: GraphPageProps) {
  const { t } = useTranslation();
  const ageText = useAgeText();
  const graph = useVaultGraph(client, workspaceId);
  const run = useLayoutRunner(layout);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const { snapshot, building, progress, error } = graph;
  const input = useMemo(() => (snapshot === null ? null : { nodes: snapshot.nodes, edges: snapshot.edges }), [snapshot]);
  const positions = useGraphLayout(run === null ? null : input, run ?? never);
  const hidden = useMemo(() => (snapshot === null ? new Set<string>() : hiddenNodes(snapshot, filter)), [snapshot, filter]);
  const matches = useMemo(() => (snapshot === null ? [] : searchMatches(snapshot, query)), [snapshot, query]);
  const highlighted = useMemo(() => (query.trim() === "" ? null : new Set(matches)), [matches, query]);
  const activeId = snapshot?.nodes.some((node) => node.id === activePath) ? activePath : null;

  const chips: { key: keyof GraphFilter; label: string }[] = [
    { key: "notes", label: t("graph.chipNotes") },
    { key: "attachments", label: t("graph.chipAttachments") },
    { key: "tags", label: t("graph.chipTags") },
    { key: "unresolved", label: t("graph.chipUnresolved") },
    { key: "orphans", label: t("graph.chipOrphans") },
  ];

  const progressText = (value: NonNullable<typeof progress>) =>
    value.walking ? t("graph.progressWalking", { read: value.read, total: value.total }) : t("graph.progress", { read: value.read, total: value.total });

  let status: { text: string; danger: boolean } | null = null;
  if (error !== null) status = { text: t("graph.buildFailed"), danger: true };
  else if (progress !== null && snapshot !== null) {
    status = {
      text: t("graph.refreshing", { read: progress.read, total: progress.total, age: ageText(indexAge(snapshot.builtAt, now())) }),
      danger: false,
    };
  } else if (snapshot !== null) {
    status = {
      text: t("graph.status", { notes: noteCount(snapshot), links: linkCount(snapshot), age: ageText(indexAge(snapshot.builtAt, now())) }),
      danger: false,
    };
  }

  let body: React.ReactNode = null;
  if (snapshot === null && progress !== null) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-ink-3">
        <p>{t("graph.indexing", { name: vaultName })}</p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentRead(progress)} className="h-1 w-56 overflow-hidden rounded bg-hairline">
          <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
        </div>
        <p className="text-xs text-ink-4">{progressText(progress)}</p>
      </div>
    );
  } else if (snapshot !== null && snapshot.nodes.length === 0) {
    body = <p className="flex h-full items-center justify-center text-sm text-ink-4">{t("graph.empty")}</p>;
  } else if (snapshot !== null && positions !== null) {
    body = (
      <Canvas
        graph={snapshot}
        positions={positions}
        hidden={hidden}
        highlighted={highlighted}
        activeId={activeId}
        focusId={focusId}
        label={t("graph.canvas", { name: vaultName })}
        onOpen={(node) => {
          const action = graphNodeAction(node, snapshot);
          if (action?.kind === "open") onOpenPath(action.path);
          else if (action?.kind === "create") onCreateNote({ directory: action.directory, name: action.name });
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app">
      <div className="relative flex flex-col gap-1.5 border-b border-rule px-3 py-2">
        <div role="group" aria-label={t("graph.filters")} className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label={t("graph.refresh")}
            title={t("graph.refresh")}
            disabled={building !== null}
            onClick={graph.refresh}
            className="flex size-5 items-center justify-center rounded border border-rule bg-sunken text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <Glyph className={building !== null ? "size-3 animate-spin" : "size-3"}>
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </Glyph>
          </button>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filter[chip.key]}
              onClick={() => onFilterChange({ [chip.key]: !filter[chip.key] })}
              className={
                filter[chip.key]
                  ? "rounded-full border border-obsidian bg-selected px-2.5 text-xs text-ink"
                  : "rounded-full border border-rule px-2.5 text-xs text-ink-4 hover:bg-hover"
              }
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label={t("graph.search")}
          placeholder={t("graph.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0] !== undefined) setFocusId(matches[0]);
          }}
          className="w-full rounded border border-rule bg-panel px-2 py-1 text-sm text-ink placeholder:text-ink-4"
        />
        {progress !== null && snapshot !== null && (
          <div className="absolute inset-x-0 -bottom-px h-0.5 bg-hairline">
            <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
          </div>
        )}
      </div>
      <div className="relative min-h-0 grow">
        {body}
        {status !== null && (
          <p className={status.danger ? "absolute bottom-2 left-3 text-xs text-danger" : "absolute bottom-2 left-3 text-xs text-ink-4"}>
            {status.text}
            {snapshot !== null && snapshot.unreadable > 0 && ` - ${t("graph.unreadable", { count: snapshot.unreadable })}`}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root apps/app graphActions GraphPage graphBundle i18nKeys noFancyDashes` then `npm run typecheck` and `npm run lint`.
Expected: PASS / clean. (`i18nKeys` fails on a key in `en.json` that no `t("...")` reads; the local-pane keys are added in Task 13, not here, for that reason.)

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/graphActions.ts apps/app/src/lib/graphActions.test.ts apps/app/src/components/GraphPage.tsx apps/app/src/components/GraphPage.test.tsx apps/app/src/testing/fakeGraphClient.ts apps/app/src/locales/en.json
git commit -m "Add the vault graph tab with filters, search, status and progress"
```

---
### Task 13: The local graph pane

**Files:**
- Create: `apps/app/src/components/LocalGraphPane.tsx` (eager), `apps/app/src/components/LocalGraph.tsx` (lazy)
- Test: `apps/app/src/components/LocalGraphPane.test.tsx`, `apps/app/src/components/LocalGraph.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `useVaultGraph` (Task 8), `percentRead` (Task 9), `neighbourhood` (Task 3), `hiddenNodes` (Task 9), `graphNodeAction` (Task 12), `useLayoutRunner` (from `lib/layoutClient.ts`, Task 10 - LocalGraph is lazy, so importing it is allowed), `useGraphLayout` (Task 10), `GraphCanvas` (Task 11), test helpers from `testing/fakeGraphClient.ts` (Task 12).
- Produces:
```ts
// LocalGraph.tsx (default export, lazy only)
export interface LocalGraphProps {
  snapshot: GraphSnapshot;
  centre: string;
  depth: number;
  filter: GraphFilter;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
}
// LocalGraphPane.tsx (default export, eager)
export interface LocalGraphPaneProps {
  client: GraphClient;
  workspaceId: string | null;   // the local vault the active note is in, or null
  activePath: string | null;
  filter: GraphFilter;
  depth: number;
  collapsed: boolean;
  onDepthChange(depth: number): void;
  onCollapsedChange(collapsed: boolean): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  Body?: ComponentType<LocalGraphProps>;   // tests inject; default is the lazy LocalGraph
}
```

- [ ] **Step 1: Write the failing tests**

`apps/app/src/components/LocalGraph.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { FakeCanvas, instantLayout } from "../testing/fakeGraphClient";
import LocalGraph from "./LocalGraph";

const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "root" },
  nodes: [
    { id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 2 },
    { id: "V/B.md", kind: "note", label: "Beta", path: "V/B.md", degree: 2 },
    { id: "V/C.md", kind: "note", label: "Gamma", path: "V/C.md", degree: 1 },
    { id: "V/Lonely.md", kind: "note", label: "Lonely", path: "V/Lonely.md", degree: 0 },
  ],
  edges: [
    { source: "V/A.md", target: "V/B.md", both: false },
    { source: "V/B.md", target: "V/C.md", both: false },
  ],
};
const filter = { notes: true, attachments: false, tags: false, unresolved: true, orphans: false };

function show(overrides = {}) {
  const props = {
    snapshot,
    centre: "V/A.md",
    depth: 1,
    filter,
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    layout: instantLayout,
    Canvas: FakeCanvas,
    ...overrides,
  };
  render(<LocalGraph {...props} />);
  return props;
}

describe("LocalGraph", () => {
  it("draws the centre note's neighbourhood to the depth chosen, compactly", async () => {
    show();
    await act(async () => {});
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Alpha", "Beta"]);
    expect(screen.getByTestId("fake-canvas").dataset.compact).toBe("true");
    expect(screen.getByTestId("fake-canvas").dataset.active).toBe("V/A.md");
  });

  it("goes further at a greater depth", async () => {
    show({ depth: 2 });
    await act(async () => {});
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("never hides the centre note, even as an orphan", async () => {
    show({ centre: "V/Lonely.md" });
    await act(async () => {});
    expect(screen.getByTestId("fake-canvas").dataset.hidden).toBe("");
  });

  it("opens a neighbour on double-click", async () => {
    const props = show();
    await act(async () => {});
    fireEvent.doubleClick(screen.getByRole("button", { name: "Beta" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("V/B.md");
  });
});
```

`apps/app/src/components/LocalGraphPane.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import { fakeGraphClient } from "../testing/fakeGraphClient";
import type { LocalGraphProps } from "./LocalGraph";
import LocalGraphPane from "./LocalGraphPane";

const snapshot: GraphSnapshot = {
  workspaceId: "V",
  builtAt: "2026-09-17T10:00:00.000Z",
  unreadable: 0,
  newNotes: { mode: "root" },
  nodes: [{ id: "V/A.md", kind: "note", label: "Alpha", path: "V/A.md", degree: 0 }],
  edges: [],
};

function FakeBody(props: LocalGraphProps) {
  return <div data-testid="local-body" data-centre={props.centre} data-depth={props.depth} />;
}

function pane(fake: ReturnType<typeof fakeGraphClient>, overrides = {}) {
  const props = {
    client: fake.client,
    workspaceId: "V" as string | null,
    activePath: "V/A.md" as string | null,
    filter: { notes: true, attachments: false, tags: false, unresolved: true, orphans: true },
    depth: 1,
    collapsed: false,
    onDepthChange: vi.fn(),
    onCollapsedChange: vi.fn(),
    onOpenPath: vi.fn(),
    onCreateNote: vi.fn(),
    Body: FakeBody,
    ...overrides,
  };
  render(<LocalGraphPane {...props} />);
  return props;
}

describe("LocalGraphPane", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the active note's graph", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }));
    await act(async () => {});
    expect(screen.getByRole("region", { name: "Local graph" })).toBeTruthy();
    expect(screen.getByTestId("local-body").dataset.centre).toBe("V/A.md");
  });

  it("asks for a vault note when the active tab is not one", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { workspaceId: null, activePath: "trypthos:graph/V" });
    await act(async () => {});
    expect(screen.getByText("Open a note in a vault to see its links")).toBeTruthy();
    expect(screen.queryByTestId("local-body")).toBeNull();
  });

  it("asks the same for a note the graph does not have", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { activePath: "V/Other.md" });
    await act(async () => {});
    expect(screen.getByText("Open a note in a vault to see its links")).toBeTruthy();
  });

  it("changes depth and collapses through its settings", async () => {
    const props = pane(fakeGraphClient({ snapshot, building: null, error: null }));
    await act(async () => {});
    fireEvent.change(screen.getByRole("combobox", { name: "Depth" }), { target: { value: "3" } });
    expect(props.onDepthChange).toHaveBeenCalledWith(3);
    const collapse = screen.getByRole("button", { name: "Collapse local graph" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.querySelector("svg")).not.toBeNull();
    fireEvent.click(collapse);
    expect(props.onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("shows only its header when collapsed", async () => {
    pane(fakeGraphClient({ snapshot, building: null, error: null }), { collapsed: true });
    await act(async () => {});
    expect(screen.queryByTestId("local-body")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand local graph" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows indexing progress under its header, even collapsed", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 3, walking: false }, error: null });
    pane(fake, { collapsed: true });
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
  });

  it("says how far indexing has got when there is no graph yet", async () => {
    const fake = fakeGraphClient({ snapshot: null, building: { workspaceId: "V", read: 1, total: 3, walking: false }, error: null });
    pane(fake);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByText("Indexing - 33%")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root apps/app LocalGraph`
Expected: FAIL - modules not found.

- [ ] **Step 3: Add the strings**

Add to the `"graph"` group in `en.json`:

```json
    "localTitle": "Local graph",
    "depth": "Depth",
    "depthValue": "Depth {{count}}",
    "collapse": "Collapse local graph",
    "expand": "Expand local graph",
    "localEmpty": "Open a note in a vault to see its links",
    "localIndexing": "Indexing - {{percent}}%"
```

- [ ] **Step 4: Implement**

`apps/app/src/components/LocalGraph.tsx`:

```tsx
import { neighbourhood } from "@trypthos/domain";
import type { GraphSnapshot } from "@trypthos/domain";
import { useMemo } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { graphNodeAction } from "../lib/graphActions";
import { hiddenNodes } from "../lib/graphFilters";
import type { GraphFilter } from "../lib/graphFilters";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import { useLayoutRunner } from "../lib/layoutClient";
import GraphCanvas from "./GraphCanvas";
import type { GraphCanvasProps } from "./GraphCanvas";

/// The local graph's body: the active note and what it links to, to the chosen depth. Lazy only.
///
/// Filters apply as in the tab except Orphans - the centre is what the pane is about, so it is never
/// hidden, and asking whether its neighbours are orphans makes no sense when they are its neighbours.

export interface LocalGraphProps {
  snapshot: GraphSnapshot;
  centre: string;
  depth: number;
  filter: GraphFilter;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
}

const never: LayoutRunner = () => new Promise(() => {});

export default function LocalGraph({ snapshot, centre, depth, filter, onOpenPath, onCreateNote, layout, Canvas = GraphCanvas }: LocalGraphProps) {
  const { t } = useTranslation();
  const run = useLayoutRunner(layout);
  const local = useMemo(() => neighbourhood(snapshot, centre, depth), [snapshot, centre, depth]);
  const input = useMemo(() => ({ nodes: local.nodes, edges: local.edges }), [local]);
  const positions = useGraphLayout(run === null ? null : input, run ?? never);
  const hidden = useMemo(() => hiddenNodes(local, { ...filter, orphans: true }, centre), [local, filter, centre]);

  if (positions === null) return null;
  return (
    <Canvas
      graph={local}
      positions={positions}
      hidden={hidden}
      highlighted={null}
      activeId={centre}
      focusId={null}
      compact
      label={t("graph.localTitle")}
      onOpen={(node) => {
        const action = graphNodeAction(node, snapshot);
        if (action?.kind === "open") onOpenPath(action.path);
        else if (action?.kind === "create") onCreateNote({ directory: action.directory, name: action.name });
      }}
    />
  );
}
```

`apps/app/src/components/LocalGraphPane.tsx`:

```tsx
import { lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useVaultGraph } from "../hooks/useVaultGraph";
import type { GraphFilter } from "../lib/graphFilters";
import { percentRead } from "../lib/graphStatus";
import type { GraphClient } from "../lib/workspaceClient";
import Glyph from "./Glyph";
import type { LocalGraphProps } from "./LocalGraph";

/// The local graph pane under the workspace trees. Eager and small: the header, its controls and the
/// messages. The canvas underneath is `LocalGraph`, loaded only when there is something to draw.

const LazyLocalGraph = lazy(() => import("./LocalGraph"));

export interface LocalGraphPaneProps {
  client: GraphClient;
  workspaceId: string | null;
  activePath: string | null;
  filter: GraphFilter;
  depth: number;
  collapsed: boolean;
  onDepthChange(depth: number): void;
  onCollapsedChange(collapsed: boolean): void;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  Body?: ComponentType<LocalGraphProps>;
}

export default function LocalGraphPane({
  client,
  workspaceId,
  activePath,
  filter,
  depth,
  collapsed,
  onDepthChange,
  onCollapsedChange,
  onOpenPath,
  onCreateNote,
  Body = LazyLocalGraph,
}: LocalGraphPaneProps) {
  const { t } = useTranslation();
  const { snapshot, progress } = useVaultGraph(client, workspaceId);
  const centre = activePath !== null && snapshot?.nodes.some((node) => node.id === activePath) ? activePath : null;

  let body: React.ReactNode;
  if (workspaceId !== null && snapshot === null && progress !== null) {
    body = <p className="p-3 text-xs text-ink-4">{t("graph.localIndexing", { percent: percentRead(progress) })}</p>;
  } else if (snapshot === null || centre === null) {
    body = <p className="p-3 text-xs text-ink-4">{t("graph.localEmpty")}</p>;
  } else {
    body = (
      <Suspense fallback={null}>
        <Body snapshot={snapshot} centre={centre} depth={depth} filter={filter} onOpenPath={onOpenPath} onCreateNote={onCreateNote} />
      </Suspense>
    );
  }

  const toggleLabel = collapsed ? t("graph.expand") : t("graph.collapse");
  return (
    <section aria-label={t("graph.localTitle")} className="flex shrink-0 flex-col border-t border-rule">
      <div className="relative flex items-center gap-1 px-3 py-1">
        <h2 className="grow text-xs font-semibold text-ink-3">{t("graph.localTitle")}</h2>
        <select
          aria-label={t("graph.depth")}
          value={depth}
          onChange={(event) => onDepthChange(Number(event.target.value))}
          className="rounded border border-rule bg-panel px-1 text-xs text-ink-3"
        >
          {[1, 2, 3].map((value) => (
            <option key={value} value={value}>
              {t("graph.depthValue", { count: value })}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
          className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
        >
          <Glyph className={collapsed ? "size-3.5 -rotate-90" : "size-3.5"}>
            <path d="M6 9l6 6 6-6" />
          </Glyph>
        </button>
        {progress !== null && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentRead(progress)}
            className="absolute inset-x-0 bottom-0 h-0.5 bg-hairline"
          >
            <div className="h-full bg-accent" style={{ width: `${percentRead(progress)}%` }} />
          </div>
        )}
      </div>
      {!collapsed && <div className="relative h-48">{body}</div>}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --root apps/app LocalGraph graphBundle i18nKeys noFancyDashes` then `npm run typecheck` and `npm run lint`.
Expected: PASS / clean. The bundle guard allows `LocalGraphPane.tsx`: it imports `./LocalGraph` only as `import type` and through `lazy()`.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/LocalGraph.tsx apps/app/src/components/LocalGraph.test.tsx apps/app/src/components/LocalGraphPane.tsx apps/app/src/components/LocalGraphPane.test.tsx apps/app/src/locales/en.json
git commit -m "Add the local graph pane that follows the active note"
```

---

### Task 14: Wire the graph into the window

**Files:**
- Modify: `apps/app/src/hooks/useWorkspace.ts`, `apps/app/src/components/WorkspacePanel.tsx`, `apps/app/src/components/NewFileDialog.tsx`, `apps/app/src/App.tsx`
- Test: `apps/app/src/hooks/useWorkspace.test.ts`, `apps/app/src/components/WorkspacePanel.test.tsx`, `apps/app/src/components/NewFileDialog.test.tsx`

**Interfaces:**
- Consumes: `graphPagePath`, `graphPageWorkspaceId`, `splitQualified` (domain); `GraphPage` (lazy), `LocalGraphPane`; `settings.graph` and `update` from `useSettings`; `actions.createEmptyFile(directory, name)`, `actions.openPath` / `actions.openFile`.
- Produces:
  - `actions.openGraphPage(workspaceId: string): void` - opens `trypthos:graph/<id>` read-only, revision `{ id: "graph" }`, empty content; a second call only switches to it.
  - `WorkspacePanel` props: `workspaces` items gain `vault?: boolean`; new `onOpenGraphPage(workspaceId: string): void`; new `bottomPane?: React.ReactNode` rendered between the tree and the footer.
  - `NewFileDialog` prop `initialName?: string`.

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/hooks/useWorkspace.test.ts`, beside the guide tests (same `fakeClient()` helper), add and import `graphPagePath` from `@trypthos/domain`:

```ts
describe("the vault graph tab", () => {
  it("opens read-only in a tab of its own, without reading anything from disk", async () => {
    const { client, reads } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.openGraphPage("Research"));

    expect(result.current.state.activePath).toBe(graphPagePath("Research"));
    expect(result.current.state.readOnly).toBe(true);
    expect(result.current.state.content).toBe("");
    expect(reads).toEqual([]);
  });

  it("switches to the tab it already has rather than opening a second", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useWorkspace(client));

    act(() => result.current.actions.openGraphPage("Research"));
    act(() => result.current.actions.openGraphPage("Research"));

    expect(result.current.state.documents.filter((document) => document.path === graphPagePath("Research"))).toHaveLength(1);
  });
});
```

In `apps/app/src/components/WorkspacePanel.test.tsx`, add `onOpenGraphPage: vi.fn(),` to the `panel()` defaults, widen the `workspaces` item type with `vault?: boolean`, and add:

```tsx
const RESEARCH = { id: "Research", name: "Research", ref: { kind: "local" as const, root: "D:/Research" }, truncated: false, vault: true };

describe("a vault's root row", () => {
  it("opens the vault's graph as well as expanding", async () => {
    const props = panel({ workspaces: [RESEARCH], folders: {} });
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(props.onOpenGraphPage).toHaveBeenCalledWith("Research");
    expect(props.onToggleFolder).toHaveBeenCalledWith("Research");
  });

  it("opens no graph for a folder that is not a vault", async () => {
    const props = panel({ workspaces: [DIARIZ] });
    fireEvent.click(screen.getByRole("button", { name: "Diariz" }));
    expect(props.onOpenGraphPage).not.toHaveBeenCalled();
  });

  it("draws the pane it is given under the trees", () => {
    panel({ bottomPane: <section aria-label="Pane below" /> });
    expect(screen.getByRole("region", { name: "Pane below" })).toBeTruthy();
  });
});
```

(`panel()` must return the props it rendered with; if it does not, capture `vi.fn()`s in the test and pass them as overrides.)

In `apps/app/src/components/NewFileDialog.test.tsx`, add:

```tsx
it("starts with a name it is given", () => {
  render(<NewFileDialog fileTypes={["markdown"]} initialName="Risks" onCancel={vi.fn()} onCreate={vi.fn()} />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Risks");
});
```

(Use the test file's existing way of finding the name field if it is not the only textbox.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root apps/app useWorkspace WorkspacePanel NewFileDialog`
Expected: FAIL - `openGraphPage is not a function`, `onOpenGraphPage` not called, no region "Pane below", value `""`.

- [ ] **Step 3: Implement**

`apps/app/src/hooks/useWorkspace.ts`:
1. Add `openGraphPage(workspaceId: string): void;` to the actions interface beside `openRepoPage` (line ~157), with the comment `/// Opens a local vault's graph in a tab of its own, like a repository's page.`
2. Beside the `openRepoPage` implementation, add (importing `graphPagePath` from `@trypthos/domain`):

```ts
    openGraphPage: (workspaceId: string) =>
      setInternal((prev) => ({
        ...prev,
        documents: openDocument(prev.documents, {
          path: graphPagePath(workspaceId),
          // Nothing, deliberately: the page fetches its graph, and `content` is what the editor holds
          // and what chat sends.
          content: "",
          revision: { id: "graph" },
          readOnly: true,
        }),
      })),
```

`apps/app/src/components/WorkspacePanel.tsx`:
1. In `Props`, change the `workspaces` item type to include `vault?: boolean;` (and the same in `WorkspaceRow`'s `workspace` prop type).
2. Add props:

```ts
  /// Opens a local vault's graph tab. Called from the vault's root row, as a repository's row opens
  /// its page.
  onOpenGraphPage: (workspaceId: string) => void;
  /// Drawn under the trees and above the footer - the local graph pane, when a vault is open.
  bottomPane?: React.ReactNode;
```

3. In the root row's `onToggle` (line ~361), after the GitHub line:

```tsx
                    // A vault's row is its home too: clicking it opens the vault's graph.
                    if (workspace.ref.kind === "local" && workspace.vault === true) onOpenGraphPage(workspace.id);
```

4. Immediately after the scrolling tree container closes (the `</div>` of `data-testid="workspace-body"` at line ~420) and before the context menu, add `{bottomPane}`.

`apps/app/src/components/NewFileDialog.tsx`: add `initialName?: string;` to `Props` with the comment `/// A name to start from - a ghost in the vault graph arrives already named.`, destructure it, and change `useState("")` to `useState(initialName ?? "")`.

`apps/app/src/App.tsx`:
1. Imports: add `graphPageWorkspaceId` to the `@trypthos/domain` import; `import LocalGraphPane from "./components/LocalGraphPane";`; and beside the `ReleaseNotes` lazy import: `const GraphPage = lazy(() => import("./components/GraphPage"));`.
2. State beside `namingFile`: `const [namingNote, setNamingNote] = useState<{ directory: string; name: string } | null>(null);`
3. Beside `const repoPageId = ...`:

```tsx
  const graphPageId = graphPageWorkspaceId(state.activePath ?? "");
  const graphWorkspace = state.workspaces.find((workspace) => workspace.id === graphPageId) ?? null;
  // The local vault the active note belongs to, for the local graph pane.
  const activeWorkspace = state.workspaces.find(
    (workspace) => workspace.id === splitQualified(state.activePath ?? "")?.workspaceId,
  );
  const localVaultId = activeWorkspace?.vault === true && activeWorkspace.ref.kind === "local" ? activeWorkspace.id : null;
  const anyVaultOpen = state.workspaces.some((workspace) => workspace.vault === true);
  const graphFilter = {
    notes: settings.graph.notes,
    attachments: settings.graph.attachments,
    tags: settings.graph.tags,
    unresolved: settings.graph.unresolved,
    orphans: settings.graph.orphans,
  };
  const updateGraph = (change: Partial<typeof settings.graph>) =>
    update((prev) => ({ graph: { ...prev.graph, ...change } }));
```

4. On `<WorkspacePanel ...>` add:

```tsx
            onOpenGraphPage={actions.openGraphPage}
            bottomPane={
              anyVaultOpen ? (
                <LocalGraphPane
                  client={client}
                  workspaceId={localVaultId}
                  activePath={state.activePath}
                  filter={graphFilter}
                  depth={settings.graph.localDepth}
                  collapsed={settings.graph.localCollapsed}
                  onDepthChange={(localDepth) => updateGraph({ localDepth })}
                  onCollapsedChange={(localCollapsed) => updateGraph({ localCollapsed })}
                  onOpenPath={(path) => void actions.openPath(path)}
                  onCreateNote={setNamingNote}
                />
              ) : undefined
            }
```

If `useWorkspace` exposes only `openFile(node)` and not `openPath`, expose `openPath` on the actions object (it already exists internally at line ~1002) with a one-line test in `useWorkspace.test.ts` that `actions.openPath("b.md")` opens the same tab `openFile(NODE)` does.

5. Replace the `page={...}` expression on `<EditorPanel>` with:

```tsx
              page={
                repoPageId !== null ? (
                  <RepoPage /* unchanged props */ />
                ) : graphPageId !== null && graphWorkspace !== null ? (
                  <Suspense fallback={null}>
                    <GraphPage
                      workspaceId={graphWorkspace.id}
                      vaultName={graphWorkspace.name}
                      client={client}
                      activePath={state.activePath}
                      filter={graphFilter}
                      onFilterChange={updateGraph}
                      onOpenPath={(path) => void actions.openPath(path)}
                      onCreateNote={setNamingNote}
                    />
                  </Suspense>
                ) : null
              }
```

(keep RepoPage's existing props exactly as they are). While the graph tab itself is active, `activePath` names no node, so nothing is ringed - the highlight matters in the local pane, which sits beside a note.

6. Beside the existing `{namingFile && (<NewFileDialog ... />)}` block:

```tsx
      {namingNote !== null && (
        <NewFileDialog
          fileTypes={settings.fileTypes.enabled}
          initialName={namingNote.name}
          onCancel={() => setNamingNote(null)}
          onCreate={(name) => {
            const { directory } = namingNote;
            setNamingNote(null);
            void actions.createEmptyFile(directory, name);
          }}
        />
      )}
```

7. Any test file constructing `WorkspacePanel` without `onOpenGraphPage` fails typecheck - add `onOpenGraphPage: vi.fn()` there.

- [ ] **Step 4: Run everything the window touches**

Run: `npx vitest run --root apps/app` (whole jsdom suite), then `npm run typecheck`, `npm run lint`, `npm run test:browser`.
Expected: all PASS / clean. The existing `App.browser.test.tsx` still passes: no vault is open there, so no pane renders.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/components/NewFileDialog.tsx apps/app/src/components/NewFileDialog.test.tsx apps/app/src/App.tsx
git commit -m "Open a vault's graph from its root row and show the local graph under the trees"
```

---
### Task 15: Documentation, version, release notes, verification and the PR

Docs and release metadata have guard tests (`versionMirrors`, `releases`, `noFancyDashes`, `SettingsDialog` About table); the version bump is the failing-test-first step.

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json`, `apps/app/src/lib/releaseNotes/current.ts`, `apps/app/src/lib/appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`

- [ ] **Step 1: Bump `version.json` first and watch the guards fail**

Set `version.json` to `"version": "0.84.0"`.
Run: `npx vitest run --root apps/app versionMirrors releases`
Expected: FAIL - every mirror disagrees with `version.json`, and `RECENT[0].version` is `0.83.0`.

- [ ] **Step 2: Bump the mirrors by hand**

Change `"version": "0.83.0"` to `"0.84.0"` in `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json` (line 4 of each). In `package-lock.json` change exactly five entries: the top-level `version` (line 3), `packages[""]` (line ~9), `packages["apps/app"]` (line ~26), `packages["apps/desktop"]` (line ~109), `packages["packages/domain"]` (line ~10479). Match each by the workspace `name` directly above it; do not find-and-replace across the file. Confirm: `git diff package-lock.json | grep -c '^+.*"version": "0.84.0"'` prints `5`.

- [ ] **Step 3: Find the PR number**

Run: `gh pr list --state all --limit 1 --json number` and `gh issue list --state all --limit 1 --json number`. The PR number is the larger of the two plus one (issues and PRs share a sequence). Write it into the entry below as `pr`, and confirm it against what `gh pr create` reports in Step 10.

- [ ] **Step 4: Release notes**

Add at the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`:

```ts
  {
    version: "0.84.0",
    date: "2026-09-17",
    pr: 176,
    headline: "See an Obsidian vault as a graph of its notes, links and tags",
    summary:
      "Clicking an Obsidian vault's row in the folder browser now opens a graph of the vault in a tab: every note as a node, every link between notes as a line, with pictures and other attachments, tags and links to notes that do not exist yet available from chips above the graph. Search highlights matching notes and Enter centres on the best one. Click a node to see what it links to, double-click a note to open it, and double-click a link to a missing note to create that note where Obsidian would put it. A Local graph pane under the folder browser follows the note you are editing and shows its neighbours, one to three links away, and folds away to its header. The graph is built when a vault opens and when you press refresh, keeps itself up to date as you save, create and rename notes in Trypthos, and shows its progress while a large vault is read. Changes made in Obsidian while Trypthos is open appear after a refresh. Vaults opened from GitHub do not have a graph yet.",
    added: [
      "A graph of an Obsidian vault, opened by clicking the vault's row, with chips for notes, attachments, tags, unresolved links and orphans, and a search box.",
      "A Local graph pane under the folder browser, following the open note, with a depth of one to three links.",
      "Double-click a link to a missing note in either graph to create it in Obsidian's default location for new notes.",
      "Indexing progress for large vaults, and a refresh button to rebuild the graph.",
    ],
  },
```

(Use the number from Step 3 for `pr`.)

- [ ] **Step 5: About box and disclaimers**

In `apps/app/src/lib/appInfo.ts`, add a row to `CAPABILITIES` after the `Markdown editor` row:

```
| Vault graph | Click an Obsidian vault's row to see its notes, links, attachments and tags as a graph. Search it, filter it, double-click a note to open it or a missing note to create it. A local graph under the folder browser follows the note you are editing. Built when the vault opens and kept current as you save in Trypthos. |
```

Add to `DISCLAIMERS`:

```ts
  "The vault graph is drawn with Sigma.js and laid out with graphology's ForceAtlas2, loaded only when a graph is shown.",
```

- [ ] **Step 6: README and features**

`README.md` Features table, after the `Links` row:

```
| Vault graph | Click an Obsidian vault's row to open a graph of its notes and links, with attachments, tags, unresolved links and orphans behind chips, and a search box. Double-click a note to open it, or a link to a missing note to create it where Obsidian would. A Local graph pane under the folder browser follows the open note. The graph is built when the vault opens, updates as you save, create and rename in Trypthos, and rebuilds on refresh with progress for large vaults. Local vaults only for now. |
```

`docs/features.md`, a new section immediately before `## File types`:

```markdown
## Vault graph

**An Obsidian vault is a graph as well as a tree.** Click a vault's row in the folder browser and a
Graph tab opens beside your documents. Every note is a node, sized by how many links it has, and
every link between two notes is a line with an arrow for its direction - both ends when the notes
link to each other.

**Chips choose what is drawn.** Notes, Attachments (pictures, PDFs and other files a note links or
embeds), Tags (a node per tag, joined to every note carrying it), Unresolved (links to notes that do
not exist yet) and Orphans (notes that link to nothing and that nothing links to). Attachments and
Tags start off. The choices are remembered.

**Find a note by name.** The search box under the chips highlights every matching node and dims the
rest; Enter centres the graph on the best match.

**Click to look, double-click to go.** Hovering or clicking a node highlights it and its neighbours.
Double-click a note or an attachment to open it. Double-click an unresolved link to create the note
it names: the New File dialog opens with the name filled in, in the folder Obsidian's own "Default
location for new notes" setting chooses. Drag a node to move it; the arrangement settles the same
way each time the graph opens. Arrow keys move between neighbours and Enter opens.

**The Local graph follows your note.** A pane under the folder browser, shown while a vault is open,
draws the note you are editing and the notes linked to it, one, two or three links away. It folds
down to its header when you want the room back.

**Built when the vault opens, kept current as you work.** Trypthos reads the vault when it opens and
when you press the graph's refresh button, showing progress for a large vault, and updates the graph
when you save, create or rename notes in Trypthos. Changes made in Obsidian while Trypthos is open
appear after a refresh. The status line says how many notes and links there are and how old the
graph is. Nothing is written to the vault and nothing is stored: note contents never leave the part
of the app that reads them. Vaults opened from GitHub do not have a graph yet.
```

- [ ] **Step 7: Architecture**

In `docs/Architecture.md`:

1. In "The IPC surface", add after the Obsidian group: `the vault graph (\`graph:snapshot\`, \`graph:refresh\`),` and replace "Three channels flow the other way, all validated on arrival like everything else: `window:state`, `chat:event` for streamed reply tokens and each request's trace, and `menu:action`." with "Five channels flow the other way, all validated on arrival like everything else: `window:state`, `chat:event` for streamed reply tokens and each request's trace, `menu:action`, and the vault graph's `graph:progress` and `graph:changed`, which go to every window."
2. In "Window chrome", replace "`window:state` is the only channel flowing main to renderer," with "`window:state` flows main to renderer,".
3. Add a new section before `## Two test suites`:

```markdown
## The vault graph

**Indexed in the main process, drawn in the renderer.** `apps/desktop/src/vaultIndex.js` keeps one
index per open local Obsidian vault. It starts after a successful `workspace:open`,
`workspace:openRef` or `obsidian:openVault` whose workspace is a local vault - which covers restoring
at launch - and is dropped on `workspace:close`. It walks the vault breadth first through the
workspace's **provider** (so the boundary guard applies), skips dot-folders, reads notes 32 at a time
with a turn of the event loop between batches, and reads `.obsidian/app.json` for where new notes go.

**Pure domain underneath.** `vaultLinks.ts` extracts a note's wiki links, embeds, markdown links,
front matter links and tags, ignoring code and `%%` comments. `vaultGraph.ts` resolves them with the
same `pickWikiTarget` the editor follows links with - through a name map, so resolution is not
O(links x files) - and builds sorted nodes (`note`, `attachment`, `ghost`, `tag`) and edges. The
shell keeps the index **input** (files and each note's references) and rebuilds the graph from it
after `applyIndexChange`, rather than patching a graph in place.

**Kept current by the write handlers.** `file:write`, `file:saveAs` and `workspace:rename` tell the
index after a write that landed; a write during a build is queued, and a folder rename rebuilds.
Nothing watches the disk, so edits made outside Trypthos appear after `graph:refresh`.

**The contract.** `graph:snapshot { workspaceId }` answers `GraphState`: the last finished snapshot,
the build in progress, and the last error. `graph:refresh` starts a rebuild and is refused while one
runs. `graph:progress` and `graph:changed` are pushed through a `broadcast` dependency to every
window. Only a workspace id crosses; snapshots hold names, qualified paths and id pairs, never note
contents, and are zod-validated on both sides (`ipc.ts`).

**Drawing.** `useVaultGraph` follows one vault's state and shows progress only after 300 ms.
`graphLayout.ts` seeds a circle in node order and runs ForceAtlas2 for a fixed number of iterations,
so the same vault gets the same shape; it runs in an inline (blob) worker, because a module worker
from `file://` is refused in the packaged app. `GraphCanvas.tsx` wraps Sigma: icon discs from
`@sigma/node-image` over circles, colours read from the theme tokens and re-read on a theme change,
hover and selection in a ref read by Sigma's reducers. `GraphPage` is the `trypthos:graph/<id>` tab
(a reserved path like the repository page); `LocalGraphPane` sits under the workspace trees and
lazy-loads `LocalGraph`. Filters, search and settings (`settings.graph`, version 21) are shared.

**Bundle boundary.** Sigma, graphology and the layout worker are imported only by `GraphPage`,
`LocalGraph`, `GraphCanvas`, `graphLayout`, `graphLayout.worker` and `layoutClient`, which are
reached through `lazy()`; `graphBundle.test.ts` asserts it.
```

- [ ] **Step 8: Run the guards and the whole pipeline**

Run, in order, from the repo root:

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:browser
```

Expected: every command clean, no warnings or errors printed by any test. If anything fails, fix it in the task it belongs to (not by weakening a test) and commit that fix separately.

- [ ] **Step 9: See it working in the app**

Create an invented vault in the scratch directory - never a real one: a folder with an empty `.obsidian/` directory, `.obsidian/app.json` containing `{"newFileLocation":"folder","newFileFolderPath":"Inbox"}`, and notes `Home.md` (`[[Plan]] [[Risks]] #inbox ![[diagram.png]]`), `Projects/Plan.md` (`[[Home]]`), `Lonely.md` (empty), plus any small `diagram.png`. Start the app with the dev server and Electron (`npm run dev --workspace trypthos-app` and `npm run dev --workspace trypthos-desktop`, or the project's run skill), open the folder, and check:

1. Clicking the vault row opens the graph tab; Home, Plan, Lonely and a Risks ghost appear; the status line reads `3 notes - 3 links - indexed just now` (Home-Plan is one two-way edge, plus Home-Risks and Home-diagram.png; tag edges are not counted).
2. Attachments and Tags chips show `diagram.png` and `#inbox`; Orphans off hides Lonely.
3. Double-click Plan opens it; double-click Risks opens New File named `Risks`, and creating it makes `Inbox/Risks.md` and turns the ghost into a note.
4. With `Home.md` active, the Local graph pane shows Home and its neighbours; depth 2 and collapse work and survive a restart.
5. Switch theme light/dark: the canvas repaints.
6. Edit `Home.md` in Trypthos to add `[[New idea]]`, save: a New idea ghost appears without a refresh.

Take a screenshot of the graph tab and the local pane for the PR.

- [ ] **Step 10: Commit, push and open the PR**

```bash
git add version.json package.json apps/app/package.json apps/desktop/package.json packages/domain/package.json package-lock.json apps/app/src/lib/releaseNotes/current.ts apps/app/src/lib/appInfo.ts README.md docs/features.md docs/Architecture.md
git commit -m "Release 0.84.0: the vault graph"
git push -u origin spec/vault-graph
gh pr create --title "See an Obsidian vault as a graph of its notes, links and tags" --body-file <scratch file>
```

The PR body (written to a scratch file, then passed with `--body-file`):

```markdown
## Summary
- A global graph of a local Obsidian vault in a tab, opened from the vault's row: notes, attachments, tags, unresolved links and orphans behind chips, search, double-click to open or create.
- A Local graph pane under the folder browser that follows the active note, depth 1-3, collapsible.
- A main-process index (`vaultIndex.js`) built through the workspace provider, with batched reads, progress, and updates on the app's own writes; new IPC `graph:snapshot`, `graph:refresh`, `graph:progress`, `graph:changed`.
- Deterministic ForceAtlas2 layout in an inline worker; Sigma.js canvas kept out of the initial bundle.
- Spec: `docs/specs/vault-graph.md`; plan: `docs/specs/vault-graph-plan.md`.

## Dependencies
sigma, graphology, graphology-types, graphology-layout, graphology-layout-forceatlas2, @sigma/node-image (all MIT). Disclaimer added to the About box.

## Test plan
- [ ] `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser` green locally
- [ ] CI green
- [ ] Manual check against an invented vault (screenshots below)

## Deployment surface
Needs a release (new installer).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

After `gh pr create` prints the URL, check its number against `RECENT[0].pr`; if they differ, correct `current.ts`, commit and push.
