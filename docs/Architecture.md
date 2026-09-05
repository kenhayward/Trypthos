# Architecture

Internal reference. Carries no version number; must be accurate. Update it in the same PR whenever a
component, cross-process contract, external dependency, stored-data shape or packaging detail changes.

## Components

| Component | Stack | Path |
| --- | --- | --- |
| Desktop shell (main process) | Electron, CommonJS | `apps/desktop` |
| Renderer | React 19, TypeScript, Vite, Tailwind v4 | `apps/app` |
| Domain | Pure TypeScript, zod | `packages/domain` |

Inside the shell, the modules worth knowing by name: `ipcHandlers.js` (the enumerated IPC surface),
`localWorkspace.js` (the filesystem provider), `settingsStore.js`, `secretStore.js` (encrypted API
keys), `chatProvider.js` (the call to the AI endpoint), `updater.js` and `tray.js`.

One npm workspace, one lock file, one `npm ci`.

**The domain package is built.** It emits CommonJS to `dist/`, because the Electron main process runs
plain CommonJS and cannot import TypeScript - and the workspace path guard has to run there, since
the renderer is untrusted. The renderer resolves `@trypthos/domain` to the **source** through a Vite
alias, so a change to it hot-reloads; Node consumers resolve `package.json` main to `dist`. That is
also why the package does not declare `"type": "module"`: node would then treat the emitted CommonJS
as ESM and reject its own requires.

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
- `textFile.ts` - whether a file's bytes are text the app can edit, and how to get them back
  unchanged: the size cap, the binary sniff, a strict UTF-8 decode, and byte order mark handling. In
  the domain so the shell that enforces the limits and the renderer that explains them cannot
  disagree about what they are. See "The read boundary".
- `fileTypes.ts` - the catalogue of file types the app opens, as data, plus the pure resolution over
  it. See "File types".
- `provider.ts` - the storage contract. A write **returns a revision, never void**, and a conflict is
  a **result, not an exception** - both shaped for GitHub, where a save is a commit, before any cloud
  backend exists.
- `markdownToolbar.ts` - what each formatting button does to the document, as a pure function of the
  text and the selection. It answers with one replacement and where the selection lands, so the
  editor applies it as a single transaction. Nothing here parses markdown: the rules are textual,
  which is why the pair of asterisks shared by bold and italic is handled explicitly.

## The editor

**CodeMirror 6 is the single editing surface.** There is no second editing engine and no markdown
serialiser: Source, Preview and (next) Live are views over one document, so there is nothing to
round-trip and nothing that can reformat a user's file behind their back.

- `components/DocumentEditor.tsx` hosts the CodeMirror view. It is created **once** and then fed
  transactions. Recreating it per render would look correct while discarding undo history, selection
  and scroll position on every keystroke.
- The documents live **above** `EditorPanel`, which is what makes the mode invariant checkable rather
  than merely intended: mode is local state and has no path to `onChange`, so a mode switch cannot
  alter a document. `EditorPanel.test.tsx` asserts it.
- **Several documents are open at once, and one editor serves them all.** `DocumentEditor` is told
  which document it is showing (`documentId`); a change of that value means a different FILE rather
  than new text for the same one, and it remembers where each was left - the caret, and the line at
  the top of the view - so returning to a tab is not the same as reopening the file. The place is
  recorded as a POSITION, not a pixel offset: CodeMirror measures a document lazily, so an offset
  restored into an unmeasured document lands wherever the estimate happened to put it. The scroll is
  restored in a SECOND transaction, because a `scrollIntoView` effect is mapped through its own
  transaction's changes, and the one that swaps the document replaces every character in it.
- `components/EditorTabs.tsx` draws the open documents, and owns **identity** - which file, and
  closing it. `EditorHeader` beside it owns **state** - whether what is on screen is saved, and which
  view it is in. Neither repeats the other, which is why the only dirty dot in the strip is on a tab
  that is NOT on screen: for the one that is, the header says so in words.
- `components/OpenFilesMenu.tsx` lists every open document, and is **pinned between the strip and the
  header** rather than drawn inside the strip - the strip scrolls, so an affordance for reaching a
  tab that has scrolled away must not scroll away with it. It follows `ChatHistoryMenu`'s popover
  shape (outside click and Escape to close) rather than inventing a second one.
- `components/EditorToolbar.tsx` draws the formatting buttons, in **Source only**. It knows the order
  of the buttons, their glyphs and their names, and nothing about markdown: it names an action, and
  `DocumentEditor` turns the current document and selection into one change through `toolbarEdit`.
  The action is named rather than the edit computed because the toolbar renders from props, and a
  render can be a keystroke behind the buffer - the editor is the only place that knows the document
  and the selection as they are at the moment of the press. `EditorPanel` attaches the editor handle
  with a callback ref, since two callers need it: the toolbar, and the window applying a chat edit.
- **A document can be read-only.** `OpenDocument.readOnly` marks a document with no file behind it -
  today, the built-in markdown guide at the reserved path `GUIDE_PATH` (`trypthos:markdown-guide`,
  which no workspace-relative path can collide with). The flag is enforced in three places, and all
  three are needed: `updateContent` refuses to record an edit, so it can never become dirty;
  `useWorkspace.save` refuses to write, rather than leaving the path guard in the main process to
  refuse it as a failed save the user was never offered; and `DocumentEditor` reconfigures both
  `EditorState.readOnly` and `EditorView.editable`, so the surface itself declines keystrokes rather
  than accepting and dropping them. `lib/markdownGuide.md` is the text, imported with Vite's `?raw`
  so the one document in the app whose purpose is to show markdown is not a template literal full of
  escaped backticks. `lib/builtInDocuments.ts` maps its path to a catalogue key, because a built-in
  document is the one document whose name cannot come from its path.
- `lib/editorTheme.ts` holds the Source palette. In Source mode colour **stands in for** formatting
  rather than applying it - a heading is blue, not big - which is what keeps Source a faithful view
  of the bytes.
- `lib/markdown.ts` renders Preview through marked, sanitised with DOMPurify. One renderer for the
  whole app: Preview, chat replies and the About box. All three display text the app did not write.

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

A marker is either **hidden or substituted**, never both. Hiding a list's `-` leaves the item indented
under nothing, which reads worse than the marker it removed, so `ListMark` is replaced by a bullet
widget instead. `substituteFor` is checked before `isHiddenMarker` and short-circuits it; doing both
would replace the marker and then remove the replacement. The widget sets `ignoreEvent(): false`, so
clicking a bullet places the caret and reveals the real character underneath rather than being a dead
zone on every list item.

Fenced code, tables, images and footnotes have no decoration yet and therefore render as source -
a deliberate floor, and one no two-engine design can offer.

**The editor opens markdown and nothing else.** Widening that - syntax colouring for source, config
and log files, under a setting naming which types the app takes an interest in - is specified in
`docs/specs/file-types.md`. None of it is built; the document is the design the work will be measured
against, not a description of this code.

## Links

**A link is never followed by navigating the window.** The window is frameless: no address bar, no
back button. A page loaded over the app has replaced the application with no way back to it, and has
been handed the app's own origin - which is the origin the preload bridge is exposed on. So the same
decision is made in three places, deliberately, because each is the last line for the one before it:

1. `packages/domain/src/markdownLink.ts` decides what a link MEANS. `linkAction(href, fromPath)`
   answers `external` (a web address), `document` (a markdown file in the workspace, resolved against
   the open document and returned as a workspace-relative path), `anchor`, or `none` with a reason.
   Pure, shared with the main process, and the only place the rules live.
2. The renderer intercepts the click. `lib/markdown.ts` marks every anchor it emits with
   `data-md-link` and a `title` carrying the target; `lib/markdownLinks.ts` is one delegated handler
   on the app root that matches that mark. Delegated rather than per-surface because the HTML is
   injected wholesale and there are no React elements to bind to - and matching on the mark rather
   than on a container's class means a surface that starts rendering markdown is covered without
   being told to be. A `document` result goes to `useWorkspace`'s `openPath`, which is the same code
   path as clicking a row in the folder browser, so the unsaved-changes prompt and the error banner
   behave identically either way.
