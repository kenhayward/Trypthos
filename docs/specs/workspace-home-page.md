# A home page for every workspace, and a graph for every local folder

**Status:** approved, not yet implemented
**Ships as:** one PR, version 0.86.0
**Follows:** `docs/specs/workspace-tree-rows.md`, which made a workspace root's icon and name open its
page. This spec is what that page becomes.

Three changes, one feature.

1. **Every workspace gets the same home page.** One heading, one line of counts, the workspace's own
   README, and its graph. The GitHub repository page becomes the GitHub shape of that heading rather
   than a page of its own.
2. **A graph is no longer only for Obsidian vaults.** Any local folder whose markdown files link to
   each other gets one, built by the same indexer.
3. **A folder that is not a vault is not curated**, so the indexer learns what to skip. That is the
   part of this with real teeth.

---

## Why the indexer needs ignore rules before it needs anything else

A vault is a folder a person curates. An arbitrary folder is not. Measured on this repository:

| | Count |
|---|---|
| Markdown files outside `node_modules` | 11 |
| Markdown files including it | 1,117 |
| Directories | 3,070 |
| Files | 37,934 |

The walk already skips names beginning with `.`, which is why `.git` and `.obsidian` never appear.
Nothing skips `node_modules`. Turning the graph on for local folders without ignore rules would
index a hundred times more files than the folder actually contains, and draw a graph of dependency
READMEs.

So the indexer gains two rules, applied together rather than as alternatives:

- **A deny-list floor**, always applied: `node_modules`, `dist`, `build`, `out`, `target`, `vendor`,
  `coverage`, `venv`, `.venv`, `__pycache__`, `bin`, `obj`, `Pods`, `DerivedData`. Whole directory
  names, never substrings, and matched without regard to case - `Node_Modules` on a Windows disk is
  the same directory as `node_modules`, and a rule that missed it would miss it only for some people.
- **The workspace's own `.gitignore` when it has one**, read from the root and applied to every path
  below it. Parsed with the [`ignore`](https://www.npmjs.com/package/ignore) package (MIT, no
  dependencies) rather than by hand: gitignore precedence has negation, anchoring and directory-only
  patterns, and a hand-rolled version of it is a source of wrong answers nobody would think to test.

**The floor stays beneath the `.gitignore`, not beside it.** A `.gitignore` that does not mention
`node_modules` - a nested package, a repository that vendors its dependencies - would otherwise let
the whole problem back in. The cost of applying both is that a file a user deliberately un-ignored
with a `!` rule is still skipped if it sits in a denied directory; that is a trade this spec accepts,
and it is recorded below as something to revisit if anyone hits it.

**Only the root `.gitignore` is read.** Nested ones, `.git/info/exclude` and the global excludes file
are out of scope.

**A cap, honestly reported.** The walk stops after **5,000 markdown files** and the page says the
graph is incomplete. A vault has never needed one; a folder chosen by a user might be a whole drive.

---

## The page

One path, `trypthos:home/<workspaceId>`, replacing both `trypthos:graph/` and `trypthos:repo/`. Open
documents are not persisted between runs, so nothing has to migrate; the two old prefixes are simply
gone.

The tab is named after the **workspace**, not the last segment of the path. Today a graph tab reads
`Notes` only because the workspace id happens to match; a workspace whose id and name differ would
show the wrong one.

### Shape

```
+--------------------------------------------------+
|  <mark>  Trypthos                                 |   heading: name, kind, where from,
|  Folder - D:\Repositories\Trypthos                |   and for GitHub its figures and
|  11 notes  18 links  3 attachments  just now      |   commit lines, exactly as now
+--------------------------------------------------+
|  ( Graph )  ( Readme )                            |   one control, only the sections
+--------------------------------------------------+   that exist
|                                                   |
|                  the chosen section               |   the whole remaining height
|                                                   |
+--------------------------------------------------+
```

**The heading and the counts never scroll.** They say which workspace is on screen, which is the one
thing that must not be lost while reading something inside it.

**The sections do not share the area, and that is the point.** A Sigma canvas takes the wheel to
zoom. A README scrolls. Put one inside the other and the wheel is wrong in one of them: either the
page jumps when the pointer crosses the graph, or the graph cannot be zoomed. Giving each the full
area and a control to move between them is the only arrangement where neither fights the other, and
it gives the graph the height a graph needs.

### Which sections exist

| Section | Present when |
|---|---|
| **Graph** | The workspace's index has at least one edge |
| **Readme** | A `README.md` exists at the workspace root, matched case-insensitively |

A workspace with neither shows the heading and counts alone, with a line saying the folder has no
README and nothing linking to anything. That is a real answer about the folder, not an error.

**The page opens on Graph when there is one, otherwise Readme.** Not remembered between openings;
the section a user wants is a property of the workspace they just clicked, not a setting.

