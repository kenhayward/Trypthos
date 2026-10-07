# Spec: viewing PDF files

**Status: specified, not built.** Nothing here describes code that exists today. It is the design
the work is measured against, written before the first line of it.

Trypthos opens markdown, source files, pictures, and recordings. This adds the last thing that sits
in a notes folder and is looked at rather than read: **PDF files**, opened in the centre panel with
page navigation and zoom.

`file-types.md` already says this is not part of that feature - "`.docx` and `.pdf`. A converter,
not a highlighter. Different feature, different spec." This is that spec.

## The decision that shapes everything else

A PDF is binary, so the read boundary refuses it outright: `decodeTextFile` sniffs a NUL in the first
8 KB and answers `not-text`. And a PDF is often large, so the picture's route is the wrong model for
it: a data URL arrives in one lump, the 16 MB cap exists to protect against exactly that lump, and
a PDF reader does not want one lump anyway - it wants the head of the file, then the xref, then the
objects it is asked for.

So this feature is not "another `ImageViewer`". It needs the **streaming route**, and that route
already exists: `tp-media://`. The whole new main-process surface is one entry in the declared-type
decision. Everything below follows from that one fact.

## The transport: reuse, and what reuse means

The protocol was built for byte sources that seek. A PDF reader is exactly that: pdf.js reads a
document by range requests - it fetches the head, then the xref table, then the objects a page
needs - and the scheme already answers `Accept-Ranges: bytes` on every response, already has
`supportFetchAPI`, `stream`, and `corsEnabled`, and already refuses names no map claims.

**The handler's third step, "decide the media type from the name", widens by one total answer: a
`.pdf` name declares `application/pdf`.** A name no row claims is still refused rather than guessed
at, and the decision stays in the main process - a declared type is an instruction about how to read
the bytes that follow, never something taken from the renderer. `mediaFiles.ts`'s `mediaTypeFor`
stays about playable media; the new decision lives in a new `pdfFiles.ts` beside it, and the handler
asks the two in order. One handler, two maps, one rule.

**What is NOT here matters as much as what is**, and that is unchanged from the media spec: the
handler never resolves a path, never touches a workspace root, and is handed the same locator every
IPC handler uses, so there is one workspace boundary check in this app rather than two that could
drift apart. `main.js` is unchanged: the scheme is already registered.

### On authority

Unchanged from the media spec: the URL is guessable, and what it can reach is exactly what `file:read`
already grants the renderer - a file inside a workspace the user currently has open. A token would
imply a stronger guarantee than the app makes anywhere else.

### There is no size limit, and that is the point

Unchanged: a streamed range response does not arrive in one lump, so memory stays flat whether the
file is 4 MB or 4 GB. Adding a cap here would be copying a constraint from a mechanism this one
exists to avoid.

### GitHub answers the same refusal as before

A repository's blobs arrive base64 with no range support, so the protocol says `unsupported` and
`openPath`'s `cannotStream` guard fails the open with the media refusal. A PDF in a GitHub
workspace is not half-supported; it is not openable, and that is the whole answer.

## The engine: pdf.js, and why not the built-in viewer

Electron 44.4.5 ships a PDF viewer (PDFium), gated by the `plugins` webPreferences flag, which
`windowOptions.js` does not set. The obvious cheaper design - "turn the flag on and put an iframe
over the `tp-media` URL" - is not the one we take, for reasons:

- The renderer is untrusted, and `windowOptions.js` exists to pin exactly the flags that make that
  true. `plugins: true` widens that surface for one plugin whose behaviour we cannot control.
- The viewer's UI is Chromium's: a download button and a print button that mean nothing in an
  editor, no colour tokens, no i18n keys, no keyboard behaviour of the app's. The media feature took
  native controls because `<video controls>` is a complete accessible component with nothing to
  restyle; a PDF viewer's controls are not complete here, they are wrong here.
- The app owns every surface it shows. `ImageViewer` is hand-built; the PDF surface is hand-built
  too, and it reuses the app's zoom model.

The cost accepted: pdfjs and its worker build are megabytes in the renderer bundle. The renderer
already carries marked, mermaid, katex, and sigma; one more is not the shape of the problem. The
module-graph discipline still applies: nothing eager imports pdfjs, the same rule `languageLoaders.test.ts`
asserts for the grammar packages.

### The worker is a decision, not a default

The renderer is one thread. pdf.js parsing a 200-page document on the main thread is a measurable
jank in a window that is supposed to stay responsive. pdf.js runs its parser in a Web Worker -
available in the sandboxed renderer - and the fake worker is the fallback, not the plan. The
threshold at which this matters is measured on a real document rather than assumed.