3. The shell refuses anything that gets past both. `setWindowOpenHandler` denies every popup, and
   `navigationGuard.js` decides `will-navigate`: the app's own document may reload, a web address is
   handed to the browser, everything else does nothing.

Live mode is the exception that proves the shape. CodeMirror draws link text as a decorated span, not
an anchor, so the delegated handler cannot see it: `liveExtension.ts` writes the target onto the
decoration (`title` for hover, `data-link-target` for the click) and reports a modified click through
`onFollowLink`, which App feeds into the same `followLink`. The modifier is not optional there - Live
is an editing surface, and a plain click has to place the caret rather than leaving a dead zone in the
middle of a sentence. It is Ctrl away from macOS and Cmd on it, because Ctrl+click on macOS is a right
click.

The status bar's facts are **measured, not assumed**. `detectLineEnding` reports `Mixed` when a file
genuinely mixes them, because the strip presents these as claims about the user's document - and the
one thing worse than not showing it is showing it wrongly.

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

Order: local (**built**), OneDrive, Google Drive, Dropbox, GitHub.

`apps/desktop/src/localWorkspace.js` is the local backend. Two path checks, and both are needed:

1. The **lexical** guard (`createPathGuard`) rejects traversal, absolute, drive-relative and UNC paths
   before any syscall.
2. **`realpath`**, checked against the root again. The lexical guard cannot see symlinks - it has no
   filesystem access by design - and `notes.md` satisfies it perfectly while pointing at
   `/etc/passwd`. Creating a *new* file is the awkward case: it has no realpath of its own, so the
   parent directory is resolved and checked instead.

Both are covered by tests against real temp directories, including escapes through a junction. The
realpath check was verified by removing it and watching exactly those tests fail.

Saving is conditional. `write` takes the revision the caller last read, and a mismatch is a
**`conflict` result**, never an overwrite - in both directions, including "you thought you were
creating a file that now exists". The revision is mtime plus size, opaque to callers.

### The read boundary

The app decides what it can open from a file's NAME, which is a claim about a file rather than a fact
about it. `read` therefore checks the file itself, and the checks live in the shell because by the
time bytes have become a string the harm they guard against is already done. The rules are pure and
in the domain (`textFile.ts`), so the shell enforces the same limits the renderer explains.

- **Size, before the read.** Above `MAX_TEXT_FILE_BYTES` (16 MB) the file is refused as
  `too-large` **carrying its size and the limit**, a `ReadResult` variant of its own for the same
  reason `conflict` is one: the refusal is only useful if it has the numbers. The whole file becomes
  a string, crosses IPC and reaches CodeMirror, so a large enough file is not slow - it is an
  unresponsive window.
- **`not-text`**, from a NUL byte in the leading `BINARY_SNIFF_BYTES` (8 KB).
- **`unsupported-encoding`**, from a UTF-16 byte order mark or from a **strict** UTF-8 decode
  failing. `fatal: true` is the point of the whole exercise: without it, invalid bytes become U+FFFD
  and the corruption is invisible until the save writes the replacement characters over the
  original. A file the app cannot represent exactly is one it must not open, because the alternative
  on offer is a lossy copy sitting in an editor with a working Save button.

Order matters and is asserted: **UTF-16 is checked before the NUL sniff**, because UTF-16 ASCII is
every other byte NUL and the sniff would call a plainly-textual file binary. Unmarked UTF-16 is
indistinguishable from binary here and falls to the sniff, which is the honest answer.

A **UTF-8 byte order mark** is stripped on read, reported alongside the content, and put back on
write - read from the file on disk at the moment of writing, never carried by the renderer, which is
untrusted and has no business asserting a file's encoding. Returning the mark in the content instead
would put U+FEFF in front of the first heading, which then stops being a heading.

`read` takes its revision from the stat it took **before** reading, deliberately. If the file changed
in between, that revision is stale - and a stale revision makes the next save report a conflict,
where a fresh one would accept the save and overwrite whatever arrived.

## Window chrome

The window is **frameless**, and the renderer draws the title bar. Getting there differs by platform,
and the difference is not cosmetic:

- Windows and Linux: `frame: false`, and the renderer draws minimise, maximise and close.
- macOS: `titleBarStyle: "hiddenInset"`, keeping the traffic lights and hiding everything else.
  `frame: false` there would remove the traffic lights too, leaving a window with **no way to close it
  from inside the app**.

Both sides read the same `titleBarLayout` from the domain, so they cannot disagree about who draws the
controls - one set on every platform, never two and never none.

Two details that are easy to lose:

- **Drag regions are CSS classes** (`app-drag`, `app-no-drag`), not inline styles. jsdom drops
  `-webkit-app-region` silently, so a style assertion passes whether or not it was ever applied.
  Both classes are needed: a frameless window with no drag region cannot be moved at all, and a
  control inside a drag region cannot be clicked.
- **Window state is pushed, not polled.** `window:state` is the only channel flowing main to renderer,
  because a window can be maximised by ways the renderer never sees - a double-click on the bar, an OS
  snap gesture, a keyboard shortcut. It is schema-validated on arrival like everything else: main is
  trusted, but the schema is what stops a shape change surfacing as a button that quietly stops
  updating.

The title separator is a **plain hyphen**. The design specifies U+2014; the project bans em and en
dashes in user-facing text, and the guard test fails the build on one.

## The workspace tree

`treeRows` flattens a map of folder states into the rows to render. Pure, so what a filter hides, how
deep a row sits and which folder is still loading are all testable without a tree or a filesystem.

- **Status is per folder, never per panel.** A cloud listing can fail or hang for one folder while the
  rest are fine, so the failure is recorded on the row and rendered inline with a Retry. A spinner
  over the whole panel would hide the parts that worked.
- **Collapsing forgets descendants** (`withoutSubtree`). Keeping them means re-expanding shows the
  tree as it was however long ago, including files since deleted. It matches on `path + "/"`, so
  `docs` does not take `docs-archive` with it - the same prefix trap the path guard has.
- **Folders survive a filter, files do not.** What is inside an unexpanded folder is unknown, so
  hiding it because nothing visible matches would hide matches nobody has looked for yet. That also
  means the row list is never empty while folders exist, so the "no matches" message keys off the
  file count rather than the row count.
- **Counting is lazy, and that is measured rather than assumed.** A recursive markdown count took 5ms
  on this repo, 80ms on Diariz, and **40 seconds across 113,000 folders on a home directory** - which
  is a perfectly plausible workspace. The footer therefore counts what is on screen.

## File types

Which files the app takes an interest in. `packages/domain/src/fileTypes.ts` is the catalogue, as
DATA: id, translation key, group, extensions, whole filenames, the views the header offers, and a
`kind` that decides what editing one is like. It is in the domain because a stored setting names its
ids - the schema that reads settings, the tree that filters on it and the page that draws the
checkboxes must agree about which types exist, and three lists agreeing by hand are three lists that
will not.

**The setting is about scope, not performance.** A language's colouring loads on demand, so a
checkbox cannot buy back startup time. What it decides is what the folder tree lists, what the editor
opens and what chat can see - which is why the page is called File types and its wording talks about
the folder browser.

`isMarkdownFile` is gone; `isOpenable(name, enabled)` replaced it at all three widening call sites:
`treeRows`, `markdownLink` and `workspaceOutline`. **`launchTarget.js` and `explorerIntegration.js`
deliberately keep their own markdown-only lists** - registering `.py` under
`HKCU\Software\Classes\SystemFileAssociations` is a far larger claim on a user's machine than the
setting's wording makes, and the two lists there are the same on purpose so the app never acts on an
argument it did not ask to receive.

Four things that are easy to get wrong:

- **`fileTypes.enabled` is `z.array(z.string())`, never a `z.enum`.** A settings file written by a
  newer build names types this one has never heard of; a strict enum would refuse the whole file and
  take the user's panel widths, open folder and every configured model with it. Unknown ids are
  ignored where they are read and carried through untouched where they are written, including by the
  settings page's own toggle - so an upgrade and a downgrade do not each wipe the other's choices.
- **The default is `["markdown"]` for a fresh install and for the migration alike.** Adding a setting
  must not change what an existing installation does, and a fresh install disagreeing with a migrated
  one is a second kind of wrong.
