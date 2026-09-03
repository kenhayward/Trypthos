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

A marker is either **hidden or substituted**, never both. Hiding a list's `-` leaves the item indented
under nothing, which reads worse than the marker it removed, so `ListMark` is replaced by a bullet
widget instead. `substituteFor` is checked before `isHiddenMarker` and short-circuits it; doing both
would replace the marker and then remove the replacement. The widget sets `ignoreEvent(): false`, so
clicking a bullet places the caret and reveals the real character underneath rather than being a dead
zone on every list item.

Fenced code, tables, images and footnotes have no decoration yet and therefore render as source -
a deliberate floor, and one no two-engine design can offer.

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

Settings are at **version 4**. A migration adds only what its own version introduced and touches
nothing else: a file written by 0.9.0 must arrive intact, because somebody's panel widths and open
folder are not worth losing over fields that did not exist yet. The chain runs end to end, so a
version 1 file passes through version 2's migration on its way forward - a file that skipped straight
to the current version would miss whatever version 2 added, which is the exact failure migrations
exist to prevent. Version 2 added appearance and window behaviour, version 3 added chat models, version 4 added the
system prompt.

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
| `MarkdownEditor` handle | `applyChange(from, to, insert)` - one transaction |

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

`systemPrompt.test.ts` parses the prompt's own worked example with the real parser. Nothing else
checks that the format the prompt teaches is the format the parser accepts, and a drift there has
only downstream symptoms: the model does exactly as instructed and the panel renders an inert code
block.

**What chat does not do yet:** it cannot see the wider folder, conversations are not saved between
sessions, and tool calling is not yet offered as a second transport for endpoints that support it.

## The IPC surface

Fifteen channels, listed in `packages/domain/src/ipc.ts` and exposed by name in the preload bridge.
The list is asserted exactly in a test, so adding one is deliberate rather than incidental: workspace
(`workspace:open`, `workspace:reopen`, `workspace:list`), files (`file:read`, `file:write`), window
(`window:minimize`, `window:toggleMaximize`, `window:close`), settings (`settings:read`,
`settings:write`), keys (`secrets:list`, `secrets:set`, `secrets:delete`) and chat (`chat:send`,
`chat:cancel`). Two channels flow the other way, both validated on arrival like everything else:
`window:state`, and `chat:event` for streamed reply tokens.

Three properties do the work:

- **No channel reads a stored API key**, and there must never be one. See the section above.

- **Every payload is parsed with the shared schema in the main process**, before anything happens and
  before the open-workspace check. A malformed payload is a protocol error whatever the app is doing,
  and reporting it as "no workspace open" sends whoever is debugging it to the wrong place.
- **The renderer cannot name a workspace root.** It can only ask the user to choose one; the main
  process holds the result. A renderer that could name its own root could name any directory on the
  machine.

The renderer's own state machine is `apps/app/src/hooks/useWorkspace.ts`, deliberately separate from
the panel so the interface can be redesigned without touching behaviour, and so the awkward cases -
a conflicting save, a file that vanished, the browser preview with no filesystem at all - can be
tested without rendering anything.

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

## Updates

Two paths, because they are different problems. **Windows** uses `electron-updater`, which installs in
place. **macOS cannot**: Squirrel.Mac refuses to update an unsigned app, so it checks the GitHub
releases API directly and offers to open the releases page - honest about what it can do, rather than
failing part-way through an install.

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

The tray icons are **generated** by `scripts/make-tray-icon.mjs` and packed as `extraResources`, not
into the asar - Electron's `Tray` reads its icon from disk and cannot open an archive, and an icon
packed inside produces a tray with no icon at all. macOS gets a Template variant so the menu bar can
recolour it for either appearance.

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

**Electron is pinned to an exact version** in `apps/desktop/package.json`, not a range.
electron-builder downloads platform binaries for one specific release and refuses a range - and in a
workspace it cannot fall back to reading the installed copy, because electron is hoisted to the root.
The pin is also correct on its own terms: a range means rebuilding the same version could ship a
different Chromium. Builds are **unsigned**: Developer ID signing, notarization and a working
Squirrel.Mac update path are outstanding.

Because there is no server, **every user-facing change needs a release** to reach anyone.