### Measured rather than assumed

Like the media spec's `canPlayType` table, the format questions here are engine questions, and they
get asked of the engine:

- What pdfjs version is current at the pin, and what its worker build requires.
- Parse cost of a real multi-page document (generated fixture), main thread versus worker.
- **Whether pdf.js's range reading over `tp-media://` works in the real app.** The media feature
  proved `fetch` works against the scheme; pdf.js's reader is a different code path, and the media
  spec's `standard: true` discovery - found only by playing a file, every assertion about the
  handler having passed throughout - is the precedent for why this gets verified in the app rather
  than assumed.

## The rows

| Extension | Declared type |
| --- | --- |
| `pdf` | `application/pdf` |

Deliberately absent: `.eps`, `.ps`, `.xps`, `.ofd`. Different formats, different decoders; a row
that opens and then fails is worse than no row - the media spec's argument, applied unchanged.

### The catalogue row

`pdf` in the `documents` group - it is a document, and the settings page puts it beside markdown,
not beside media. `modes: []`: there is no mode to offer; the surface is not a view. `FileTypeKind`
gains `pdf`, and the kind's comment already describes it: the absence of editing, never CodeMirror,
never written, a different route out of the shell. `behaviourFor` in `DocumentEditor.tsx` gets
nothing: a pdf never reaches it.

## The surface

One new component, `PdfViewer.tsx`. `ImageViewer.tsx` and `MediaPlayer.tsx` are untouched.

- **Opens at fit**: the first page in the panel, never enlarged past its own pixels. The
  `ImageViewer`'s argument applies unchanged - the first question about a document is what it is,
  and 100% answers that with a corner.
- **A page bar**, the analogue of the media scrub bar: the page count, and a draggable position.
  A 40-page document is tedious with keys alone; the bar is what a scrub bar is for.
- **Page stepping**: PageDown/PageUp and clicking the bar. Keyboard accessible, like everything
  else here.
- **Zoom and pan are the picture's gestures**, reused from `pictureZoom`: Ctrl/Cmd+1 for actual
  size, Ctrl/Cmd with the wheel about the pointer, a plain drag pans a zoomed page. A page has a
  natural size like a picture does, so fit and scale mean the same thing here as they do there.
- **One page on screen at a time**, rendered to a canvas at the current scale. The page boundary is
  the unit; a stacked scroll would erase the whole point of a PDF.
- `key={activePath}` on the viewer, the same reason the media player has one: React reusing one
  node across two PDF tabs leaks the first document's pages into the second.
- The status bar stays hidden - a word count and a caret position are questions about text - the
  header offers no modes (`modes: []`), and the toolbar stays hidden. All three gates already answer
  this through `media`.

### The error line is part of the feature

- A file that is not a PDF despite the name, or a corrupt one: the panel says plainly that the file
  was found but this computer cannot open it. A blank page explains nothing, and the error path is
  what makes the row defensible - the media spec's argument, unchanged.
- A password-encrypted PDF reports that same line with the words for "it needs a password". The
  prompt is state that belongs to its own decision, not this one.
- A document that parses but whose pages fail to render reports like a failed read, not a blank
  canvas.

### What this version does not do

- **Text never leaves the PDF.** No selection, no copy, no text layer, no "Add to chat". Chat
  already treats any document with `media` set as nothing open; extraction is its own feature with
  its own spec.
- **No fullscreen.** The centre panel is the reading surface, and zoom covers detail. The media
  feature verified HTML fullscreen against the frameless window before claiming it; that
  verification belongs to a decision that wants the feature.
- Password prompts, form fields, annotations, JavaScript in a document, reflow: not this version.

## Reach into the rest of the app