- **Markdown is pinned**, and `enabledFileTypes` honours that whatever the stored list says. A
  hand-edited file must not leave a markdown editor unable to open markdown.
- **The catalogue invariant is one equality over the whole set**, not a check per type: every type
  can be well-formed while two of them claim `.m`.

`filenames` is in the shape from the start even though no type uses it yet. `Dockerfile` and
`Makefile` have no extension, and retrofitting a second matching rule through every call site later
is the expensive version of this.

### Turning a type into a language

`lib/languageLoaders.ts` maps each `FileTypeId` to a loader, and **every import in it is dynamic**.
Vite code-splits an `import()` into its own chunk, so a grammar reaches a user only when they open a
file that needs it. Measured: moving markdown onto this footing took the initial chunk from **1,019
KB to 825 KB** while adding six languages, which now sit in eight lazy chunks totalling ~238 KB.

`null` is a real answer - plain text needs no highlighting, and CodeMirror's default is already that.
The loader takes the file's NAME, because a type can have dialects: TypeScript and JSX are the same
package as JavaScript, configured differently. That is dialect selection within one type, not a
second type, which is why Settings has one row for all four.

**No eagerly-imported module may statically import a `lang-*` package.** `languageLoaders.test.ts`
asserts it over the module graph, comments stripped first (the module documents the rule it
enforces). The rule is invisible when broken: a static `import { python } from
"@codemirror/lang-python"` type-checks, renders perfectly and passes every other test while putting
a grammar table on every cold start.

`DocumentEditor` applies it through a compartment, in two steps whose ORDER is load-bearing:

1. Reconfigure to `[]` synchronously. The effect is declared **before** the one that swaps the
   document, and React runs effects in declaration order within a commit, so the previous file's
   parser is gone before the new file's text arrives.
2. Load, then reconfigure again - **guarded by the effect's cleanup flag**. Without it, switching
   tabs quickly applies whichever load resolves last, so a YAML file ends up parsed as TypeScript,
   and the failure is timing-dependent and therefore unreproducible.

A loader that rejects leaves the document open with no colouring. Uncoloured text is still readable.

### Behaviour by kind, and views by type

`behaviourFor(kind)` is one function because wrapping, spellchecking and bracket-closing all follow
from the same question - which is why `kind` is one field and not three. `prose` wraps and
spellchecks; `code` does neither and adds `closeBrackets` and `indentOnInput`. **Tab is deliberately
not rebound**: `defaultKeymap` omits `indentWithTab`, so Tab moves focus, which is the accessible
behaviour and the one somebody navigating by keyboard needs.

`EditorHeader` draws only the modes the type lists, and draws no switcher at all below two. The
formatting toolbar is markdown-only, since its buttons write markdown. `EditorPanel` falls back to
`MARKDOWN_FILE_TYPE` for three cases that look different and behave the same: the scratch buffer,
the built-in guide, and a file whose type was turned off while it was open in a tab - the last is
why this falls back rather than refusing.

The Source palette gained the standard code tags in the **same** `HighlightStyle`, not a second one:
markdown's tags and these barely collide, and one style means a fenced code block inside a markdown
document is coloured by the same rules as a standalone source file, which is what phase 5 needs.
Six tokens were added to `index.css` in all three theme blocks.

## Settings, and the panel layout

One settings file in the app-data directory - one shape to migrate, one place to look, and no chance
of two files disagreeing about which workspace was last open. It follows the chat-storage rule: never
in the user's workspace.

- **Reading is total.** A corrupt file, a file from a newer build, a file that is not an object -
  every one answers with defaults. None of this is the user's work, and refusing to start because a
  remembered panel width is malformed would be far worse than forgetting the width.
- **Writing is atomic**: a temporary file and a rename, so a reader sees the old file or the new one
  and never a half-written one. Settings are written whenever a panel drag settles, so "rarely" is
  not an argument.
- **Writes are debounced.** A drag produces a change per pointer move; waiting for it to settle
  writes once.
- **Nothing is written before the file has been read.** Until then the state is the DEFAULTS, and
  saving would overwrite a real settings file with defaults on every launch.

Settings are at **version 5**. A migration adds only what its own version introduced and touches
nothing else: a file written by 0.9.0 must arrive intact, because somebody's panel widths and open
folder are not worth losing over fields that did not exist yet. The chain runs end to end, so a
version 1 file passes through version 2's migration on its way forward - a file that skipped straight
to the current version would miss whatever version 2 added, which is the exact failure migrations
exist to prevent. Version 2 added appearance and window behaviour, version 3 added chat models, version 4 added the
system prompt, version 5 made that prompt nullable, version 6 added per-profile tool calling,
version 7 added the folder outline size, version 8 added the chat panel switch, and version 9 added
the editor's default view mode.

**Version 5 is worth reading as a warning.** Version 4 stored the default prompt's TEXT, which meant
every later improvement to it was invisible to anyone who already had a settings file - and the
release that taught the model to propose document edits reached nobody with an existing
installation, because their file still held the previous version's prompt. `null` now means "use the
built-in default", resolved at send time, so a change to the default reaches everyone who has not
written their own. An empty string is a third state: send no system message at all.

The version 5 migration releases a stored prompt only when it is byte-identical to a default this
app has shipped (`PREVIOUS_SYSTEM_PROMPTS`), because such a prompt was seeded rather than written.
Anything differing by a single character is somebody's own work and is left alone. That list should
stop growing: nullability is what removes the need for it.

The general rule the bug illustrates: **do not persist a copy of a value the app owns.** Persist the
fact that the user has not chosen one.

**`chat.showPanel` is the same shape, and exists for the same reason.** Whether the chat panel is in
the window is a nullable boolean, where null means "derive it from whether a model is configured" -
resolved by `chatPanelVisible`, which both the layout and the preference checkbox read so they cannot
disagree. A stored `false` for a new installation would have been the bug in miniature: the panel
would stay hidden through exactly the moment the user's first model made it useful. An explicit true
or false wins in both directions, and version 8's migration therefore writes null rather than
inferring a choice nobody made.

**Hidden is not collapsed.** A collapsed panel leaves a rail to bring it back, which is precisely
what a panel nobody has a model for must not offer; the layout is told the chat is collapsed so the
editor takes the width, and the rail is not drawn.

**`editor.defaultViewMode` is why `EditorMode` lives in the domain.** A stored setting names a mode,
so the schema that reads settings and the switcher that draws them have to agree about which modes
exist - and two hand-maintained lists are two lists that will drift. `apps/app/src/lib/editorMode.ts`
keeps only the part that is the renderer's own business: which translation key each mode reads from.

The panel resolves the mode as `chosen?.file === filePath ? chosen.mode : defaultMode` rather than
copying the setting into state. Settings are read from disk AFTER the panel mounts, so a copy taken
at mount would be the pre-read default and the stored preference would never arrive; storing the
document alongside the choice is what makes each document open in the configured view without an
effect that renders the wrong one first and corrects it after.

## The settings dialog

