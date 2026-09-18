# Workspace Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace one home page - heading, counts, README, graph - and extend the graph from Obsidian vaults to every local folder, with ignore rules so an ordinary project folder does not index its dependencies.

**Architecture:** One reserved path, `trypthos:home/<workspaceId>`, replaces the graph and repository page paths. The index gate drops its vault test and gains a deny-list floor plus the folder's own `.gitignore`, applied in the main process with the `ignore` package, and a 5,000-note cap reported in the snapshot. A new `WorkspaceHome` component composes a fixed heading with one control switching between a Graph section and a Readme section, each given the whole remaining height.

**Tech Stack:** TypeScript, React 19, zod, Tailwind v4, Electron CommonJS main process, `ignore` (MIT), vitest (jsdom + Playwright Chromium), node:test.

**Spec:** `docs/specs/workspace-home-page.md`

## Global Constraints

- **TDD is required.** The failing test first, watched failing, then the minimal code.
- **Test output must be pristine.** No errors or warnings printed by a passing run.
- **The renderer is untrusted.** Every IPC payload is validated in the main process; the renderer never names a path outside a workspace.
- **Every path is validated against the workspace root** in the one shared guard module. The index reads only through the provider.
- **Never put real user data anywhere** - invent fixtures (`Ada`, `Grace`, `Alice`, `Notes`).
- **No em or en dashes in user-facing text.** A plain hyphen. Code, comments and internal docs are exempt.
- **Every colour resolves through a token.**
- **Use the editor tools, not shell heredocs,** for anything with regex escapes or Windows paths. Several files are stored with **mixed line endings**; after editing, run `remix.py` from the scratchpad on every touched file and check `git diff --stat` shows a change proportional to the edit.
- **Graph libraries stay lazy.** Nothing eager may import `GraphPage`, `GraphCanvas`, sigma or graphology - `graphBundle.test.ts` holds this.
- **`ignore` stays out of the renderer.** It is a main-process dependency of `apps/desktop` only.
- **Version 0.86.0** - a functional enhancement. `version.json`, four manifests, exactly five lock entries.

---

## Decisions this plan takes that the spec leaves open

| Decision | Why |
|---|---|
| The ignore rules live in `apps/desktop/src/folderIgnore.js`, not the domain package | They are used only by the main-process walk, and the domain is also compiled into the renderer. Keeping `ignore` out of the domain keeps it out of the renderer bundle without relying on tree-shaking |
| `GraphPage` stops subscribing to the index and takes the subscription as a prop | The home page needs the same snapshot to decide whether a Graph section exists. Two subscriptions to one workspace was already flagged as debt at the end of the graph work; lifting it closes that |
| The README fetch leaves `useRepoPage` for a new `useReadme` | It is not GitHub-specific, and today it runs only when a GitHub bridge exists |
| `readmeNameIn` moves from `repoPage.ts` to `homePage.ts` | `repoPage.ts` is deleted, and README discovery belongs to the page that shows it |
| `GraphSnapshot` gains `truncated: boolean`, required | The main process always knows; a required field makes a fixture that forgets it a type error rather than a silent `undefined` |

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `packages/domain/src/homePage.ts` | The reserved path, its parts, and README discovery |
| `packages/domain/src/homePage.test.ts` | Its tests |
| `apps/desktop/src/folderIgnore.js` | The deny-list floor and the `.gitignore` rules, as one predicate pair |
| `apps/desktop/test/folderIgnore.test.js` | Its tests |
| `apps/app/src/lib/homeSections.ts` | Which sections a home page has, and which it opens on |
| `apps/app/src/lib/homeSections.test.ts` | Its tests |
| `apps/app/src/hooks/useReadme.ts` | A workspace's root README, fetched once per workspace per session |
| `apps/app/src/hooks/useReadme.test.ts` | Its tests |
| `apps/app/src/components/RepoHeading.tsx` | The GitHub heading, extracted from `RepoPage` unchanged |
| `apps/app/src/components/WorkspaceHome.tsx` | The page |
| `apps/app/src/components/WorkspaceHome.test.tsx` | Its tests |
| `apps/app/src/components/WorkspaceHome.browser.test.tsx` | The fixed heading and the full-height section, measured |

**Delete**

`packages/domain/src/graphPage.ts`, `graphPage.test.ts`, `repoPage.ts`, `repoPage.test.ts`, `apps/app/src/components/RepoPage.tsx`, `RepoPage.test.tsx`.

**Modify**

| File | Change |
|---|---|
| `packages/domain/src/index.ts` | Swap the graph and repo page exports for the home page's |
| `packages/domain/src/ipc.ts` | `truncated` on `GraphSnapshotSchema` |
| `apps/desktop/src/vaultIndex.js` | The gate, the ignore rules in the walk, the cap |
| `apps/desktop/package.json`, `package-lock.json` | `ignore` |
| `apps/app/src/hooks/useRepoPage.ts` | Loses the README |
| `apps/app/src/hooks/useWorkspace.ts` | `openHomePage` replaces `openRepoPage` and `openGraphPage` |
| `apps/app/src/components/GraphPage.tsx` | Takes `graph: VaultGraphView`; `vaultName` becomes `workspaceName` |
| `apps/app/src/components/WorkspacePanel.tsx` | One `onOpenHomePage` prop replaces two |
| `apps/app/src/App.tsx` | Routing to the home page, `anyLocalWorkspaceOpen`, the tab title |
| `apps/app/src/lib/graphStatus.ts` | `attachmentCount` |
| `apps/app/src/components/EditorTabs.tsx` | A home page's tab takes its workspace's name |
| `apps/app/src/locales/en.json` | New `home.*` keys; `graph.empty`, `repo.noReadme` reworded or moved |
| Every test that builds a `GraphSnapshot` | The new `truncated` field |
| Release files | as in Task 12 |

---

## Task 1: The home page's path

**Files:**
- Create: `packages/domain/src/homePage.ts`, `packages/domain/src/homePage.test.ts`
- Delete: `packages/domain/src/graphPage.ts`, `graphPage.test.ts`, `repoPage.ts`, `repoPage.test.ts`
- Modify: `packages/domain/src/index.ts`, and every importer the typechecker names

**Interfaces:**
- Produces: `HOME_PAGE_PREFIX = "trypthos:home/"`, `homePagePath(workspaceId: string): string`, `homePageWorkspaceId(path: string): string | null`, `isHomePagePath(path: string): boolean`, `readmeNameIn(entries): string | null` (moved unchanged)

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/homePage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOME_PAGE_PREFIX, homePagePath, homePageWorkspaceId, isHomePagePath, readmeNameIn } from "./homePage";
import { splitQualified } from "./qualifiedPath";

/// A workspace's home page is a document identity like the markdown guide - a tab, never a file.
/// The `trypthos:` prefix is what keeps it away from every provider.

describe("a home page's path", () => {
  it("names the workspace it belongs to", () => {
    expect(homePagePath("Notes")).toBe("trypthos:home/Notes");
    expect(homePageWorkspaceId("trypthos:home/Notes")).toBe("Notes");
    expect(isHomePagePath("trypthos:home/Notes")).toBe(true);
  });

  it("is not any other path", () => {
    expect(homePageWorkspaceId("Notes/README.md")).toBe(null);
    expect(homePageWorkspaceId("trypthos:home/")).toBe(null);
    expect(homePageWorkspaceId("trypthos:markdown-guide")).toBe(null);
    expect(isHomePagePath("trypthos:graph/Notes")).toBe(false);
    expect(isHomePagePath("trypthos:repo/Notes")).toBe(false);
  });

  // The property that keeps a page out of every provider: a qualified-path reader refuses it.
  it("is refused as a path into a workspace", () => {
    expect(HOME_PAGE_PREFIX.startsWith("trypthos:")).toBe(true);
    expect(splitQualified(homePagePath("Notes"))).toBe(null);
  });
});