| Where | What |
| --- | --- |
| `packages/domain/src/pdfFiles.ts` | **new** - `isPdfName`, the declared type. Mirrors `imageFiles.ts` and `mediaFiles.ts` in shape and in reasoning. |
| `packages/domain/src/fileTypes.ts` | one row `pdf`, group `documents`; `FileTypeKind` gains `pdf` |
| `packages/domain/src/openDocuments.ts` | `MediaSource.kind` widens to include `pdf` - the kind travels with the source, unchanged reasoning |
| `apps/desktop/src/mediaProtocol.js` | the declared-type step asks the pdf map after the media map; a name neither claims is still refused |
| `apps/app/src/hooks/useWorkspace.ts` | `openPath` gains a pdf branch: builds the URL from the name, reads nothing; `cannotStream` answers the same refusal as media |
| `apps/app/src/components/EditorPanel.tsx` | `media.kind === "pdf"` draws the viewer |
| `apps/app/src/components/PdfViewer.tsx` | **new** |
| `apps/app/src/lib/pictureZoom.ts` | reused, not forked: fit, scale, anchored scroll are the picture's model |
| `packages/domain/src/newFile.ts` | `newFileTypes` filters kinds that can never be typed into (image, video, audio, pdf). The rule: a type you can never type into has no new file. This corrects the media rows' existing wrinkle as part of this change. |
| `packages/domain/src/wikiLink.ts` | the `"pdf"` literal in `FILE_EXTENSIONS` is removed; the catalogue owns the extension now, one owner per extension |
| `packages/domain/src/settings.ts` | `SETTINGS_VERSION` 24 -> 25, migration appends `"pdf"` |
| `apps/app/src/locales/en.json` | the label, the error lines, the page bar's accessible names |
| `apps/app/package.json` | pdfjs and its worker build |
| `docs/specs/file-types.md` | the out-of-scope paragraph's `.pdf` sentence points at this spec |

**Chat needs no change.** `scopeSource` in `App.tsx` already treats any document whose `media` is
set as nothing open, with the reasoning written for pictures and true unchanged for a PDF.

**The tree, search, the chat folder outline, and link openability need no change.** They gate on
`isOpenable`, which the row turns on. That is the whole point of the catalogue.

**The operating system integration does not widen.** `launchTarget.js` and `explorerIntegration.js`
stay as they are, for the reason `file-types.md` already gives: registering an Explorer verb on
`.pdf` would make a markdown editor claim a PDF for the whole machine.

### The settings migration, and why it departs from the written rule

Same argument as the media feature's, applied to 25: the rule protects a choice somebody made;
nobody chose to exclude PDF, there was no row to leave unticked, so the absence is an artefact of
when they installed, not a preference. The migration appends and touches nothing else, per the rule
each migration already follows. The release notes say so in as many words, naming the File types
page for anyone who wants a folder of PDFs kept out of their tree.

## How it is proved

Test-first throughout, each test red before the code that answers it.

**Domain (`vitest`)**
- The catalogue invariants still hold with the new row: no two rows claim an extension, extensions
  are lowercase and dotless.
- `isPdfName` is total: `.pdf` in any case yes, `report.PDF` yes, a leading dot no, everything else
  no.
- `newFileTypes` offers no row whose kind cannot be typed into, and the test names why: the four
  kinds.
- The settings migration to 25 appends `pdf` and preserves everything else, including a list that
  already contains it.
- The existing `report.pdf` fixture in `markdownLink.test.ts` flips from `{kind: "none", reason:
  "not-openable"}` to openable - the first red test this feature turns, and it is already in the
  repository.
- `wikiLink` resolves `.pdf` through the catalogue now, and the `![[Handbook.pdf#page=3]]` flavour
  test stays green: page anchors are Obsidian syntax the app preserves, not resolves.

**Shell (`node --test`)**
- The protocol declares `application/pdf` for a `.pdf` name and still refuses a name neither map
  claims.
- Ranges are unchanged for both maps - the existing 206/416 tests still pass with the pdf name
  added to the table.

**Renderer (`vitest`, jsdom)**
- `openPath` builds a `tp-media://` URL for a pdf and reads nothing over IPC; a workspace that
  cannot stream fails with the media refusal.
- `EditorPanel` draws the viewer rather than the editor for a pdf document, with no mode header and
  no status bar.
- The viewer's page bar answers the page count and clamps a position past the end.

**Renderer (`test:browser`)**
- The rendered surface carries a canvas per page shown, the page bar's accessible names, and no
  text nodes for page content - the text is in the canvas, which is the point.

**Driving the real Electron app**, which is the only place the transport and the engine can be
proved:
- A real PDF opens at fit, steps pages by key and by bar, zooms about the pointer, and pans.
- The fixture is a hand-written minimal one-page PDF - a few hundred bytes of valid PDF with
  invented words - and a multi-page one generated the same way for the parse-cost measurement. No
  new dependency, no real file of the user's entering the repository.
- **Stated limit**: whatever the parse measurement says is recorded here when it is measured, not
  predicted.

## Release

A functional enhancement, so **0.103.0**, with the full checklist: `version.json` and all mirrors,
one `RECENT[0]` entry, the About-box capability row, the README Features row, the `docs/features.md`
bullet, and `docs/Architecture.md` - that last one is genuinely required here, because this adds an
external dependency and widens a cross-process transport.

**Deployment surface: needs a release.** This is new behaviour in the shipped editor.