One dialog, a page per subject, mounted only while open - so `openOn` means "open here" (the title
bar opens Appearance, the Help menu About, the chat panel's Configure the models) and a half-typed
model does not survive being closed. `lib/settingsSections.ts` holds the page list and its label
keys, so the rail, the heading and the routing read one list.

**Settings apply as they are chosen. There is no Save button, deliberately.** Each setting is a
single value, so a confirm step would only add a way to lose the change you just made - and the
theme, which you are looking at while you choose it, would either preview and make Cancel a lie
about what is on screen, or not preview and make the choice blind. A chat profile is the exception
and `ChatProfileForm` says why: it is several fields that are only valid together, and saving
settings sweeps API keys for endpoints no profile references, so applying each keystroke would
delete the user's key partway through typing an endpoint.

**There is one About surface.** The capability table is kept in step with the README and
`docs/features.md` by hand, so a second rendering of it elsewhere in the app would be a third thing
to remember and the first one to go stale.

**Chat models start empty rather than seeded.** There is no endpoint every user has, and a profile
pointing somewhere that does not answer is worse than an empty list, which at least says what to do
next. **The system prompt is the opposite**: it is seeded with `DEFAULT_SYSTEM_PROMPT`, because chat
that arrives unconfigured otherwise answers like a general chatbot rather than like a markdown
editor. A prompt somebody has cleared stays cleared - only a file predating the field is seeded,
which is the difference between a migration and a default.

**Close-to-tray needs an `isQuitting` flag.** Without it the preference makes the app unquittable:
every close hides the window, including the one during shutdown.

`resolvePanelWidths` decides who yields when the window is too narrow, and it is never the editor - a
person can work with a cramped file list and cannot work in a cramped document. Below the point where
even the minimums fit, the panels collapse entirely rather than squeezing the editor out of existence.

The available width is measured **before the first paint** and observed afterwards. ResizeObserver
fires after paint, so relying on it alone gave a first frame with nothing to divide up: every panel
resolved to zero and the layout visibly snapped into place a moment later.

## Chat models, and where the keys live

A chat model is a **profile**: a display label, an OpenAI-compatible endpoint, the model slug that
endpoint expects, and optional generation parameters. `ChatProfileSchema` is `.strict()` and has no
`apiKey` field, so a key that somehow reached a settings file is a loud parse failure rather than a
field silently stripped and written back out on the next save.

Two invariants belong to the list rather than to any profile, and so live in `ChatProfileListSchema`
where the settings parser sees them too: **ids are unique**, and **at most one profile is the
default**. Left to the standalone parser alone, a hand-edited settings file with two defaults would
load happily and the picker would start on whichever one the UI reached first.

**Keys never touch the settings file.** They live in `chatKeys.json` in the app-data directory,
encrypted with Electron `safeStorage` - DPAPI on Windows, the Keychain on macOS - and keyed by
endpoint rather than by profile, because two models at the same provider are one account. The file
carries a `schemaVersion` like everything else the app persists, and a version it does not recognise
reads as "no keys" rather than being guessed at.

Four rules, each of which is a test in `apps/desktop/test/`:

- **Ciphertext or nothing.** If `safeStorage` cannot encrypt, the write **fails** and the failure is
  reported to the user. It never falls back to plaintext, which would put a live key in a readable
  file on exactly the machines least able to protect it, silently.
- **`getKey` is main-process only, and no IPC channel returns a key.** The renderer asks which
  *endpoints* have one. `secretsIpc.test.js` proves this by calling every registered handler with
  payloads shaped to draw a key out and failing if one appears in any response - so a future handler
  that returns settings-plus-keys fails without anyone having thought to test for it.
- **An unreadable blob reads as "no key".** `safeStorage` blobs are bound to the machine and the OS
  user, so restoring a profile onto a new machine invalidates every one at once. That must be a
  missing key, not a crash on the path that opens the chat panel.
- **Saving settings sweeps keys nothing references.** Deleting a profile or repointing its endpoint
  would otherwise leave a live credential on disk for a provider the app no longer knows about, with
  nothing in the UI able to remove it.

`normaliseEndpoint` decides when two URLs mean the same provider, and lives in the **domain** because
both processes ask: the shell stores under that form, and the renderer uses it to decide whether to
show "Key stored". Two implementations differing by a trailing slash would put the badge on the wrong
profile - the key stored, working, and reported missing.

Profiles are edited in a **form with a Save**, unlike every other preference, which applies as soon as
it is chosen. A profile is several fields that are only meaningful together: an endpoint typed one
character at a time is invalid for most of its life, and because saving settings sweeps unreferenced
keys, applying each keystroke would delete the user's key around the third character of a URL they
were part-way through typing.

## Chat, and how a reply gets to the screen

**The provider call happens in the main process. Always.** The renderer sends a turn and receives
tokens over IPC; it never holds the API key and never opens a socket to a provider. A key in the
renderer is a key in devtools, in the network panel, and in any renderer crash dump. Do not move the
call across that boundary to stream more simply.

The path, end to end:

1. The renderer calls `chat:send` with a **profile id**, the conversation so far, and the
   **context** - the document, the selection, or `{ kind: "none" }`.
2. The main process looks the profile up **in the settings it already holds**. The renderer never
   names an endpoint - the same rule that stops it naming a workspace root, and what keeps a stored
   key out of reach, since keys are stored per endpoint.
3. `composeMessages` assembles the request: the system prompt from settings, then the
   conversation, then the document immediately before the question it belongs to.
4. `chatProvider.js` POSTs to `{endpoint}/chat/completions` with `stream: true`, adding the key as a
   bearer token if one is stored. **No key is not an error**: a local model served by Ollama or
   llama.cpp needs none, and refusing would make the most private way to use Trypthos the one way
   that does not work.
5. Frames are decoded by `createSseDecoder` (domain, pure) and read by `parseStreamPayload`.
6. Each event is pushed to the renderer on `chat:event`, tagged with a **stream id**.

### What the model is told about the document

`resolveChatContext` decides, and the rule is deliberately small: **a selection if there is one,
otherwise the whole file, otherwise nothing.** A selection is an explicit act, so it replaces the
file rather than being added to it - sending both would spend the tokens twice and leave the model
guessing which the question was about.

Four things about it are load-bearing:

- **The renderer resolves it, because only the renderer has the live buffer.** The file on disk is
  not what the user is looking at once they have typed into it. The main process re-validates the
  shape and the size rather than trusting what arrives.
- **The size cap is in characters, not tokens.** Nothing here can count tokens - that needs the
  provider's tokeniser, and profiles point at arbitrary endpoints. The beginning is kept, because a
  document says what it is in its first lines, and the model is told it was cut.
- **`context` is required, never optional.** A missing field would read as "no context" for both a
  deliberate choice and a renderer that forgot to send it, and the difference between those is a
  chat that quietly stops seeing the document.
- **The document is a `user` turn, fenced and labelled as data.** A markdown file can contain text
  addressed at an assistant, so the message says so and the system prompt says it again from the
  other side. The fence is a delimiter no ordinary document produces - ``` is far too common in a
  notes app, and a document appearing to close the block early would leave the rest reading as
  conversation.

Selection is reported by CodeMirror through `onSelectionChange`, including when it empties - which is
what makes chat fall back to the file rather than sending the last selection for ever. Preview mode
has no CodeMirror and reports none, so chat sends the whole file there. That behaviour is tested in
the **browser** suite: synthetic events do not move CodeMirror's caret, so the jsdom version of those
tests would report an empty selection for ever and pass anyway.

Four rules hold this together:

- **`end` is always the last event**, error or not, so the panel has one signal that a turn is over
  rather than two shapes of ending to get right. A stream that closes without `[DONE]` still ends.
- **Reasoning is a separate channel, and a turn can end with only reasoning in it.** gpt-oss,
  DeepSeek-R1 and Qwen thinking modes stream their chain of thought as `delta.reasoning` or
  `delta.reasoning_content`, and sometimes finish having sent no `content` at all - measured at
  roughly half of runs against one local model, at any temperature. That is a habit of the model
  rather than a fault in the request, so the panel says the model wrote no answer and offers its
  thinking, instead of rendering an empty bubble. Reasoning is never added to `turns`: those are the
  wire format and are resent every message, and a model's own thinking is not part of the
  conversation.
- **Every event names its stream.** A reply the user stopped, or one belonging to a conversation
  they have since cleared, would otherwise append itself to whatever they typed next.
- **Tolerant outward, strict inward.** A provider's chunk is parsed loosely and an unrecognised shape
  is *ignored*, because a provider adding a field must not end a reply mid-sentence. Our own IPC
  payloads are `.strict()`, where an unexpected field means the two sides have drifted.
- **No error message repeats the key.** Every message is written locally from the status code; a
  provider's own body is never forwarded, because some echo the rejected key back in it. An error
  message is shown, logged, and pasted into bug reports.

The renderer's half is `useChat`, deliberately separate from the panel so the awkward cases - a late
token, a retry that drops the answer it did not like - can be tested without rendering anything. The
panel itself is a port of Diariz's, including the send button that becomes a stop button in the same
place: an endpoint that accepts a request and then goes quiet is otherwise a panel that looks broken
with no way out. Replies go through the same `renderMarkdown` as Preview mode, sanitised: a model's
output is text the app did not write, and is treated like a file from the workspace.

`chatProvider.live.test.js` runs the same code against a **real local HTTP server** - Node's `fetch`,
a real `ReadableStream`, bytes arriving in whatever pieces the socket delivers. That is what catches
the class of bug a fake reader cannot produce, such as a multi-byte character split across two reads
decoding as two replacement characters.

### How full the context is, and why it can only be an estimate

`contextUsage.ts` answers "how much of the window will this request use", and every surface that
shows the answer says "about". **There is no tokeniser to ask.** A profile points at an arbitrary
OpenAI-compatible endpoint; the endpoint reports its own count in the reply, which is after the
question the dial exists to inform. Four characters to a token is the same rule of thumb
`CONTEXT_CHARACTER_LIMIT` is set from - close on English prose, worse on code.

It counts `contextTurns(context)` rather than the raw document, deliberately: the fences and the
explanations wrapped around a file are real tokens the user pays for, and a dial counting different
text from the request would be worse than no dial.

The work is split in two because of where the inputs live. `contextTokens` is the expensive half -
it builds that framing over a document that can be sixty thousand characters - and `App` memoises it
on the document, the conversation and the prompt. `contextUsage` is the cheap half, and `ChatPanel`
calls it on every keystroke to add the draft, which is the part it owns. `App` resolves
`scope.context()` for the dial even though the request resolves it again at send time: the callback
exists so a turn sees the buffer AS IT IS THEN, and the dial has to answer before that.

**The total is a per-profile setting, not a detection.** `contextWindow` is nullable and never
guessed, because no endpoint will say how large its window is; null means the ring cannot be filled,
which the hover states rather than papering over with an invented total.

### Writing back into the document

A reply can carry a **proposed edit**, and the user applies it. Three questions decided this shape:

**Why not provider tool calling as the primary mechanism?** Trypthos points at any OpenAI-compatible
endpoint, and tool support across that space is patchy - Ollama varies by model, llama.cpp is
inconsistent, proxies strip it. The failure is silent: a model without tool support answers in prose,
so a tools-only design would quietly do nothing on a good share of the endpoints somebody might
configure. A fenced block works everywhere, streams as ordinary text, and needs no capability.

**Why not commands?** A command cannot express "before the Objectives heading". Enumerating a command
per edit shape gets the interesting part of the request backwards.

**Why does it never apply itself?** The document is in the model's context, and a markdown file can
contain text addressed at an assistant. An edit that applied itself would make "treat file contents
as data" unenforceable - a line in someone's notes becomes a write. The click is the enforcement.

The pieces:

| Module | Holds |
| --- | --- |
| `documentEdit.ts` | The edit model, heading discovery, and resolving an edit to a range |
| `editBlocks.ts` | Reading a proposed edit out of the reply text |
| `ChatEditCard.tsx` | The card: what would change, where, and the Apply button |
| `DocumentEditor` handle | `applyChange(from, to, insert)` - one transaction |

Five rules, each a test:

- **Resolution happens at apply time, against the live document**, and again on the click itself.
  Between the reply and the button the user may have renamed the heading, so an offset computed from
  the text the model saw could land anywhere.
- **Ambiguity refuses.** Two headings with one name means the edit does not apply. Taking the first
  would write into the wrong section while looking like it worked.
- **Fenced code is not searched for headings.** A markdown editor's documents are full of shell
  samples, and `# not a heading` inside one would otherwise be an anchor.
- **One CodeMirror transaction**, so an unwanted edit is one Ctrl+Z. It also reaches `onChange` and
  marks the file dirty - it edits the buffer, never the disk.
- **A block that cannot be parsed stays ordinary text.** The user sees the markdown and can paste it
  by hand, so a model that gets the format wrong costs a copy and paste rather than the answer. That
  is the same graceful floor Live mode uses for an undecorated construct.
- **The parser is forgiving about how a block ENDS, and strict about what it means.** Models close a
  fence by appending the backticks to the last line, or forget to close it at all; both are accepted.
  An unrecognised operation or empty content is still not an edit.

### The second transport: provider tool calling

Opt in per profile with `supportsTools`. Where an endpoint supports it, the edit is offered as a
function the model calls, which removes the variance in how reliably a model follows a format
described in prose. Three things decided the shape:

- **The two transports converge.** A completed tool call is turned into exactly the block the fenced
  transport produces, by `formatEditBlock`, and emitted as ordinary tokens. Downstream there is ONE
  representation of a proposed edit - the panel, the card, resolving the anchor and applying it are
  all untouched by this transport existing. `splitReply(formatEditBlock(edit))` returning the edit
  unchanged is a test, not a hope.
- **Structured output, not an agentic loop.** The tool call IS the proposal. No result is sent back,
  the conversation does not continue on its own, and nothing is applied without the user pressing
  the button.
- **Off by default, and never detected.** There is no reliable way to ask an OpenAI-compatible
  endpoint whether it supports tools: several accept a `tools` array, ignore it, and answer in
  prose, which is indistinguishable from a model that chose not to call one. The fenced transport
  works everywhere, so the default is the one that always works.

**`heading` is a required parameter even though three of the five operations ignore it**, with an
empty string standing in for "none". That is a measurement rather than a preference: listed as
optional, a local model asked to insert before a named heading omitted it in four runs out of six,
and every one of those proposals was unusable. Required, with the convention spelled out in its
description, it was six out of six. Models fill required fields; they skim prose about when a field
applies.

Arguments arrive as a JSON object streamed as a string, so every prefix of one is invalid JSON and
only the last is not. The provider accumulates by call index and parses at the end of the turn. A
call that never finished, or asks for an operation nobody recognises, is dropped in silence: the
reply already on screen is worth more than the proposal that failed to arrive.

Settings reached **version 6** for the profile flag. The schema defaults it, so an old file would
load either way - the bump is for the other direction. `ChatProfileSchema` is strict, so a file
written by this version and read by the previous one would fail to parse and take every configured
model with it; a version it does not recognise is refused cleanly instead.

`splitReply` takes `complete`, which says whether the reply has finished arriving, and it changes
exactly one thing: mid-stream an unterminated fence is a cut-off reply and stays text, because a card
built from it could be applied with half a sentence in it. Once the turn has ended it is a model that
forgot the fence. The panel only builds cards for finished turns for the same reason, and renders a
streaming reply as plain text until it lands.

**The parser's own tests were written against the format, which is a fixture bias**: they proved it
accepts what the documentation describes and said nothing about what models emit. The cases that
matter came from the raw stream of a local model answering the request this feature exists for.

`systemPrompt.test.ts` parses the prompt's own worked example with the real parser. Nothing else
checks that the format the prompt teaches is the format the parser accepts, and a drift there has
only downstream symptoms: the model does exactly as instructed and the panel renders an inert code
block.

### Saved conversations

Plain JSON files in the app-data directory, one per chat, pretty-printed - inspectable and greppable
is the reason this is files rather than a database. Deliberately **not** in the workspace: writing
into a folder the user curates would put files they did not create into their tree, and into a
cloud-synced folder would invite sync conflicts on files they never asked to sync.

The cost of that choice is the design's only real complication: **a chat references a workspace and a
file it does not own.** By the time it is opened again the file may be renamed, deleted, or in a
folder that is not open. None of that stops the chat opening - it is the user's own words - so the
panel reports the broken reference instead.

Three rules:

- **A chat's id becomes its file name, and the id arrives from the renderer.** That is the security
  surface: an id that escaped the chats directory would read or overwrite any file the user can. It
  is validated as a UUID before anything touches disk - a shape check rather than a hunt for
  dangerous characters, which is the version that stays correct as new ones are invented. The main
  process generates the id, so the store's check is the last line rather than the only one.
- **Reading is NOT total, unlike settings.** There is no default conversation. A file that cannot be
  read is reported missing rather than replaced with an empty chat, which would look exactly like a
  conversation that had been lost. One corrupt file is skipped when listing, so it cannot cost the
  user the rest of their history.
- **The list carries no conversations.** Summaries only: drawing a menu should not mean reading every
  word of every saved chat.

The title is derived from the first question rather than asked for. A dialog demanding a name before
a chat can be saved is a dialog people learn to dismiss.

### Beyond the open document

Context has three parts, answering different questions: the **document** (a selection, else the open
file), **attachments** the user picked, and a **folder outline**.

**The outline carries paths, never contents.** A notes folder can be thousands of files; sending them
would blow any context window, cost real money on a hosted endpoint, and bury the document the
question was about. Paths are cheap, and they turn "I don't know what you have" into a conversation
the user can steer: the model names a file, the user attaches it.

**The walk happens in the main process, and is capped.** Measured on a home directory, a recursive
walk took 39 seconds across 113,553 folders - which is why `workspaceOutline` is breadth-first,
stops at `OUTLINE_PATH_LIMIT`, skips hidden directories and never descends into `node_modules` and
its kin. Truncation is reported, so the model is never left implying it saw everything. The root
comes from the workspace the main process holds, never from the renderer.

**One budget, and the document is served first.** An attachment that would push the open file out
would answer about the wrong text entirely, so the document takes what it needs and attachments take
what is left. An attachment there was no room for is still NAMED with empty contents: the model
knowing a file exists and that it did not see it beats silence, which reads as "there was nothing
there".

`contextTurns` returns several messages rather than one - outline, then attachments, then the
document - and `composeMessages` keeps them together immediately before the question. Each is a
`user` turn, fenced and labelled as data, for the same reason the document always was.

Attachments are read once, when attached. Re-reading them silently would change what an earlier
answer in the same conversation was about.

### The read loop

`get_file_contents` is **executed**, and that makes it different in kind from `propose_edit`. A
proposal is structured output - the call IS the answer, nothing runs, the user presses a button. A
read is carried out by the app and the result sent back, so the model can read a file and keep
going. Chat is a loop from here on, and the bounds are the design:

- **The allowlist is recomputed in the main process, never taken from the request.** The renderer's
  copy of the outline came from this same function; trusting it back would let a renderer widen what
  the model may read by sending a longer list. The workspace provider then resolves the path against
  the open root, so an allowed name still goes through the boundary check every other read does.
- **A refusal is told to the model, not turned into an error.** It can pick a different file or
  answer without one, and a turn that ended on the model's first bad guess would be worse than one
  that continued.
- **`MAX_READS_PER_TURN` caps the loop.** Each read resends the whole conversation, so an unbounded
  loop is an unbounded bill on a hosted endpoint and an unbounded wait on a local one. At the cap
  the model is told plainly to answer with what it has, and the tool is withdrawn from that last
  request so it cannot ask again - being cut off mid-thought would produce an answer written as
  though the files had arrived.
- **The loop's own messages never leave the turn.** `ChatTurnSchema` has three roles and no
  `tool_calls`, deliberately: the assistant-with-tool-calls and `tool` messages exist for the length
  of one request, and letting them into that schema would let them into a saved conversation and
  into the history resent for ever after.

The read tool is offered only when a folder outline was sent. With nothing to read from, offering it
would invite calls that could only be refused.

**The outline is one level.** Not a recursive walk - measured at 39 seconds across 113,553 folders on
a home directory, and the result was far too long to be a menu. It is sorted, so the same folder
produces the same menu twice running: without that, which files the model could read would drift
between turns with nothing having changed. `settings.chat.folderFileLimit` sets how many it names,
defaulting to ten, because every entry is a file the model might ask for.

**What chat does not do yet:** it cannot read files in subfolders, and cannot write to any file
without the user pressing Apply.

## Unsaved changes, across the process boundary

The one thing this app can destroy is somebody's own writing, and the paths that could are the ones
that discard a document: closing its tab, opening another folder, and closing the window. **Opening
another file is no longer one of them** - it opens a tab beside the first, and switching between them
discards nothing, which is the whole point of the tab strip.

**`mayDiscardOne` is the single implementation**, and `mayDiscard` is it applied to every unsaved
document in tab order. `useWorkspace` owns both, every renderer path calls them, and the shell asks
the renderer before closing - three prompts would be three chances to get it subtly different, and
the one that was wrong would be the one that lost a file. They return false on cancel, and **false on
a failed save**: `save()` answers a boolean for exactly this reason, so a conflict cannot read as a
save and let the document be thrown away. A window close asks about each unsaved document in turn and
**stops at the first cancel**, since carrying on would shut the window on documents nobody had been
asked about yet.

**The split across the boundary is forced by where the facts live.** The renderer owns the document
and the dirty flag; the main process owns the window and its `close` event. So the renderer reports
the flag (`document:dirty`), the shell keeps a copy only to know whether a close is worth
interrupting, and when it is, the shell asks (`window:closeRequested`) rather than deciding. The
renderer answers by closing the window itself with `force`, which is what stops the shell asking
again and the window never closing.

The prompt itself is native and lives in the shell (`closeGuard.js`), shared by every path through
`document:confirmDiscard` - including the renderer-only ones, so there is one wording. **The request
carries the document's name** (`ConfirmDiscardRequest`, validated in the main process like every
other payload), because several documents can be unsaved at once and "this document" would be asking
about work the user cannot identify. The name is nullable: a window close that reaches the prompt
without one still reads as a sentence. The shell shortens a preposterous name rather than trusting
it - it is renderer input, and a native dialog sizes itself to its message.