describe("finding a workspace's README", () => {
  const file = (name: string) => ({ name, kind: "file" as const });

  it("finds one whatever its case and extension", () => {
    expect(readmeNameIn([file("readme.md")])).toBe("readme.md");
    expect(readmeNameIn([file("README")])).toBe("README");
    expect(readmeNameIn([file("ReadMe.markdown")])).toBe("ReadMe.markdown");
  });

  it("prefers the shortest name when there are several", () => {
    expect(readmeNameIn([file("README.markdown"), file("README.md")])).toBe("README.md");
  });

  it("ignores a folder called README, and anything else", () => {
    expect(readmeNameIn([{ name: "README", kind: "directory" }, file("notes.md")])).toBe(null);
  });
});
```

The README cases are the ones `repoPage.test.ts` already holds - move them rather than rewrite them, and keep whatever extra cases that file has.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root packages/domain homePage`
Expected: FAIL - cannot resolve `./homePage`.

- [ ] **Step 3: Create the module**

Create `packages/domain/src/homePage.ts`. Move `README_EXTENSIONS`, `isReadmeName` and `readmeNameIn` from `repoPage.ts` verbatim, and add:

```ts
/// A workspace's home page: its heading, its counts, its README and its graph, in one tab.
///
/// A document identity like the markdown guide, never a file. It replaced two earlier pages - the
/// repository page and the vault graph - which each had a prefix of their own. Open documents are not
/// persisted between runs, so nothing had to migrate: those prefixes are simply gone.
///
/// `splitQualified` refuses the whole `trypthos:` prefix, which is what keeps this path away from
/// every provider however it arrives.

export const HOME_PAGE_PREFIX = "trypthos:home/";

export function homePagePath(workspaceId: string): string {
  return `${HOME_PAGE_PREFIX}${workspaceId}`;
}

export function homePageWorkspaceId(path: string): string | null {
  if (!path.startsWith(HOME_PAGE_PREFIX)) return null;
  const id = path.slice(HOME_PAGE_PREFIX.length);
  return id === "" ? null : id;
}

export function isHomePagePath(path: string): boolean {
  return homePageWorkspaceId(path) !== null;
}
```

- [ ] **Step 4: Swap the exports and delete the old modules**

In `packages/domain/src/index.ts`, replace the `./repoPage` and `./graphPage` export lines with:

```ts
export { HOME_PAGE_PREFIX, homePagePath, homePageWorkspaceId, isHomePagePath, readmeNameIn } from "./homePage";
```

Delete `graphPage.ts`, `graphPage.test.ts`, `repoPage.ts`, `repoPage.test.ts`.

- [ ] **Step 5: Run the domain suite**

Run: `npx vitest run --root packages/domain`
Expected: PASS. `npm run typecheck` will now fail in the renderer, naming `useWorkspace.ts`, `useRepoPage.ts` and `App.tsx` - those are fixed in Tasks 5 and 9. Do not patch them here.

- [ ] **Step 6: Commit**

```bash
git add -A packages/domain/src
git commit -m "One reserved path for a workspace's home page"
```

---

## Task 2: What a folder's graph skips

**Files:**
- Create: `apps/desktop/src/folderIgnore.js`, `apps/desktop/test/folderIgnore.test.js`
- Modify: `apps/desktop/package.json`, `package-lock.json`

**Interfaces:**
- Produces: `DENIED_DIRECTORIES: ReadonlySet<string>` (lower-cased), `createIgnoreRules(gitignoreText: string | null): { skipsDirectory(path: string): boolean; skipsFile(path: string): boolean }`. Paths are workspace-relative and forward-slashed, with no leading slash.

- [ ] **Step 1: Add the dependency**

```bash
npm install --save-exact --workspace trypthos-desktop ignore@7.0.9
```

Check `git diff package-lock.json` adds only `ignore` and its entry under `apps/desktop`. A loose install must not churn anything else.

- [ ] **Step 2: Write the failing test**

Create `apps/desktop/test/folderIgnore.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createIgnoreRules, DENIED_DIRECTORIES } = require("../src/folderIgnore");

/// What a folder's graph leaves out.
///
/// A vault is curated; an arbitrary folder is not. Measured on this repository, 11 markdown files
/// sit outside node_modules and 1,117 inside it, so without these rules a folder's graph is a graph
/// of dependency READMEs.

test("skips the build and dependency folders wherever they sit", () => {
  const rules = createIgnoreRules(null);
  for (const path of ["node_modules", "packages/app/node_modules", "dist", "a/b/build", "target", "vendor", "__pycache__"]) {
    assert.equal(rules.skipsDirectory(path), true, path);
  }
});

test("matches a whole directory name, never a substring", () => {
  const rules = createIgnoreRules(null);
  assert.equal(rules.skipsDirectory("builds"), false);
  assert.equal(rules.skipsDirectory("my_node_modules_notes"), false);
  assert.equal(rules.skipsDirectory("distribution"), false);
});

// A Windows disk does not care about case, and a rule that did would miss the folder only for some
// people - the kind of failure nobody reproduces.
test("ignores case in the directory list", () => {
  const rules = createIgnoreRules(null);
  assert.equal(rules.skipsDirectory("Node_Modules"), true);
  assert.equal(rules.skipsDirectory("docs/BUILD"), true);
});

test("applies the folder's own .gitignore", () => {
  const rules = createIgnoreRules("drafts/\n*.tmp.md\n!keep.tmp.md\n");
  assert.equal(rules.skipsDirectory("drafts"), true);
  assert.equal(rules.skipsFile("notes/scratch.tmp.md"), true);
  assert.equal(rules.skipsFile("notes/keep.tmp.md"), false);
  assert.equal(rules.skipsFile("notes/plan.md"), false);
});

// `ignore` only matches a directory-only pattern when the path it is asked about ends in a slash.
// Asking about `drafts` rather than `drafts/` answers false, and the whole folder is walked.
test("asks about a directory as a directory", () => {
  const rules = createIgnoreRules("drafts/\n");
  assert.equal(rules.skipsDirectory("drafts"), true);
  assert.equal(rules.skipsDirectory("a/drafts"), true);
});

// The floor is beneath the .gitignore, not beside it. A .gitignore that does not mention
// node_modules - a nested package, a repository that vendors its dependencies - must not let the
// whole problem back in.
test("keeps the floor when the .gitignore does not mention it", () => {
  const rules = createIgnoreRules("*.log\n");
  assert.equal(rules.skipsDirectory("node_modules"), true);
});

test("falls back to the floor alone for a .gitignore it cannot use", () => {
  const rules = createIgnoreRules("\u0000\u0000 not a real pattern [[[");
  assert.equal(rules.skipsDirectory("node_modules"), true);
  assert.equal(rules.skipsFile("notes/plan.md"), false);
});

test("never throws on a path the ignore package would refuse", () => {
  const rules = createIgnoreRules("*.md\n");
  assert.equal(rules.skipsFile(""), false);
  assert.equal(rules.skipsFile("/absolute.md"), false);
});

test("lists the floor in lower case, so lookups can be too", () => {
  for (const name of DENIED_DIRECTORIES) assert.equal(name, name.toLowerCase());
  assert.ok(DENIED_DIRECTORIES.has("node_modules"));
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test apps/desktop/test/folderIgnore.test.js`
Expected: FAIL - cannot find module `../src/folderIgnore`.

- [ ] **Step 4: Write the module**

Create `apps/desktop/src/folderIgnore.js`:

```js
"use strict";

const ignore = require("ignore");

/// What a folder's graph leaves out.
///
/// A vault is a folder somebody curates. An arbitrary folder is not: a project checkout holds its
/// dependencies and its build output, and on this repository that is a hundred times more markdown
/// than the project itself. Two rules, applied together rather than as alternatives.
///
/// **A floor**, always: directory names that are never a person's own writing.
///
/// **The folder's own `.gitignore`**, when it has one - exactly the set a developer already curates.
/// Parsed with the `ignore` package rather than by hand: gitignore has negation, anchoring and
/// directory-only patterns, and a hand-rolled reading of those is a source of wrong answers nobody
/// would think to test.
///
/// The floor sits BENEATH the `.gitignore`. A `.gitignore` in a nested package, or in a repository
/// that vendors its dependencies, may never mention `node_modules`, and treating the two as
/// alternatives would let the whole problem back in. The cost - a `!` rule reaching into a denied
/// directory is ignored - is recorded in the spec.

const DENIED_DIRECTORIES = new Set(
  [
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    "vendor",
    "coverage",
    "venv",
    ".venv",
    "__pycache__",
    "bin",
    "obj",
    "Pods",
    "DerivedData",
  ].map((name) => name.toLowerCase()),
);

/// `ignore` refuses an empty path and one with a leading slash, by throwing. A walk must never
/// stop because of what one entry is called, so those are simply not skipped.
function askable(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/");
}

function lastSegment(path) {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

function createIgnoreRules(gitignoreText) {
  let matcher = null;
  if (typeof gitignoreText === "string" && gitignoreText.trim() !== "") {
    try {
      matcher = ignore().add(gitignoreText);
    } catch {
      // A .gitignore this package cannot read leaves the floor on its own. There is nothing to say
      // to the user about it: the graph is still built, just with less excluded.
      matcher = null;
    }
  }

  const gitignores = (path) => {
    if (matcher === null || !askable(path)) return false;
    try {
      return matcher.ignores(path);
    } catch {
      return false;
    }
  };

  return {
    /// `ignore` matches a directory-only pattern such as `drafts/` only when asked about `drafts/`,
    /// so a directory is always asked about with its trailing slash.
    skipsDirectory(path) {
      if (DENIED_DIRECTORIES.has(lastSegment(path).toLowerCase())) return true;
      return gitignores(`${path}/`);
    },
    skipsFile(path) {
      return gitignores(path);
    },
  };
}

module.exports = { createIgnoreRules, DENIED_DIRECTORIES };
```

- [ ] **Step 5: Run the tests**

Run: `node --test apps/desktop/test/folderIgnore.test.js`
Expected: PASS, every case.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/folderIgnore.js apps/desktop/test/folderIgnore.test.js apps/desktop/package.json package-lock.json
git commit -m "Decide what a folder's graph leaves out"
```

---

## Task 3: Indexing every local folder

**Files:**
- Modify: `apps/desktop/src/vaultIndex.js`, `packages/domain/src/ipc.ts`
- Test: `apps/desktop/test/vaultIndex.test.js`, `apps/desktop/test/graphIpc.test.js`, and every fixture that builds a `GraphSnapshot`

**Interfaces:**
- Consumes: `createIgnoreRules` (Task 2)
- Produces: `NOTE_LIMIT = 5000` exported from `vaultIndex.js`; `truncated: boolean` on every snapshot

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/test/vaultIndex.test.js`, using that file's existing helpers for a fake provider and a workspace record - the assertions are the contract:

```js
test("indexes a local folder that is not a vault", async () => {
  const { indexes, workspace } = harness({
    vault: false,
    files: { "Home.md": "[[Plan]]", "Plan.md": "" },
  });
  indexes.start(workspace);
  await indexes.idle(workspace.id);
  const { snapshot } = indexes.state(workspace.id);
  assert.equal(snapshot.edges.length, 1);
});

test("still refuses a repository", async () => {
  const { indexes, workspace } = harness({ kind: "github", vault: true, files: { "Home.md": "[[Plan]]" } });
  assert.equal(indexes.isIndexable(workspace), false);
});

test("skips node_modules with no .gitignore to say so", async () => {
  const { indexes, workspace } = harness({
    vault: false,
    files: { "Home.md": "", "node_modules/pkg/README.md": "", "a/node_modules/b/README.md": "" },
  });
  indexes.start(workspace);
  await indexes.idle(workspace.id);
  const ids = indexes.state(workspace.id).snapshot.nodes.map((node) => node.id);
  assert.deepEqual(ids.filter((id) => id.includes("node_modules")), []);
});

test("applies the folder's .gitignore", async () => {
  const { indexes, workspace } = harness({
    vault: false,
    files: { ".gitignore": "drafts/\n", "Home.md": "", "drafts/Idea.md": "" },
  });
  indexes.start(workspace);
  await indexes.idle(workspace.id);
  const ids = indexes.state(workspace.id).snapshot.nodes.map((node) => node.id);
  assert.deepEqual(ids.filter((id) => id.includes("drafts")), []);
});

test("stops at the limit, and says it stopped", async () => {
  const files = {};
  for (let index = 0; index <= NOTE_LIMIT; index += 1) files[`n${index}.md`] = "";
  const { indexes, workspace } = harness({ vault: false, files });
  indexes.start(workspace);
  await indexes.idle(workspace.id);
  const { snapshot } = indexes.state(workspace.id);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.nodes.filter((node) => node.kind === "note").length, NOTE_LIMIT);
});

test("does not claim to be incomplete when it is not", async () => {
  const { indexes, workspace } = harness({ vault: true, files: { "Home.md": "" } });
  indexes.start(workspace);
  await indexes.idle(workspace.id);
  assert.equal(indexes.state(workspace.id).snapshot.truncated, false);
});
```

If `harness` does not already take `vault`, `kind` and `files`, extend it rather than writing a second one. The limit case builds 5,001 empty files in a fake provider, which is fast; if it is not, give `createVaultIndexes` a `noteLimit` option defaulting to `NOTE_LIMIT` and pass a small one here instead - the behaviour under test is the stopping, not the number.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test apps/desktop/test/vaultIndex.test.js`
Expected: FAIL - a non-vault folder is not indexed, `node_modules` is walked, `truncated` is undefined.

- [ ] **Step 3: Change the gate**

In `apps/desktop/src/vaultIndex.js`:

```js
  /// Every local folder, not only an Obsidian vault. What made this safe to widen is
  /// `folderIgnore.js`: a vault is curated, an arbitrary folder is not, and without those rules a
  /// project checkout indexes its dependencies. A repository still waits - one request per note meets
  /// GitHub's rate limit, and that is its own piece of work.
  const isIndexable = (workspace) => workspace.ref?.kind === "local" && typeof workspace.root === "string";
```

- [ ] **Step 4: Apply the rules and the cap in the walk**

Before the walk, read the root `.gitignore` through the provider and build the rules:

```js
    const gitignore = await settled(() => provider.read(".gitignore"));
    if (!alive()) return;
    const rules = createIgnoreRules(gitignore.ok ? gitignore.content : null);
```

In the loop over `sortNodes(listed.nodes)`, replace the two pushes:

```js
        for (const node of sortNodes(listed.nodes)) {
          if (isHidden(node.name)) continue;
          if (node.kind === "directory") {
            if (!rules.skipsDirectory(node.id)) next.push(node.id);
          } else if (!rules.skipsFile(node.id)) {
            files.push(node.id);
          }
        }
```

After the walk, cap the notes and record whether it happened:

```js
    const found = files.filter(isNotePath);
    const truncated = found.length > NOTE_LIMIT;
    const notes = truncated ? found.slice(0, NOTE_LIMIT) : found;
    entry.truncated = truncated;
```

and drop the capped-away notes from `files` too, so the graph does not draw a node for a note it never read:

```js
    const kept = new Set(notes);
    const drawn = files.filter((file) => !isNotePath(file) || kept.has(file));
```

using `drawn` where the build input takes `files`. Add `truncated: entry.truncated === true` to the object `publish` builds, add `const NOTE_LIMIT = 5000;` near `READ_BATCH` with a comment saying the cap exists because a folder a user picked may be a whole drive, and export it. Require `createIgnoreRules` from `./folderIgnore`.

- [ ] **Step 5: Carry `truncated` across the boundary**

In `packages/domain/src/ipc.ts`, add to `GraphSnapshotSchema`, after `unreadable`:

```ts
    /// True when the walk stopped at its limit, so the graph is not the whole folder and has to say so.
    truncated: z.boolean(),
