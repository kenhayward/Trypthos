# Architecture

Internal reference. Carries no version number; must be accurate. Update it in the same PR whenever a
component, cross-process contract, external dependency, stored-data shape or packaging detail changes.

## Components

| Component | Stack | Path |
| --- | --- | --- |
| Desktop shell (main process) | Electron, CommonJS | `apps/desktop` |
| Renderer | React 19, TypeScript, Vite, Tailwind v4 | `apps/app` |
| Domain | Pure TypeScript, zod | `packages/domain` |

One npm workspace, one lock file, one `npm ci`.

There is **no server**. Chat calls the provider directly from the main process, and everything the
app stores is a local file. That is the fact most other decisions here follow from.

## Process split, and why the boundary sits where it does

The renderer is untrusted: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no `webview`
tag, `webSecurity` on. Those five flags are asserted by `apps/desktop/test/windowOptions.test.js`
rather than left to review - each is one word, each defaults the unsafe way in older guides, and a
window with the wrong value behaves identically until a page it loads is hostile.

The preload exposes a **narrow, enumerated** bridge. There is deliberately no general "invoke any
channel" or "run this fs call" helper, because one would make the enumeration decorative. Every IPC
handler validates its own arguments in the main process; the renderer having already checked is not
a check.

**Provider calls live in the main process.** The renderer sends a turn and receives streamed tokens
over IPC. It never holds an API key and never opens a socket to a provider, because a key in the
renderer is a key in devtools, in the network panel, and in any renderer crash dump.

## The domain package

`packages/domain` imports nothing from React, Electron or `fs`. It is types plus logic, usable from
both processes and testable without booting either.

- `workspacePath.ts` - the workspace boundary check, in one place. **Lexical only**: it cannot see
  symlinks, because the package has no filesystem access. The main process must resolve a candidate
  to its real path first. A lexical check alone is satisfied by `notes.md` when `notes.md` is a
  symlink to `/etc/passwd`.
- `persisted.ts` - reading anything previously written. Every persisted document carries a
  `schemaVersion`; a reader never guesses one, and an unversioned or future-versioned document is
  refused rather than tolerated.
- `chat.ts` - chat profiles. The schema is `strict()` so an `apiKey` reaching a settings file is a
  loud parse failure, not a silently stripped field that gets written back out.
- `provider.ts` - the storage contract. A write **returns a revision, never void**, and a conflict is
  a **result, not an exception** - both shaped for GitHub, where a save is a commit, before any cloud
  backend exists.

## The editor

**CodeMirror 6 is the single editing surface.** There is no second editing engine and no markdown
serialiser: Source, Preview and (next) Live are views over one document, so there is nothing to
round-trip and nothing that can reformat a user's file behind their back.

- `components/MarkdownEditor.tsx` hosts the CodeMirror view. It is created **once** and then fed
  transactions. Recreating it per render would look correct while discarding undo history, selection
  and scroll position on every keystroke.
- The document lives **above** `EditorPanel`, which is what makes the mode invariant checkable rather
  than merely intended: mode is local state and has no path to `onChange`, so a mode switch cannot
  alter the document. `EditorPanel.test.tsx` asserts it.
- `lib/editorTheme.ts` holds the Source palette. In Source mode colour **stands in for** formatting
  rather than applying it - a heading is blue, not big - which is what keeps Source a faithful view
  of the bytes.
- `lib/markdown.ts` renders Preview through marked, sanitised with DOMPurify. One renderer for the
  whole app: Preview now, chat replies later. Both display text the app did not write.

**Live mode** (`lib/liveDecorations.ts` + `lib/liveExtension.ts`) hides markdown punctuation except
on the line the caret is on. The split is deliberate: every decision - which nodes are markers, which
lines are revealed, what to hide - is pure and tested, and the extension is only plumbing. CodeMirror
measures text to decide what to render and jsdom has no geometry, so assertions through the rendered
editor would be testing the harness rather than the rules.

Three things there that are easy to get wrong:

- **Decorations are collected then sorted, not appended while walking the tree.** The walk is in
  document order but nesting is not: a heading starts at the same offset as its own hash, so the
  parent's mark is produced before the child's replacement at an equal `from`. A `RangeSetBuilder`
  rejects that outright.
- **The parent node matters.** `CodeMark` is both an inline backtick and a fence; `URL` is both a
  link target and content. Matching on name alone hides the wrong things.
- **Only the visible ranges are decorated.** Walking the whole tree per keystroke is what makes naive
  live-preview implementations crawl on long files.

Fenced code, tables, images and footnotes have no decoration yet and therefore render as source -
a deliberate floor, and one no two-engine design can offer.

## Two test suites, and which is which

| Suite | Runs in | Command |
| --- | --- | --- |
| Unit and component | jsdom | `npm test` |
| Rendered output | real Chromium, via Playwright | `npm run test:browser` |

Split because they answer different questions, and because jsdom cannot answer the second at all.
CodeMirror decides what to render by measuring text; jsdom has no layout engine, so the geometry it
reports is a polyfill returning zeros. A test asserting Live mode's rendered output there would be
testing that polyfill.

**What belongs in the browser suite:** anything whose correctness is a rendering question - hidden
markers, computed font sizes, real caret movement. **What does not:** logic. A rule expressible over
data belongs in the jsdom suite or as a pure function, because a browser test that fails tells you
much less about why.

One trap it is worth knowing: `@testing-library/user-event` dispatches **synthetic** events, and
CodeMirror does not move its caret for them - it resolves a position from real pointer input. Use
`userEvent` from `@vitest/browser/context` in this suite. The synthetic version passes while the
caret never moves, so every assertion after it measures the wrong state.

The suite justified itself on its first run by catching a defect the jsdom suite structurally could
not see: hidden `HeaderMark` covers `#` but not the space after it, so every heading rendered one
character too far right.

## Storage providers

Order: local (now), OneDrive, Google Drive, Dropbox, GitHub.

The first three share a shape: OAuth, a mutable file at a stable id, delta sync, last-writer-wins.
GitHub does not - there is no mutable path, and a save is a commit on a branch with history and merge
conflicts. The interface is shaped for that from the start, because retrofitting a return value
through every call site later is the expensive version of the same change.

## Release notes and the bundle boundary

`apps/app/src/lib/releaseNotes/` is split five ways so the archive - which grows without bound - never
reaches the initial bundle. `current.ts` is the file every PR edits; `archive.ts` may be imported only
by the epoch drill-down page, and the barrel must not re-export `ARCHIVE`.

Nothing enforces that but who imports what, so `bundleBoundary.test.ts` asserts the module graph
directly: an eager `import { ARCHIVE }` type-checks, renders correctly, and passes every other test
while putting the whole history on every page load.

The About box reads `lib/appInfo.ts` instead, which is why the capability table lives there.

## Running it

`npm run app` starts the Vite dev server and the Electron shell together. The two race, and the shell
routinely wins, so `did-fail-load` retries on a capped backoff (`src/devReload.js`) rather than the
launcher waiting on a port - which also covers restarting the dev server while the shell stays open.

`TRYPTHOS_DEV=1` is set by `apps/desktop/scripts/dev.mjs` rather than inline in the npm script,
because an inline environment variable is not portable between cmd and a POSIX shell.

The built renderer is in **two different places** depending on the build: the app workspace's `dist`
when running from the repo, and the packaged app's resources once installed (`src/builtIndex.js`).
Getting it wrong produces a window that is blank only in the packaged build - the one place it is
most awkward to notice, which is why it is a pure function with tests rather than a path expression
inlined at the call site.

## Packaging

`electron-builder` on a `v*` tag builds the Windows installer and the macOS `.dmg` and publishes them
to GitHub Releases. Builds are **unsigned**: Developer ID signing, notarization and a working
Squirrel.Mac update path are outstanding.

Because there is no server, **every user-facing change needs a release** to reach anyone.