**Three policies meet on the `close` event**, and `closeDecision` states the order once rather than
leaving it to the order of the `if`s in `main.js`: a forced close wins outright; close-to-tray hides
and so never asks, because nothing is being discarded; otherwise unsaved work is asked about. A quit
that is then cancelled clears `quitting`, or the next ordinary close would skip the tray.

## File Explorer integration

Explorer verbs are registry keys, so `apps/desktop/src/explorerIntegration.js` writes them with
`reg.exe` through an injected runner - no native module, no installer scripting, and the whole shape
is assertable as data on a machine that is not Windows. Everything lives under **HKCU**: per-user keys
need no administrator rights and cannot be left behind in somebody else's account.

**The registry is the only record of whether the entries exist.** There is deliberately no setting -
a stored copy would be a second answer that disagrees the moment a user removes the keys by hand, and
the switch would then show "on" for a menu entry that is not there. `shell:integration` reads and
`shell:setIntegration` writes, and both answer with the state that FOLLOWS, read back rather than
assumed. Registration is refused unless the app is packaged: in development `process.execPath` is
Electron's own binary, which cannot start Trypthos from a path alone.

A launch carries a path. `launchTarget.js` splits that into two questions - which argument is a path
(pure text) and what is at the end of it (a `stat`) - so only the second needs a fake. A **file**
resolves to a folder AND a document, because every path this app handles is relative to one open
folder. The result is pushed to the renderer (`shell:openTarget`) rather than acted on in the shell:
the renderer owns the open documents and is the only side that can ask about unsaved work before
another folder replaces them. A target that arrives before the page has loaded is queued, since a
message sent to a loading page is a message nobody receives, and `second-instance` carries the
arguments of the launch that lost the lock so a second right-click reaches the running window.