```

Then run `npm run typecheck` and add `truncated: false` to every `GraphSnapshot` fixture it names - `fakeGraphClient.tsx` and the graph tests. Do not make the field optional to avoid this: a fixture that forgets it should be a type error.

- [ ] **Step 6: Run everything the change touches**

Run: `npm run build --workspace @trypthos/domain`, then `node --test apps/desktop/test/vaultIndex.test.js apps/desktop/test/graphIpc.test.js`, then `npx vitest run --root packages/domain ipc`.
Expected: PASS throughout.

- [ ] **Step 7: Commit**

```bash
git add -A apps/desktop packages/domain apps/app/src/testing apps/app/src/components
git commit -m "Index every local folder, skipping what is not its own writing"
```

---

## Task 4: Which sections a home page has

**Files:**
- Create: `apps/app/src/lib/homeSections.ts`, `homeSections.test.ts`
- Modify: `apps/app/src/lib/graphStatus.ts`, `graphStatus.test.ts`

**Interfaces:**
- Produces: `type HomeSection = "graph" | "readme"`, `homeSections(input: { edges: number; hasReadme: boolean }): HomeSection[]`, `openingSection(sections: readonly HomeSection[]): HomeSection | null`, `attachmentCount(graph: VaultGraph): number`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/homeSections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { homeSections, openingSection } from "./homeSections";

/// A section exists only when it has something in it. A graph with no edges is a field of dots, which
/// is worse than no graph, and a README section with no README is a heading over nothing.

describe("a home page's sections", () => {
  it("has a graph only when something links to something", () => {
    expect(homeSections({ edges: 0, hasReadme: false })).toEqual([]);
    expect(homeSections({ edges: 1, hasReadme: false })).toEqual(["graph"]);
  });

  it("has a readme only when there is one", () => {
    expect(homeSections({ edges: 0, hasReadme: true })).toEqual(["readme"]);
  });

  it("lists the graph first when there are both", () => {
    expect(homeSections({ edges: 3, hasReadme: true })).toEqual(["graph", "readme"]);
  });
});

describe("which section a page opens on", () => {
  it("opens on the graph when there is one", () => {
    expect(openingSection(["graph", "readme"])).toBe("graph");
  });

  it("opens on the readme otherwise", () => {
    expect(openingSection(["readme"])).toBe("readme");
  });

  it("opens on nothing when there is nothing", () => {
    expect(openingSection([])).toBe(null);
  });
});
```

Add to `graphStatus.test.ts`:

```ts
it("counts attachments, and nothing else", () => {
  const graph = {
    nodes: [
      { id: "V/a.md", kind: "note" as const, label: "a", path: "V/a.md", degree: 0 },
      { id: "V/b.png", kind: "attachment" as const, label: "b.png", path: "V/b.png", degree: 0 },
      { id: "ghost:c", kind: "ghost" as const, label: "c", path: null, degree: 0 },
    ],
    edges: [],
  };
  expect(attachmentCount(graph)).toBe(1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run --root apps/app homeSections graphStatus`
Expected: FAIL - cannot resolve `./homeSections`; `attachmentCount` is not exported.

- [ ] **Step 3: Write them**

Create `apps/app/src/lib/homeSections.ts`:

```ts
/// Which parts of a workspace's home page exist, and which one it opens on.
///
/// A section exists only when it has something in it. A graph with no edges is a field of
/// unconnected dots - worse than no graph, and the reason a folder whose files never link to each
/// other shows no Graph control at all. A GitHub workspace has no index yet, so it has no edges and
/// no Graph section, which falls out of this rule rather than needing a case of its own.
///
/// The page opens on the graph when there is one. Not remembered between openings: the section a
/// user wants follows from the workspace they just clicked, not from a setting.

export type HomeSection = "graph" | "readme";

export function homeSections({ edges, hasReadme }: { edges: number; hasReadme: boolean }): HomeSection[] {
  const sections: HomeSection[] = [];
  if (edges > 0) sections.push("graph");
  if (hasReadme) sections.push("readme");
  return sections;
}

export function openingSection(sections: readonly HomeSection[]): HomeSection | null {
  return sections[0] ?? null;
}
```

Add to `graphStatus.ts`:

```ts
export function attachmentCount(graph: VaultGraph): number {
  return graph.nodes.filter((node) => node.kind === "attachment").length;
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run --root apps/app homeSections graphStatus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/homeSections.ts apps/app/src/lib/homeSections.test.ts apps/app/src/lib/graphStatus.ts apps/app/src/lib/graphStatus.test.ts
git commit -m "Decide which sections a workspace's home page has"
```

---

## Task 5: A README for any workspace

**Files:**
- Create: `apps/app/src/hooks/useReadme.ts`, `useReadme.test.ts`
- Modify: `apps/app/src/hooks/useRepoPage.ts`, `useRepoPage.test.ts`

**Interfaces:**
- Consumes: `readmeNameIn` (Task 1)
- Produces: `interface ReadmeState { loading: boolean; source: string | null; path: string | null; failed: boolean }`, `useReadme(workspaceId: string | null, client: ReadmeClient): ReadmeState & { invalidate(workspaceId: string): void }`, `type ReadmeClient = Pick<WorkspaceClient, "listDirectory" | "readFile">`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/hooks/useReadme.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReadme } from "./useReadme";

/// A workspace's front page, for any kind of workspace.
///
/// It used to be fetched only for a GitHub repository, inside the repository page's own hook, though
/// nothing about it was GitHub's. A local folder's README is its front page just as much.

function client(files: Record<string, string>, { listFails = false } = {}) {
  return {
    listDirectory: vi.fn(async (path: string) =>
      listFails
        ? { ok: false as const, reason: "not-found" }
        : {
            ok: true as const,
            nodes: Object.keys(files).map((name) => ({ id: `${path}/${name}`, name, kind: "file" as const })),
          },
    ),
    readFile: vi.fn(async (path: string) => {
      const name = path.slice(path.indexOf("/") + 1);
      return name in files
        ? { ok: true as const, content: files[name]!, revision: { id: "r" } }
        : { ok: false as const, reason: "not-found" };
    }),
  };
}