### The heading, per kind

| Kind | Shows |
|---|---|
| Local folder | The folder mark, its name, its path |
| Obsidian vault | Obsidian's crystal, its name, its path |
| GitHub repository | Today's repository heading unchanged: owner, the eight figures, fork and commit lines, the external link and Refresh |

The counts line is the same for all three: notes, links, attachments, and when the index was last
built. A GitHub workspace has no index yet, so it shows no counts and has no Graph section - which
falls out of the rule above rather than needing a case of its own.

---

## What changes in the index

The gate at `vaultIndex.js` loses one of its three tests:

```js
// before
workspace.vault === true && workspace.ref?.kind === "local" && typeof workspace.root === "string"
// after
workspace.ref?.kind === "local" && typeof workspace.root === "string"
```

Everything else about the index is already kind-agnostic: the walk, the batching, the extraction and
the build all go through the provider and know nothing about Obsidian. Two details stay
Obsidian-shaped and are correct to keep:

- **`.obsidian/app.json`** is read for where new notes go. A folder without one gets `{ mode: "root" }`,
  which is the right answer for a folder with no Obsidian conventions.
- **Wiki links and tags are still extracted.** They are not only Obsidian's, several tools write
  them, and a folder that has none simply produces none. Nothing is gained by refusing to read them.

The local graph pane under the browser follows: `anyVaultOpen` becomes `anyLocalWorkspaceOpen`, so
the pane is there whenever a local workspace is, and says so when the open file has no links.

---

## Wording

Several strings say "vault" and must stop: the canvas label, "No notes in this vault yet", and the
graph page's own copy. They become folder-shaped, and a vault is simply a folder with a crystal on
its row. This is a catalogue change, so `i18nKeys.test.ts` holds it.

---

## Failure modes

| What happens | What the user sees |
|---|---|
| The folder has no README and no links | The heading and counts, and a line saying so |
| `.gitignore` is unreadable or malformed | The deny-list floor alone. No message - a broken ignore file is not something to interrupt for |
| The walk hits 5,000 files | The graph, and a line saying it is incomplete and why |
| The index has not finished | The progress the graph page already shows, in the Graph section |
| A GitHub workspace | Heading and README, no counts, no Graph section |
| The workspace closes while its page is open | The tab closes with it, exactly as the graph tab does now |

---

## Testing

| Suite | What it proves |
|---|---|
| `folderIgnore.test.ts` (domain) | The deny-list matches whole segments and not substrings; `.gitignore` patterns including negation and directory-only forms; the floor still applies when a `.gitignore` does not mention a denied directory; a malformed file falls back to the floor |
| `vaultIndex.test.js` (shell) | A plain local folder is indexed; `node_modules` is skipped with and without a `.gitignore`; the cap stops the walk and is reported; a vault behaves exactly as before |
| `homePage.test.ts` (domain) | The path round-trips, and `splitQualified` still refuses it |
| `WorkspaceHome.test.tsx` (jsdom) | Which sections exist for each combination of README and links; which one opens; the counts; the GitHub heading still renders |
| `App.test.tsx` (jsdom) | A root row opens the home page for all three kinds; the tab carries the workspace's name |
| `WorkspaceHome.browser.test.tsx` | The heading stays put while the README scrolls, and the graph gets the full remaining height. Both are questions about boxes |

---

## Release checklist

1. `version.json` 0.86.0 and every mirror: four manifests, exactly five lock entries.
2. `RECENT[0]`, matching.
3. About box: the Vault graph capability row becomes a workspace home row, and `ignore` joins the
   third-party disclaimers.
4. README Features row.
5. `docs/features.md`, in step with it.
6. `docs/Architecture.md`: the new path, the retired two, the ignore rules, the index gate, the cap.
7. Deployment surface in the PR body: needs a release.

---

## Out of scope - for future reference

| Item | Why not now | What it would take |
|---|---|---|
| **Graphs for GitHub repositories** | One request per file meets the rate limit; the spec for the vault graph already records this | A bulk fetch of the repository, and rate-limit handling that does not exist |
| **Nested `.gitignore` files** | The root one covers the case that matters | Walking rules down the tree and composing them per directory |
| **`!` rules that reach into a denied directory** | The floor wins, deliberately | A way to say which of the two rules is stronger, which is a setting nobody has asked for |
| **Remembering which section was open** | The section a user wants follows from the workspace they clicked | A per-workspace note in settings, and a decision about what a fresh workspace defaults to |
| **Folder and file counts in the heading** | The index knows notes, links and attachments; folders would be new data for one line of text | Carrying directory counts through the snapshot |
| **A README anywhere but the root** | A workspace's front page is its root's | A choice about which one wins when there are several |
| **Editing the README from its section** | It is a rendered view, like the repository page's | A route from the section into the editor, which the tree already gives |