## Menus

**A frameless window on Windows has nowhere for a menu bar to go.** The menu bar belongs to the frame
that is not there, so Electron draws none. The renderer draws the File / Edit / Tools / Help labels
in its own title bar, and clicking one asks the main process to `Menu.popup()` a real native menu
under it - native rendering, native accelerator text, and the native edit roles, in a window that
draws its own chrome.

macOS is set once with `Menu.setApplicationMenu`: the application menu lives in the system menu bar
whether or not the window has a frame. Windows and Linux get `null` rather than an unused menu, which
would otherwise leave stray Alt-key behaviour for a bar nobody can see. `titleBarLayout.drawsMenuBar`
carries the difference, beside the same decision about window controls, so the two processes cannot
disagree.

The macOS menu is a **different shape**, not a translation: the platform expects About, Settings and
Quit in an app menu named after the app, so Tools - which exists on Windows only to hold Settings -
is not built there at all.

Three rules:

- **Roles, not hand-rolled clipboard calls.** `cut`, `copy`, `paste` and `selectAll` act on whatever
  has focus through the platform's own editing machinery. Written as custom items firing clipboard
  APIs they would work in a plain input and silently not in CodeMirror, or the reverse.
- **No item is a second implementation.** A menu item the renderer carries out sends an ACTION over
  `menu:action`, and the renderer drives the same open, save, preferences or about that its buttons
  and shortcuts already use. The main process keeps only what the renderer has no business
  arranging: quitting, closing the window, and the update check. Help's Markdown Syntax Guide is an
  action for the same reason: the guide is a read-only document in the editor, which is the
  renderer's business - the shell knows only that the item was chosen.