describe("a workspace's README", () => {
  it("reads the one at the root", async () => {
    const fake = client({ "README.md": "# Notes", "Plan.md": "" });
    const { result } = renderHook(() => useReadme("Notes", fake as never));
    await waitFor(() => expect(result.current.source).toBe("# Notes"));
    expect(result.current.path).toBe("Notes/README.md");
    expect(result.current.failed).toBe(false);
  });

  it("answers no README, not a failure, when there is none", async () => {
    const { result } = renderHook(() => useReadme("Notes", client({ "Plan.md": "" }) as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe(null);
    expect(result.current.failed).toBe(false);
  });

  it("says it failed when the listing does", async () => {
    const { result } = renderHook(() => useReadme("Notes", client({}, { listFails: true }) as never));
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("reads once per workspace, however often the page is shown", async () => {
    const fake = client({ "README.md": "# Notes" });
    const { result, rerender } = renderHook(({ id }) => useReadme(id, fake as never), { initialProps: { id: "Notes" } });
    await waitFor(() => expect(result.current.source).toBe("# Notes"));
    rerender({ id: "Notes" });
    expect(fake.readFile).toHaveBeenCalledTimes(1);
  });

  it("is idle with no workspace", () => {
    const { result } = renderHook(() => useReadme(null, client({}) as never));
    expect(result.current).toMatchObject({ loading: false, source: null, failed: false });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app useReadme`
Expected: FAIL - cannot resolve `./useReadme`.

- [ ] **Step 3: Move the fetch**

Create `apps/app/src/hooks/useReadme.ts` by moving `readReadme` out of `useRepoPage.ts` and wrapping it in the same per-workspace session cache and `live` guard `useRepoPage` uses. Its result is `{ loading, source, path, failed }`. Keep the effect's dependency list and its `live` flag exactly as `useRepoPage` has them; that shape already satisfies `react-hooks/set-state-in-effect` in this repo.

Then take `readme`, `readmeFailed` and `readmePath` out of `RepoPageState`, out of `IDLE`, out of the fetch and out of `useRepoPage.test.ts`. The repository hook now answers the heading only.

- [ ] **Step 4: Run both**

Run: `npx vitest run --root apps/app useReadme useRepoPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/hooks/useReadme.ts apps/app/src/hooks/useReadme.test.ts apps/app/src/hooks/useRepoPage.ts apps/app/src/hooks/useRepoPage.test.ts
git commit -m "Read a README for any workspace, not only a repository"
```

---

## Task 6: The repository heading on its own

**Files:**
- Create: `apps/app/src/components/RepoHeading.tsx`
- Delete: `apps/app/src/components/RepoPage.tsx`
- Modify: `apps/app/src/components/RepoPage.test.tsx` becomes `RepoHeading.test.tsx`

**Interfaces:**
- Produces: `<RepoHeading state={RepoPageState} onOpenExternal={(url) => void} onOpenRepo={(ref) => void} onRefresh={() => void} />`

- [ ] **Step 1: Move the test first**

`git mv apps/app/src/components/RepoPage.test.tsx apps/app/src/components/RepoHeading.test.tsx`. In it, render `RepoHeading` instead of `RepoPage`, drop the `fileTypes` and `readImage` props, and delete every assertion about the README - those move to `WorkspaceHome.test.tsx` in Task 8. Every assertion about the owner, the figures, the fork line, the commit lines, the badges and Refresh stays exactly as it is.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app RepoHeading`
Expected: FAIL - cannot resolve `./RepoHeading`.

- [ ] **Step 3: Extract the component**

`git mv apps/app/src/components/RepoPage.tsx apps/app/src/components/RepoHeading.tsx`. Change the default export to:

```tsx
/// A GitHub repository's heading on its workspace's home page.
///
/// This was the top half of the repository's own page. That page became the GitHub shape of a
/// heading every workspace has - the README beneath it is now a section every workspace can have.
/// Unchanged otherwise, down to the Refresh that asks GitHub again.
export default function RepoHeading({ state, onOpenExternal, onOpenRepo, onRefresh }: Props) {
  const { t, i18n } = useTranslation();

  if (state.loading) return <p className="text-sm text-ink-3">{t("repo.loading")}</p>;

  return (
    <>
      <Heading stats={state.stats} onOpenExternal={onOpenExternal} onOpenRepo={onOpenRepo} onRefresh={onRefresh} />
      {state.pin !== null && (
        <PinLines pin={state.pin} language={i18n.language || "en"} onOpenExternal={onOpenExternal} />
      )}
      {state.stats === null && state.errorKey !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t(state.errorKey)}
        </p>
      )}
      {state.stats !== null && <Cards stats={state.stats} language={i18n.language || "en"} />}
    </>
  );
}
```

Remove `fileTypes` and `readImage` from `Props`, remove the README body, and remove the `MarkdownPreview` import. Every private component the file holds - `Heading`, `Owner`, `ForkLine`, `PinLines`, `Sha`, `Cards`, `Card`, the icons, `Badge`, `ExternalLink` - stays as it is. Keep the error paragraph's existing classes rather than the ones above if they differ; the markup is being moved, not restyled.

- [ ] **Step 4: Run it**

Run: `npx vitest run --root apps/app RepoHeading`
Expected: PASS. `App.tsx` will not typecheck until Task 9.

- [ ] **Step 5: Commit**

```bash
git add -A apps/app/src/components
git commit -m "Keep the repository heading, and let the README go"
```

---

## Task 7: The graph page takes its subscription

**Files:**
- Modify: `apps/app/src/components/GraphPage.tsx`, `GraphPage.test.tsx`

**Interfaces:**
- Consumes: `VaultGraphView` from `hooks/useVaultGraph.ts`
- Produces: `GraphPageProps` with `graph: VaultGraphView` in place of `client`, and `workspaceName` in place of `vaultName`

- [ ] **Step 1: Change the test harness first**

In `GraphPage.test.tsx`, wrap the page in a harness that subscribes and hands the result down, so every existing assertion stays as it is:

```tsx
/// The page no longer subscribes to the index itself: the home page that holds it already has, to
/// decide whether a Graph section exists at all. This harness plays that part.
function Subscribed({ client, workspaceId, ...rest }: Omit<GraphPageProps, "graph"> & { client: GraphClient }) {
  const graph = useVaultGraph(client, workspaceId);
  return <GraphPage {...rest} workspaceId={workspaceId} graph={graph} />;
}
```

and render `<Subscribed client={fake.client} ... />` wherever the file rendered `<GraphPage client={fake.client} ... />`. Rename every `vaultName` to `workspaceName`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --root apps/app GraphPage`
Expected: FAIL - `graph` is not a prop, `workspaceName` is not a prop.

- [ ] **Step 3: Change the page**

In `GraphPage.tsx`: replace `client: GraphClient` with

```ts
  /// The index's answer for this workspace. Passed in rather than subscribed to here: the home page
  /// that holds this already subscribes, to decide whether a Graph section exists at all, and two
  /// subscriptions to one workspace were two fetches and two listeners for one answer.
  graph: VaultGraphView;
```

replace `vaultName` with `workspaceName`, delete the `useVaultGraph` call and the import it needs, and read `graph` from props. Nothing else in the page changes.

- [ ] **Step 4: Run it**

Run: `npx vitest run --root apps/app GraphPage graphBundle`
Expected: PASS. `graphBundle.test.ts` must still pass: `GraphPage` is still reached only through `lazy`.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/GraphPage.tsx apps/app/src/components/GraphPage.test.tsx
git commit -m "Hand the graph page its subscription instead of taking a second one"
```

---

## Task 8: The page

**Files:**
- Create: `apps/app/src/components/WorkspaceHome.tsx`, `WorkspaceHome.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `homeSections`, `openingSection` (Task 4), `useReadme` (Task 5), `RepoHeading` (Task 6), `GraphPage` via `lazy` (Task 7), `useVaultGraph`, `noteCount`, `linkCount`, `attachmentCount`, `indexAge`
- Produces:

```ts
export interface WorkspaceHomeProps {
  workspace: { id: string; name: string; ref: WorkspaceRef; vault?: boolean };
  graphClient: GraphClient;
  readmeClient: ReadmeClient;
  repo: RepoPageState | null;
  fileTypes: readonly string[];
  readImage: (path: string) => Promise<ImageResult>;
  onOpenExternal: (url: string) => void;
  onOpenRepo: (ref: WorkspaceRef) => void;
  onRefreshRepo: () => void;
  graphPage: (graph: VaultGraphView) => React.ReactNode;
  now?: () => number;
}
```

`graphPage` is a render function rather than the component itself: `WorkspaceHome` is eager, and it must never name `GraphPage` statically. `App.tsx` supplies the lazy element.

- [ ] **Step 1: Add the strings**

In `apps/app/src/locales/en.json`, add a `home` block:

```json
  "home": {
    "kindFolder": "Folder",
    "kindVault": "Obsidian vault",
    "kindRepository": "GitHub repository",
    "sections": "Sections",
    "sectionGraph": "Graph",
    "sectionReadme": "Readme",
    "counts": "{{notes}} notes - {{links}} links - {{attachments}} attachments - indexed {{age}}",
    "empty": "This folder has no README, and none of its notes link to each other.",
    "noReadme": "This folder has no README.",
    "truncated": "Only the first {{count}} notes are in this graph. This folder has more.",
    "loadingReadme": "Reading the README..."
  },
```

Change `graph.empty` from "No notes in this vault yet" to "No notes in this folder yet", and delete `repo.noReadme` and `repo.readmeFailed`, moving the second to `home.readmeFailed` with its text unchanged.

- [ ] **Step 2: Write the failing test**

Create `apps/app/src/components/WorkspaceHome.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@trypthos/domain";
import WorkspaceHome from "./WorkspaceHome";

/// A workspace's home page. The heading and counts are always there; each section exists only when
/// it has something in it, and one control moves between them.

const NOTES = { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" } };
const VAULT = { ...NOTES, vault: true };
const REPO = { id: "Repo", name: "notes", ref: { kind: "github" as const, owner: "ada", repo: "notes" } };

const linked: GraphSnapshot = {
  workspaceId: "Notes",
  builtAt: "2026-09-18T09:00:00.000Z",
  unreadable: 0,
  truncated: false,
  newNotes: { mode: "root" },
  nodes: [
    { id: "Notes/Home.md", kind: "note", label: "Home", path: "Notes/Home.md", degree: 1 },
    { id: "Notes/Plan.md", kind: "note", label: "Plan", path: "Notes/Plan.md", degree: 1 },
    { id: "Notes/map.png", kind: "attachment", label: "map.png", path: "Notes/map.png", degree: 0 },
  ],
  edges: [{ source: "Notes/Home.md", target: "Notes/Plan.md", both: false }],
};

const unlinked: GraphSnapshot = { ...linked, edges: [] };

function page({
  workspace = NOTES,
  snapshot = linked as GraphSnapshot | null,
  readme = "# Notes" as string | null,
  repo = null as never,
} = {}) {
  const graphClient = {
    graphState: vi.fn(async () => ({ ok: true as const, state: { snapshot, building: null, error: null } })),
    refreshGraph: vi.fn(async () => ({ ok: true as const })),
    onGraphProgress: () => () => {},
    onGraphChanged: () => () => {},
  };
  const readmeClient = {
    listDirectory: vi.fn(async () => ({
      ok: true as const,
      nodes: readme === null ? [] : [{ id: `${workspace.id}/README.md`, name: "README.md", kind: "file" as const }],
    })),
    readFile: vi.fn(async () => ({ ok: true as const, content: readme ?? "", revision: { id: "r" } })),
  };
  const graphPage = vi.fn(() => <div data-testid="graph-section" />);
  render(
    <WorkspaceHome
      workspace={workspace}
      graphClient={graphClient as never}
      readmeClient={readmeClient as never}
      repo={repo}
      fileTypes={["markdown"]}
      readImage={async () => ({ ok: false as const, reason: "not-found" })}
      onOpenExternal={vi.fn()}
      onOpenRepo={vi.fn()}
      onRefreshRepo={vi.fn()}
      graphPage={graphPage}
      now={() => Date.parse("2026-09-18T09:00:30.000Z")}
    />,
  );
  return { graphPage };
}

describe("a workspace's home page", () => {
  it("names the workspace and what kind it is", async () => {
    page();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByText("Folder")).toBeTruthy();
  });

  it("says a vault is a vault", () => {
    page({ workspace: VAULT });
    expect(screen.getByText("Obsidian vault")).toBeTruthy();
  });

  it("counts what the index found", async () => {
    page();
    await waitFor(() => expect(screen.getByText("2 notes - 1 links - 1 attachments - indexed just now")).toBeTruthy());
  });

  it("opens on the graph when something links to something", async () => {
    page();
    await waitFor(() => expect(screen.getByTestId("graph-section")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Graph" }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves to the README and back", async () => {
    page();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Readme" })).toBeTruthy());
    await userEvent.click(screen.getByRole("tab", { name: "Readme" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Notes", level: 1 })).toBeTruthy());
    expect(screen.queryByTestId("graph-section")).toBe(null);
  });

  // A graph with no edges is a field of dots, which is worse than no graph.
  it("offers no graph when nothing links to anything", async () => {
    page({ snapshot: unlinked });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Readme" })).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Graph" })).toBe(null);
  });

  it("says plainly when there is neither", async () => {
    page({ snapshot: unlinked, readme: null });
    await waitFor(() =>
      expect(screen.getByText("This folder has no README, and none of its notes link to each other.")).toBeTruthy(),
    );
    expect(screen.queryByRole("tablist")).toBe(null);
  });

  it("says when the graph is not the whole folder", async () => {
    page({ snapshot: { ...linked, truncated: true } });
    await waitFor(() => expect(screen.getByText(/Only the first 5000 notes are in this graph/)).toBeTruthy());
  });

  // A repository has no index yet, so no counts and no Graph section - which falls out of the rule
  // that a section needs content, rather than being a case of its own.
  it("gives a repository its heading and README, and no graph", async () => {
    page({ workspace: REPO, snapshot: null });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Readme" })).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Graph" })).toBe(null);
    expect(screen.getByText("GitHub repository")).toBeTruthy();
  });
});
```

Pass a `repo` state from `useRepoPage.test.ts`'s fixtures for the repository case if `RepoHeading` needs one to render; the assertions stay as written.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --root apps/app WorkspaceHome`
Expected: FAIL - cannot resolve `./WorkspaceHome`.

- [ ] **Step 4: Write the page**

Create `apps/app/src/components/WorkspaceHome.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import type { RepoPageState } from "../hooks/useRepoPage";
import { useReadme } from "../hooks/useReadme";
import type { ReadmeClient } from "../hooks/useReadme";
import { useVaultGraph } from "../hooks/useVaultGraph";
import type { VaultGraphView } from "../hooks/useVaultGraph";
import { attachmentCount, indexAge, linkCount, noteCount } from "../lib/graphStatus";
import { homeSections, openingSection } from "../lib/homeSections";
import type { HomeSection } from "../lib/homeSections";
import type { GraphClient, ImageResult } from "../lib/workspaceClient";
import MarkdownPreview from "./MarkdownPreview";
import RepoHeading from "./RepoHeading";

/// A workspace's home page: what it is, how much is in it, its README and its graph.
///
/// **The heading never scrolls.** It says which workspace is on screen, which is the one thing that
/// must not be lost while reading something inside it.
///
/// **The sections do not share the area.** A graph canvas takes the wheel to zoom and a README
/// scrolls; put one inside the other and the wheel is wrong in one of them. Each gets the whole
/// remaining height in turn, and one control moves between them.
///
/// **Eager, and never names the graph.** `graphPage` is a render function `App` supplies, because
/// the graph page and everything under it is lazy and `graphBundle.test.ts` would fail on a static
/// import here - rightly, since it would put sigma on every page load.

export interface WorkspaceHomeProps {
  workspace: { id: string; name: string; ref: WorkspaceRef; vault?: boolean };
  graphClient: GraphClient;
  readmeClient: ReadmeClient;
  repo: RepoPageState | null;
  fileTypes: readonly string[];
  readImage: (path: string) => Promise<ImageResult>;
  onOpenExternal: (url: string) => void;
  onOpenRepo: (ref: WorkspaceRef) => void;
  onRefreshRepo: () => void;
  graphPage: (graph: VaultGraphView) => React.ReactNode;
  now?: () => number;
}

export default function WorkspaceHome({
  workspace,
  graphClient,
  readmeClient,
  repo,
  fileTypes,
  readImage,
  onOpenExternal,
  onOpenRepo,
  onRefreshRepo,
  graphPage,
  now = Date.now,
}: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const ageText = useAgeText();
  const local = workspace.ref.kind === "local";
  // A repository has no index yet. Asking would only be answered "unsupported", so it is not asked.
  const graph = useVaultGraph(graphClient, local ? workspace.id : null);
  const readme = useReadme(workspace.id, readmeClient);

  const snapshot = graph.snapshot;
  const sections = homeSections({ edges: snapshot?.edges.length ?? 0, hasReadme: readme.source !== null });
  /// Null until the user chooses; until then the page follows `openingSection`, so a graph that
  /// finishes building after the page opened is where the page goes, rather than where it was.
  const [chosen, setChosen] = useState<HomeSection | null>(null);
  const shown = chosen !== null && sections.includes(chosen) ? chosen : openingSection(sections);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-rule px-4 pt-3 pb-3">
        {workspace.ref.kind === "github" && repo !== null ? (
          <RepoHeading state={repo} onOpenExternal={onOpenExternal} onOpenRepo={onOpenRepo} onRefresh={onRefreshRepo} />
        ) : (
          <>
            <h2 className="text-lg font-semibold text-ink">{workspace.name}</h2>
            <p className="text-xs text-ink-4">
              {t(workspace.vault === true ? "home.kindVault" : "home.kindFolder")}
              {workspace.ref.kind === "local" ? ` - ${workspace.ref.root}` : ""}
            </p>
          </>
        )}
        {workspace.ref.kind === "github" && <p className="mt-1 text-xs text-ink-4">{t("home.kindRepository")}</p>}

        {snapshot !== null && (
          <p className="mt-2 text-xs text-ink-3">
            {t("home.counts", {
              notes: noteCount(snapshot),
              links: linkCount(snapshot),
              attachments: attachmentCount(snapshot),
              age: ageText(indexAge(snapshot.builtAt, now())),
            })}
          </p>
        )}
        {snapshot?.truncated === true && (
          <p className="mt-1 text-xs text-ink-4">{t("home.truncated", { count: 5000 })}</p>
        )}

        {sections.length > 1 && (
          <div role="tablist" aria-label={t("home.sections")} className="mt-3 flex gap-1">
            {sections.map((section) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={section === shown}
                onClick={() => setChosen(section)}
                className={
                  section === shown
                    ? "rounded-full border border-rule bg-sunken px-3 py-0.5 text-xs text-ink"
                    : "rounded-full border border-rule px-3 py-0.5 text-xs text-ink-4 hover:text-ink"
                }
              >
                {t(section === "graph" ? "home.sectionGraph" : "home.sectionReadme")}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 grow">
        {shown === "graph" && graphPage(graph)}
        {shown === "readme" && readme.source !== null && (
          <MarkdownPreview source={readme.source} fileTypes={fileTypes} readImage={readImage} fromPath={readme.path} />
        )}
        {shown === null && !readme.loading && !graph.building && (
          <p className="p-4 text-sm text-ink-3">{t("home.empty")}</p>
        )}
      </div>
    </div>
  );
}
```

`useAgeText` is the hook `GraphPage.tsx` already defines privately, returning `(age: IndexAge) => string` from the `graph.age*` keys. Move it verbatim into `apps/app/src/hooks/useAgeText.ts` and import it from both files, rather than writing it twice. Add `import { useAgeText } from "../hooks/useAgeText";` to the imports above.

With exactly one section the tab list is not drawn: a control with one choice is not a control. The tests above assert `tablist` is absent only when there is nothing at all, so add one more case - one section, no tab list - to the test file before moving on.

- [ ] **Step 5: Run it**

Run: `npx vitest run --root apps/app WorkspaceHome i18nKeys`
Expected: PASS. `i18nKeys` catches a key used and not defined, or defined and never used.

- [ ] **Step 6: Commit**

```bash
git add -A apps/app/src/components apps/app/src/lib apps/app/src/locales
git commit -m "A home page for every workspace"
```

---

## Task 9: Opening it

**Files:**
- Modify: `apps/app/src/hooks/useWorkspace.ts`, `useWorkspace.test.ts`, `apps/app/src/components/WorkspacePanel.tsx`, `WorkspacePanel.test.tsx`, `apps/app/src/App.tsx`, `App.test.tsx`, `apps/app/src/components/EditorTabs.tsx`

**Interfaces:**
- Consumes: `homePagePath`, `homePageWorkspaceId` (Task 1), `WorkspaceHome` (Task 8)
- Produces: `openHomePage(workspaceId: string): void` on `useWorkspace`; `onOpenHomePage` on `WorkspacePanel`

- [ ] **Step 1: Write the failing tests**

In `useWorkspace.test.ts`, replace the "vault graph tab" and repository page cases with:

```ts
describe("a workspace's home page", () => {
  it("opens as a read-only tab of its own", () => {
    const { result } = renderWorkspace();
    act(() => result.current.actions.openHomePage("Notes"));
    const page = result.current.state.documents.open.find((document) => document.path === "trypthos:home/Notes");
    expect(page?.readOnly).toBe(true);
  });

  it("goes to the tab rather than opening a second one", () => {
    const { result } = renderWorkspace();
    act(() => result.current.actions.openHomePage("Notes"));
    act(() => result.current.actions.openHomePage("Notes"));
    expect(result.current.state.documents.open.filter((document) => document.path === "trypthos:home/Notes")).toHaveLength(1);
  });
});
```

In `WorkspacePanel.test.tsx`, change the root-row cases so every kind calls one prop:

```tsx
it.each([
  ["a local folder", DIARIZ],
  ["a vault", RESEARCH],
  ["a repository", REPO],
])("opens the home page of %s from its row", async (_kind, workspace) => {
  const props = panel({ workspaces: [workspace], folders: {} });
  fireEvent.click(screen.getByRole("button", { name: exactly(workspace.name) }));
  expect(props.onOpenHomePage).toHaveBeenCalledWith(workspace.id);
  expect(props.onToggleFolder).not.toHaveBeenCalled();
});
```

and delete the three cases that asserted `onOpenGraphPage` and `onOpenRepoPage` separately. Replace those two props in the `panel()` factory with `onOpenHomePage: vi.fn()`.

In `App.test.tsx`, add:

```tsx
it("names a home page's tab after its workspace", async () => {
  // A workspace whose id and folder name differ, which is exactly the case a tab named from the
  // path's last segment got wrong.
  shellWithFolder({ id: "Notes-2", name: "Notes" });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /^Notes$/ }));
  expect(await screen.findByRole("tab", { name: /Notes/ })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: /Notes-2/ })).toBe(null);
});
```

using whatever the file calls its fake-shell builder, extended to set the workspace id if it cannot already.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run --root apps/app useWorkspace WorkspacePanel App.test`
Expected: FAIL - `openHomePage` and `onOpenHomePage` do not exist.

- [ ] **Step 3: One opener**

In `useWorkspace.ts`, replace `openRepoPage` and `openGraphPage` - interface and implementation - with:

```ts
    /// Opens a workspace's home page, or goes to it if it is already open. Opening a tab that is
    /// already open only switches to it, so the row calls this on every click and a second click
    /// costs nothing.
    openHomePage: (workspaceId: string) =>
      setInternal((prev) => ({
        ...prev,
        documents: openDocument(prev.documents, {
          path: homePagePath(workspaceId),
          content: "",
          revision: { id: "home" },
          readOnly: true,
        }),
      })),
```

- [ ] **Step 4: One prop on the panel**

In `WorkspacePanel.tsx`, replace `onOpenRepoPage` and `onOpenGraphPage` with:

```ts
  /// Opens a workspace's home page - its heading, its counts, its README and its graph. Every kind of
  /// workspace has one now, so the row that opens it no longer asks which kind it is.
  onOpenHomePage: (workspaceId: string) => void;
```

and the root row's `onOpen` becomes:

```tsx
                  onOpen={() => {
                    onSelectFolder(workspace.id);
                    // A workspace's row is its home. Opening a tab that is already open only switches
                    // to it, so a second click costs nothing.
                    onOpenHomePage(workspace.id);
                  }}
```

- [ ] **Step 5: Route to it in App**

In `App.tsx`:

- Replace `repoPageId` / `graphPageId` / `graphWorkspace` with:

```tsx
  const homeId = homePageWorkspaceId(state.activePath ?? "");
  const homeWorkspace = state.workspaces.find((workspace) => workspace.id === homeId) ?? null;
  const repoPage = useRepoPage(homeWorkspace?.ref.kind === "github" ? homeWorkspace.id : null, github, client);
```

- Replace the `page={...}` conditional on `EditorPanel` with:

```tsx
          page={
            homeWorkspace !== null ? (
              <WorkspaceHome
                // Keyed by workspace for the same reason the graph page was: without it, a second
                // workspace's page would inherit the first one's chosen section and search.
                key={homeWorkspace.id}
                workspace={homeWorkspace}
                graphClient={client}
                readmeClient={client}
                repo={homeWorkspace.ref.kind === "github" ? repoPage : null}
                fileTypes={settings.fileTypes.enabled}
                readImage={client.readImage}
                onOpenExternal={openExternal}
                onOpenRepo={(ref) => void actions.openRef(ref)}
                onRefreshRepo={repoPage.refresh}
                graphPage={(graph) => (
                  <Suspense fallback={null}>
                    <GraphPage
                      workspaceId={homeWorkspace.id}
                      workspaceName={homeWorkspace.name}
                      graph={graph}
                      activePath={state.activePath}
                      filter={graphFilter}
                      onFilterChange={updateGraph}
                      onOpenPath={(path) => void actions.openPath(path)}
                      onCreateNote={setNamingNote}
                    />
                  </Suspense>
                )}
              />
            ) : null
          }
```

- Replace `anyVaultOpen` with:

```tsx
  /// Whether the local graph pane has anything to follow. Every local folder has a graph now, not
  /// only a vault. A repository still does not - one request per note meets GitHub's rate limit -
  /// so it is left out exactly as the index leaves it out.
  const anyLocalWorkspaceOpen = state.workspaces.some((workspace) => workspace.ref.kind === "local");
```

and `localVaultId` with the same test minus `vault === true`. Rename at every use.

- Pass `onOpenHomePage={actions.openHomePage}` to `WorkspacePanel` in place of the two removed props.
- Import `WorkspaceHome` statically - it is eager - and delete the `RepoPage` import.

- [ ] **Step 6: The tab's name**

In `EditorTabs.tsx`, where a tab falls back to `documentName(path)`, answer a home page with its workspace's name first. `EditorTabs` needs the workspaces to do that; pass it a `homePageName(path): string | null` from `App.tsx` built on `homePageWorkspaceId` and the workspace list, rather than handing the whole list down. Keep `builtInTitleKey` as it is: a workspace's name is not a catalogue string and must not go through `t`.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck`, `npm run lint`, `npm test`.
Expected: PASS, with no warnings printed.

- [ ] **Step 8: Commit**

```bash
python C:/Users/kenha/AppData/Local/Temp/claude/D--Repositories-Trypthos/6f280747-2f1d-442b-b5da-eaf04edf099c/scratchpad/remix.py apps/app/src/App.tsx apps/app/src/App.test.tsx apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/components/EditorTabs.tsx
git add -A apps/app/src
git commit -m "Open a workspace's home page from its row, whatever kind it is"
```

---

## Task 10: Measured in a real browser

**Files:**
- Create: `apps/app/src/components/WorkspaceHome.browser.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { render, waitFor } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import WorkspaceHome from "./WorkspaceHome";

/// The layout claims, measured. Both are about boxes, which jsdom reports as zero.

const LONG = Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1} of a long README.`).join("\n\n");

async function mount() {
  await page.viewport(900, 600);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0";
  document.body.append(host);
  // Build the same props `WorkspaceHome.test.tsx` builds, with `LONG` as the README and one edge in
  // the snapshot, and `graphPage` answering a div that fills its parent.
  return render(<WorkspaceHome {...props(LONG)} />, { container: host });
}

describe("a workspace's home page, laid out", () => {
  it("keeps the heading still while the README scrolls", async () => {
    const view = await mount();
    const readmeTab = await view.findByRole("tab", { name: "Readme" });
    readmeTab.click();
    const heading = view.getByRole("heading", { name: "Notes", level: 2 });
    const before = heading.getBoundingClientRect().top;
    const scroller = view.container.querySelector(".markdown-body")!.parentElement!;
    await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight));
    scroller.scrollTop = 400;
    expect(heading.getBoundingClientRect().top).toBe(before);
  });

  it("gives the graph every pixel below the heading", async () => {
    const view = await mount();
    const graph = await view.findByTestId("graph-section");
    const header = view.container.querySelector("header")!.getBoundingClientRect();
    const box = graph.getBoundingClientRect();
    expect(Math.round(box.top)).toBe(Math.round(header.bottom));
    expect(Math.round(box.bottom)).toBe(600);
  });
});
```

Share the props builder with the jsdom test by moving it into `apps/app/src/testing/workspaceHomeProps.tsx`, so there is one description of the page's props.

- [ ] **Step 2: Run it**

Run: `npx vitest run --root apps/app --config vitest.browser.config.ts WorkspaceHome.browser`
Expected: PASS. Then break it on purpose - give the section wrapper a fixed `h-64` - and confirm the second case fails, then put it back.

- [ ] **Step 3: Run the whole browser suite**

Run: `npm run test:browser`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/components/WorkspaceHome.browser.test.tsx apps/app/src/testing/workspaceHomeProps.tsx apps/app/src/components/WorkspaceHome.test.tsx
git commit -m "Measure the home page's layout where it is laid out"
```

---

## Task 11: See it in the app

Not a test task, and not optional. The tree-row work found a real defect only by driving the app.

- [ ] **Step 1:** `npm run build`, then adapt `check-tree.mjs` in the scratchpad to click the demo vault's row and screenshot the home page in both themes, on the Graph section and on the Readme section.
- [ ] **Step 2:** Open a second invented workspace that is a plain folder containing a `node_modules` directory with markdown in it, and confirm its graph does not include those files and its counts say so.
- [ ] **Step 3:** Open a plain folder with no links and no README, and confirm the page says so in words rather than showing an empty area.
- [ ] **Step 4:** Fix anything it finds with a failing test first, as in Task 10's pattern.

---

## Task 12: The release

- [ ] **Step 1:** 0.85.0 to **0.86.0** in `version.json`, the four manifests, and exactly five entries in `package-lock.json`. Count before and after.
- [ ] **Step 2:** A `RECENT[0]` entry. Headline: "A home page for every folder, and a graph for any folder that links". The summary says what a user sees - clicking any workspace's row opens one page with its README and graph; any local folder now has a graph, not just a vault; build and dependency folders and whatever `.gitignore` excludes are left out; a very large folder's graph stops at 5,000 notes and says so; GitHub repositories keep their page, now with a Readme section, and still have no graph. Confirm the PR number before `gh pr create` reports it.
- [ ] **Step 3:** About box: rename the **Vault graph** capability row to a workspace home row covering all of the above, and add to `DISCLAIMERS`: "Which files a folder's graph leaves out is decided with the ignore package, reading the folder's own .gitignore."
- [ ] **Step 4:** README Features row and `docs/features.md`, in step.
- [ ] **Step 5:** `docs/Architecture.md`: the `trypthos:home/` path and the two it retired, the index gate, the ignore rules and why the floor sits beneath the `.gitignore`, the cap and `truncated`, the lifted subscription, and `ignore` as a main-process dependency.
- [ ] **Step 6:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`. All green, nothing printed.
- [ ] **Step 7:** `git diff --stat` proportional throughout; remix anything that is not.
- [ ] **Step 8:** Commit "Release 0.86.0", push, and open the PR with the deployment surface stated.

---

## Self-review

**Spec coverage.** The ignore floor and `.gitignore`, Task 2. The gate and the cap, Task 3. One path and README discovery, Task 1. Which sections exist and which opens, Task 4. The layout - fixed heading, full-height sections, one control - Task 8, measured in Task 10. The heading per kind, Tasks 6 and 8. The counts, Tasks 4 and 8. The tab named after the workspace, Task 9. `anyLocalWorkspaceOpen`, Task 9. Wording, Task 8. Every row in the failure table has a test in Task 3 or Task 8. Release, Task 12.

**Where the plan departs from the spec, and why.** The spec's testing table puts the ignore tests in the domain; they are in `apps/desktop` so `ignore` never reaches the renderer bundle. The spec's heading shape shows the counts line for every kind; a repository has no index and therefore no counts, which the spec's own "Which sections exist" and failure tables already say.

**Gaps found and closed while reviewing.** The page could not decide whether to show a Graph section without the snapshot the graph page subscribed to privately - so Task 7 lifts the subscription. The README fetch was locked inside the GitHub hook - so Task 5 moves it. The spec did not say what a single section looks like; Task 8 draws no tab list for one choice. `useAgeText` would have been written twice; Task 8 moves it into its own hook once.

**Names used consistently:** `HOME_PAGE_PREFIX`, `homePagePath`, `homePageWorkspaceId`, `isHomePagePath`, `readmeNameIn`, `createIgnoreRules`, `skipsDirectory`, `skipsFile`, `DENIED_DIRECTORIES`, `NOTE_LIMIT`, `truncated`, `HomeSection`, `homeSections`, `openingSection`, `attachmentCount`, `useAgeText`, `useReadme`, `ReadmeState`, `ReadmeClient`, `RepoHeading`, `VaultGraphView`, `workspaceName`, `WorkspaceHome`, `WorkspaceHomeProps`, `graphPage`, `openHomePage`, `onOpenHomePage`, `anyLocalWorkspaceOpen`, `homePageName`.