- **The renderer never says what is on a menu.** `menu:popup` carries a menu NAME and a coordinate;
  the items and their click handlers are built in main, so a page cannot invent either.

The templates are plain arrays until Electron builds them, which is what makes them testable without
a window - `menus.test.js` asserts what is on each menu, which items use a role, and which are
enabled, with no Electron in the process at all.

### Spellchecking, and the way it fails silently

`spellcheck: true` on the window turns the machinery on, but what is actually checked is a **list of
languages**, and an empty list is not an error: nothing is underlined, no suggestion is ever offered,
and the right-click menu has no spelling section - which on screen is indistinguishable from prose
with nothing wrong in it. `src/spellcheck.js` guards exactly that, and only that. It steps in when
Electron resolved no languages at all, falling back from the app locale to another dialect of the
same language to English, and it never throws: a window that cannot spellcheck must still open.

It does nothing on macOS, where spellchecking goes through the OS, which owns its own language list -
setting one there is an error rather than a preference.

CodeMirror sets `spellcheck="false"` on its content element, so the editor overrides it back
(`DocumentEditor.tsx`). The chat box and the system prompt say `spellCheck` out loud for the opposite
reason: they inherit the right answer from the browser, and saying so is what makes a later
`spellcheck="false"`, copied in from a form field, a visible change rather than a silent one. Fields
holding an endpoint, a model slug or a key are deliberately left alone - a URL is not prose.

### The right-click menu

Registered on the window's own web contents rather than through the preload bridge, because **the
spelling information only exists there**: Electron reports the misspelled word and its suggestions on
the `context-menu` event itself, and there is no way to ask for them afterwards. The renderer never
sees them and does not need to.

The template is built from what was clicked, and an empty template is a real answer - a right-click
on a plain paragraph with nothing selected opens nothing, rather than a menu of dead items.

**CodeMirror sets `spellcheck="false"` on its content element**, so the editor is an explicit
override in `contentAttributes`. Without it the app's main text surface would be the one place with
no corrections while the chat box and settings fields had them, and nothing would say why.

## The IPC surface

Every channel is listed in `packages/domain/src/ipc.ts` and exposed by name in the preload bridge.
The list is asserted exactly in a test, so adding one is deliberate rather than incidental: workspace
(`workspace:open`, `workspace:reopen`, `workspace:list`, `workspace:outline`), files (`file:read`,
`file:write`), window (`window:minimize`, `window:toggleMaximize`, `window:close`), documents
(`document:dirty`, `document:confirmDiscard`), settings (`settings:read`, `settings:write`), keys
(`secrets:list`, `secrets:set`, `secrets:delete`), chat (`chat:send`, `chat:cancel`) and its saved
conversations (`chats:list`, `chats:load`, `chats:save`, `chats:delete`), menus (`menu:popup`) and
links (`shell:openExternal`). Three channels flow the other way, all validated on arrival like
everything else: `window:state`, `chat:event` for streamed reply tokens, and `menu:action`.

Three properties do the work:

- **No channel reads a stored API key**, and there must never be one. See the section above.

- **Every payload is parsed with the shared schema in the main process**, before anything happens and
  before the open-workspace check. A malformed payload is a protocol error whatever the app is doing,
  and reporting it as "no workspace open" sends whoever is debugging it to the wrong place.
- **The renderer cannot name a workspace root.** It can only ask the user to choose one; the main
  process holds the result. A renderer that could name its own root could name any directory on the
  machine.
- **`shell:openExternal` is an allow-list, checked in the main process.** `OpenExternalRequest`
  accepts `http:`, `https:` and `mailto:` and refuses everything else, using the same `isExternalUrl`
  the renderer used - one function, so the two answers cannot drift. What is on the other side of that
  handler is the operating system's protocol handlers: `file:` reads anything on the machine, and
  Windows registers several (`ms-msdt:`, `search-ms:`) that do considerably more than open a page. A
  deny-list would be wrong here in the way deny-lists usually are - the dangerous schemes are the ones
  nobody thought of.

The renderer's own state machine is `apps/app/src/hooks/useWorkspace.ts`, deliberately separate from
the panel so the interface can be redesigned without touching behaviour, and so the awkward cases -
a conflicting save, a file that vanished, the browser preview with no filesystem at all - can be
tested without rendering anything.

It holds a **`DocumentSet`** (`packages/domain/src/openDocuments.ts`): every open document with its
own text, revision and dirty flag, plus which one is on screen. The set is pure domain logic, so the
rules that are easy to get wrong and invisible when they are - which tab is selected after a close,
whether a second click on an open file reads over unsaved work, whether editing one document marks
another - are answerable without rendering an editor. `file`, `content` and `dirty` remain on the
hook's state as **derived** values for the document on screen, so nothing above has two answers to
"which file is this". The scratch buffer is a field of its own rather than a document: it is nowhere
on disk, so it is never dirty and has no save path to be wrong about, and closing the last tab
returns to it with whatever was typed into it still there.

Two consequences worth stating. **A save names its document** (`save(path?)`), because closing a
background tab has to write that tab rather than the one on screen. And **opening a workspace closes
every tab**: the paths are workspace-relative, so carrying them across would leave them pointing at
files that are not in the new folder.

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

About - now a page of the settings dialog rather than a box of its own - reads `lib/appInfo.ts`
instead, which is why the capability table lives there and not beside the release notes. The settings
dialog is eager, so an `import` of the release notes from any of its pages would put the whole history
on every page load.

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

## Updates

Two paths, because they are different problems. **Windows** uses `electron-updater`, which installs in
place. **macOS cannot**: Squirrel.Mac refuses to update an unsigned app, so it checks the GitHub
releases API directly and downloads and opens the matching `.dmg` itself instead (see "downloading
the installer itself" below) - honest about what it can do, rather than failing part-way through an
install.

Two consent models, which is why `check` takes a trigger:

- **startup** shows a notification. The click IS the consent, so the download starts with nothing
  further asked. Finding nothing says nothing - an app that announces being up to date every launch
  trains people to dismiss it unread.
- **manual**, from the tray, answers either way and asks before spending ~110 MB.

`pickUpdate` takes the **highest** newer release, not the first newer one listed, and ignores drafts,
prereleases and tags that are not `Major.Minor.Build`. The comparison is numeric: `0.10.0` sorts
*before* `0.9.0` as text, so a string compare would tell someone on 0.9.0 that 0.10.0 was older - a bug
that only appears once the minor version reaches double figures.

**Windows drops every toast unless the process announces an App User Model ID matching a Start Menu
shortcut.** The installer sets the shortcut's from `appId`, so `main.js` must announce the same one -
a mismatch shows nothing and reports nothing. A packaging test compares the two, because the failure
has no symptom to notice.

**A notification can be accepted and then not delivered.** Windows answers `isSupported()` with true
and declines afterwards if the user has notifications switched off, which is not observable except
through the `failed` event. The updater therefore remembers what it found and the tray offers it -
otherwise the startup check is silent and dead for anyone in that state, which is not rare.

A development build never checks. Its version is whatever the repo says, so every run would announce
an update to the release matching the source already checked out.

The tray icons are **the app icon's own artwork**, generated by `make-tray-icon.mjs` from the same
`iconAssets.mjs` that draws the taskbar and Dock icon - there is no separate tray drawing to keep in
step. Per platform, chosen by `trayIconFileFor` in `tray.js`:

- **Windows reads `tray.ico`**, packed with `packIco` from the 16, 20, 24, 32 and 48px renderings.
  The notification area asks for a different size at each display scaling (16 at 100%, 20 at 125%,
  24 at 150%), and a single PNG resampled by the shell to 20px looks exactly like that. Sizes up to
  24 use the flat "small" variant; from 32 the gradient and fold return.
- **macOS reads `trayTemplate.png` and its `@2x` sibling**, the Windows tile in silhouette: opaque
  white with the page cut out through an SVG mask, because a Template image is recoloured by the menu
  bar from its alpha channel alone. Both are the 16-point artwork - the @2x file is the same small
  design at 32 pixels, not the 32px design, the same rule the ICNS "@2x" slots follow.
- Anywhere else, `tray.png` at 32px.

They are packed as `extraResources` **by name** (`tray*`), not into the asar - Electron's `Tray`
reads its icon from disk and cannot open an archive, and an icon packed inside produces a tray with
no icon at all. The filter is by name rather than `*.png` because `build/` also holds the app icon
files, which electron-builder consumes at build time and which have no business in every install.

**Revealing the window is one routine.** `revealWindow.js` restores a minimised window, shows a
hidden one and focuses it, and is what the tray click, the tray's "Show Trypthos" item and the
`second-instance` handler all call. They used to disagree: a second launch restored a minimised
window but never showed a hidden one, so with close-to-tray on, launching Trypthos again did nothing
visible - focusing a hidden window is a no-op, and nothing said so.

## Updates: downloading the installer itself

Finding an update used to end at the releases page, leaving the user to find and click the right
asset themselves. It now ends with the correct file already downloaded and opened - on Windows,
`electron-updater` still does this end to end (download, then install in place on restart); on
macOS, where Squirrel.Mac refuses an unsigned build, `updater.js` fetches the matching `.dmg`
directly from the release and opens it, which mounts the disk image exactly as a manual download and
double-click would.

`downloadAssetFor` (domain, pure) picks the asset: an **exact name match** against
`electron-builder.config.cjs`'s own `artifactName` templates
(`Trypthos-Setup-<version>.exe`, `Trypthos-<version>-arm64.dmg`), never "ends with .exe" - both
installers ship a same-extension `.blockmap` sidecar beside them, and matching by extension alone
would happily hand the user that instead of something they can run.

**Every failure falls back to the releases page**, not silence: no asset published yet for this
platform, a network error fetching it, or the OS having nothing registered to open the downloaded
file with (`shell.openPath` reports this as an empty-vs-non-empty return string, not a rejected
promise - there is no exception to catch, only an answer to check). The file is already on disk by
the time `openPath` runs, so a failure there is "could not open it", never "could not get it" - the
two are logged and handled as the separate failures they are.

**Windows falls into the same path** if `electron-updater` itself is unavailable or its own download
fails, rather than being stranded on the fallback webpage the moment the in-place path cannot answer -
one behaviour serving both "no signed auto-update" (macOS, permanently) and "auto-update broke this
time" (Windows, occasionally), not two.

**`downloadUpdate()` needs `checkForUpdates()` called first, on the same `autoUpdater` instance** -
without it, electron-updater rejects immediately with "Please check update first", every single time,
regardless of network or platform. The app's own update check never touches electron-updater at all
(it reads the GitHub API directly, so the same code answers "is there an update" on both platforms) -
which meant nothing ever called `checkForUpdates()`, so the Windows path silently failed on every
download and fell through to the asset-download fallback above unconditionally. No test caught it
because every existing test's fake `autoUpdaterFactory` returned `null`, so none of them exercised
electron-updater's own download path at all - only a fake shaped like the real precondition, not just
present-or-absent, could catch this.

Testing this needed one fix to the test double, not just new tests: the startup notification's click
handler used `void download(update)` to satisfy lint's no-floating-promise rule, and the fake
`Notification.emit("click")` had no way to hand a test the resulting promise - so `await
notifications[0].emit("click")` resolved immediately, racing ahead of the download it was meant to
wait for. The handler now returns the promise instead of discarding it, which changes nothing about
how Electron treats an event handler's return value but gives the fake something real to await.

## Packaging

`electron-builder` on a `v*` tag builds the Windows installer and the macOS `.dmg` and publishes them
to GitHub Releases. **Packaging fans out; publishing does not.** The matrix jobs build with `--publish never` and upload
artifacts; a single later job collects them all and creates the release. Letting each job publish for
itself is what produced *two* draft releases for v0.4.2, with one asset stranded on the wrong one:
both finish at roughly the same moment, each looks for an existing draft, neither sees the other's,
and both create one.

The electron-builder `publish` block stays, because it is what makes electron-builder write the
updater feed files (`latest.yml`, `latest-mac.yml`) - it just never publishes.

**The shell's runtime dependencies must be declared.** npm workspaces hoist packages to the repo root,
so a module the shell requires but never lists resolves perfectly in development and is simply absent
once packaged - electron-builder has no reason to bundle something nothing claims to need. That
shipped in every release up to 0.8.0: the app packaged, published and downloaded correctly, and died
on launch with `Cannot find module '@trypthos/domain'`. `apps/desktop/test/dependencies.test.js`
compares what `src/` requires against the manifest, statically, so it runs in ordinary CI rather than
only on a tag; the release workflow additionally reads the built asar and refuses to publish without
the module in it.

**The release build runs `npm run build`, not just the renderer.** The shell requires the domain
package at runtime and that package is built - building only the renderer left the shell importing a
`dist/` the runner had never produced.

**Cutting a release**: `deploy\PushVersion.cmd --current` pushes a `v<version>` tag matching
`version.json`. It refuses unless HEAD is on `main`, clean, level with `origin/main`, and green in CI
for that exact SHA - checked by SHA rather than by branch, since "the latest run on main" can belong
to a different commit. Those are not conveniences: the release workflow runs **no tests**, so nothing
else checks the commit before it is published, and a tag on a stale HEAD builds the previous commit's
code while claiming the new version.

**Artifact names must contain no spaces.** GitHub rewrites a space to a dot on upload, so
electron-builder's default `Trypthos Setup x.y.z.exe` was published as `Trypthos.Setup.x.y.z.exe`
while `latest.yml` pointed at `Trypthos-Setup-x.y.z.exe`, and the feed URL 404'd. electron-builder's
own publisher normalised that; publishing from a separate job does not, so the name has to be right
at build time. `apps/desktop/test/packaging.test.js` pins it, along with the publish block and the
renderer being copied into `resources/app` - all three fail silently rather than loudly.

**The app icon is drawn in code, not committed as a binary** - the same convention as the tray
icons, and for the same reason: it is regenerable when the mark changes, and the source of truth is
readable code rather than an opaque asset nobody can diff. `apps/desktop/scripts/iconAssets.mjs`
holds the vector artwork (as SVG template strings) and the two binary packers; `make-app-icon.mjs`
rasterizes and writes the files; `npm run icons` (wired into `predist`, alongside the existing tray
icon generator) runs both.

`sharp` (a devDependency, used only by these build-time scripts - never imported by the shipped
app) does the actual rasterizing, for the app icon and the tray icon alike: the artwork has a
diagonal gradient, rounded-rect arcs and, for the tray template, a mask, all of which are easy to get
subtly wrong by hand and hard to notice when wrong. The artwork itself and the container formats stay
hand-written and tested, since those have an objectively right answer and rendering fidelity does not.

**Windows and macOS use different shape templates for the same mark**, because their platform
conventions differ: Windows wants an edge-to-edge Fluent squircle, macOS wants the icon inset with
headroom and its own floating drop shadow - baked into the artwork, since Finder's icon view and Get
Info panel show exactly the pixels given to them rather than compositing one for you the way the Dock
does. The smallest sizes drop the gradient and the folded-corner triangle in favour of a flat fill
and thicker rule lines - both are too small to read as anything but noise at that scale.

**An ICNS `@2x` slot renders the SMALLER size's artwork at the LARGER pixel dimension - not the
larger size's own artwork.** `ic11` ("16@2x") wants the sixteen-pixel design - no fold, the thickest
lines - rendered at 32 physical pixels for a crisp Retina display, not the native 32px design shrunk
into that slot. Getting this backwards produces an icns where several slots silently show the wrong
design; `iconAssets.mjs` keeps the two axes - which artwork, and what pixel size to render it at - as
separate parameters for exactly this reason, and it is a caught regression rather than a hoped-for
property: an earlier version of this code took only the artwork's own size and rendered every ICNS
slot at that size, which a test now pins against.

**Electron is pinned to an exact version** in `apps/desktop/package.json`, not a range.
electron-builder downloads platform binaries for one specific release and refuses a range - and in a
workspace it cannot fall back to reading the installed copy, because electron is hoisted to the root.
The pin is also correct on its own terms: a range means rebuilding the same version could ship a
different Chromium. Builds are **unsigned**: Developer ID signing, notarization and a working
Squirrel.Mac update path are outstanding.

Because there is no server, **every user-facing change needs a release** to reach anyone.
