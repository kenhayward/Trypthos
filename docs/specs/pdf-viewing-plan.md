# PDF Viewing - Implementation Plan

> **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a `.pdf` as a read-only document: the shell streams its bytes over `tp-media:`, pdf.js parses them in a worker, and the renderer draws pages with a page bar and the picture's zoom gestures.

**Architecture:** Nothing new crosses the boundary. The catalogue gains one row; the existing media transport carries the bytes; the existing picture-zoom model drives the surface. The only new renderer file is the viewer itself.

**Tech Stack:** TypeScript (domain, renderer), CommonJS (shell), vitest (domain/renderer), node:test (shell), pdfjs (renderer, dynamic import only), CodeMirror untouched for this type.

**Spec:** `docs/specs/pdf-viewing.md` - read it first; every decision below is argued there.

---

## Global Constraints

- **TDD is required.** Every production change is preceded by a failing test, written and run first, watched to fail for the reason this task names. No production code without one.
- **Test output stays pristine.** No warnings, no unhandled rejections, no skipped guards printing.
- **No em dashes or en dashes in user-facing text.** Hyphens only.
- **No real user data anywhere.** Fixtures use invented names (`report.pdf`, `Notes/plan.pdf`).
- **The renderer is untrusted.** It never learns a path from the shell beyond what it already has; the media type is declared from the name in the main process, never accepted from the renderer.
- **The domain package imports nothing from React, Electron, or fs.** `pdfFiles.ts` is pure.
- **Branch:** `spec/pdf-viewing`, one PR. `main` is branch-protected. The feature needs no issue; the PR body states the deployment surface.
- **Version:** `0.102.0` -> `0.103.0` (functional enhancement: Minor +1, Build reset). **Settings:** `SETTINGS_VERSION` 24 -> 25.
- **Line endings:** the repo mixes CRLF/LF against `main`; run the `.fix-eol.mjs` repair against `main` before every `git add`, and check `git diff --stat` after every edit run.
- **pdfjs is pinned at install time, not assumed.** Record the exact version in the PR body and in `apps/app/package.json`; the spec's measured-not-assumed list is filled by Task 9's measurements, not by pdf.js's documentation.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/domain/src/fileTypes.ts` | The pdf row: `kind: "pdf"`, `modes: []`, extension `pdf`. (modify) |
| `packages/domain/src/pdfFiles.ts` | **new.** The name -> `application/pdf` decision, mirroring `imageFiles.ts`. |
| `packages/domain/src/settings.ts` | `SETTINGS_VERSION = 25`; the migration appends `"pdf"`. (modify) |
| `packages/domain/src/openDocuments.ts` | `MediaSource.kind` widens to include `"pdf"`. (modify) |
| `packages/domain/src/newFile.ts` | `newFileTypes` leaves out non-writable kinds. (modify) |
| `packages/domain/src/wikiLink.ts` | The `"pdf"` literal drops from `FILE_EXTENSIONS`. (modify) |
| `apps/desktop/src/mediaProtocol.js` | The handler asks `pdfMediaTypeFor` alongside `mediaTypeFor`. (modify) |
| `apps/app/src/hooks/useWorkspace.ts` | `openPath` opens a pdf like a recording: URL, no read. (modify) |
| `apps/app/src/components/PdfViewer.tsx` | **new.** The surface: pdfjs worker, page bar, zoom via `pictureZoom`. |
| `apps/app/src/components/EditorPanel.tsx` | The pdf branch of the render tree; the zoom-key gate widens. (modify) |
| `apps/app/src/locales/en.json` | `fileTypes.pdf` and the viewer's strings. (modify) |
| `apps/app/package.json` | The pdfjs dependency. (modify) |

**Intermediate states are expected.** After Task 1 the catalogue claims `.pdf` and nothing can open one; after Task 4 the transport can carry one and no renderer branch asks for it. Nothing merges until the branch is green.

---

## Task 1: The catalogue row

**Files:** modify `packages/domain/src/fileTypes.ts`; modify `packages/domain/src/fileTypes.test.ts`; modify `apps/app/src/locales/en.json`.

**Interfaces:** Produces a `FileTypes` row: `{ id: "pdf", labelKey: "fileTypes.pdf", extensions: ["pdf"], modes: [], kind: "pdf", pinned: false }`.

- [ ] Write the failing test in `fileTypes.test.ts`, beside the media rows' block:

```ts
describe("the pdf row", () => {
  const row = FILE_TYPES.find((type) => type.id === "pdf");

  it("claims .pdf and nothing else", () => {
    expect(fileTypeFor("report.pdf", DEFAULT_FILE_TYPES)?.id).toBe("pdf");
    expect(fileTypeFor("REPORT.PDF", DEFAULT_FILE_TYPES)?.id).toBe("pdf");
  });

  // Live, Source and Preview are markdown constructs; a PDF is none of the three.
  it("offers no view modes", () => {
    expect(row?.modes).toEqual([]);
  });

  it("is its own kind, so nothing tries to edit it", () => {
    expect(row?.kind).toBe("pdf");
  });
});
```

- [ ] Run it and watch it fail: `npx vitest run --root packages/domain fileTypes` - no row matches `"pdf"`.
- [ ] Add the row after the audio row in `fileTypes.ts`, with a comment in the image row's voice: the formats a window reads with help, not the ones it draws without it. `modes: []` carries the image row's reasoning.
- [ ] Add `"pdf": "PDF"` to the `fileTypes` block in `en.json`, after `"audio"`. `i18nKeys.test.ts` guards both directions; the label exists before anything reads it, so add it in this task, not later.
- [ ] Run `npx vitest run --root packages/domain fileTypes` and the i18n guard; both green.
- [ ] Commit: `add the pdf row to the file-types catalogue`

---

## Task 2: Existing installations get the row

**Files:** modify `packages/domain/src/settings.ts`; modify `packages/domain/src/settings.test.ts`.

**Interfaces:** Produces `SETTINGS_VERSION = 25` and a migration `{ to: 25, migrate: ... }` appending `"pdf"` to any enabled list it migrates.

- [ ] Write the failing test in `settings.test.ts`, after the version 22 block, copying that block's shape:

```ts
describe("migrating from version 24", () => {
  // Nobody who already runs the app chose to exclude PDFs, so the row arrives enabled,
  // exactly as version 22 delivered video and audio.
  it("adds the pdf row to an existing list", () => {
    const before = { schemaVersion: 24, fileTypes: { enabled: ["markdown"] } };
    const migrated = loadSettings(before);
    expect(migrated.fileTypes.enabled).toEqual(["markdown", "pdf"]);
    expect(migrated.schemaVersion).toBe(SETTINGS_VERSION);
  });
});
```

- [ ] Run it and watch it fail: `npx vitest run --root packages/domain settings` - the chain stops at 24.
- [ ] In `settings.ts`: `SETTINGS_VERSION = 25`; prepend the `{ to: 25, ... }` migration above the v24 entry, written out rather than read from `DEFAULT_FILE_TYPES`, with the v22 migration's rationale comment ("a migration is a record of what a version DID").
- [ ] The `expect(SETTINGS_VERSION).toBe(24)` assertion at `settings.test.ts:1024` becomes `toBe(25)`; the "is the version the migrations chain up to" guard needs no change.
- [ ] Run `npx vitest run --root packages/domain settings`; green.
- [ ] Commit: `settings version 25: existing installations get the pdf row`

---

## Task 3: The pdf decision

**Files:** create `packages/domain/src/pdfFiles.ts`; create `packages/domain/src/pdfFiles.test.ts`.

**Interfaces:** Produces `pdfMediaTypeFor(name: string): string | null` and `isPdfName(name: string): boolean`, mirroring `imageFiles.ts` exactly in shape.

- [ ] Write `packages/domain/src/pdfFiles.test.ts` first, in `imageFiles.test.ts`'s voice:

```ts
import { describe, expect, it } from "vitest";
import { pdfMediaTypeFor, isPdfName } from "./pdfFiles";

/// PDFs, which the app reads with help rather than editing.
///
/// The bytes never cross the read boundary - the shell streams them over its own protocol -
/// but the type still has to be decided from the name, in the main process, for the reason
/// imageFiles.ts gives: a type is an instruction about how to interpret bytes.
describe("pdf file types", () => {
  it("names the one type a .pdf is", () => {
    expect(pdfMediaTypeFor("report.pdf")).toBe("application/pdf");
    expect(pdfMediaTypeFor("REPORT.PDF")).toBe("application/pdf");
  });

  it("has no answer for anything else", () => {
    expect(pdfMediaTypeFor("notes.md")).toBeNull();
    expect(pdfMediaTypeFor("noextension")).toBeNull();
    expect(pdfMediaTypeFor("")).toBeNull();
  });

  it("recognises the name the catalogue claims", () => {
    expect(isPdfName("report.pdf")).toBe(true);
    expect(isPdfName("report.PDF")).toBe(true);
    expect(isPdfName("report.xpdf")).toBe(false);
  });
});
```

- [ ] Run it and watch it fail: `npx vitest run --root packages/domain pdfFiles` - the module does not exist.
- [ ] Write `pdfFiles.ts` beside `imageFiles.ts`: the same `extensionOf` helper (or import it if `imageFiles.ts` exported it - it does not, so copy it, as `mediaFiles.ts` already does), a one-entry `MEDIA_TYPES`-shaped map `{ pdf: "application/pdf" }`, and the two exports. The "Decided from the name, in the main process" comment carries over verbatim in intent.
- [ ] Run green. Commit: `the pdf decision, from the name`

---

## Task 4: The protocol declares a PDF

**Files:** modify `apps/desktop/src/mediaProtocol.js`; modify `apps/desktop/test/mediaProtocol.test.js`.

**Interfaces:** Consumes `pdfMediaTypeFor` from `@trypthos/domain`. Produces: a `tp-media:` response for a `.pdf` carries `Content-Type: application/pdf`.

- [ ] Write the failing test in `mediaProtocol.test.js`, beside the existing media cases. Match whatever that file already calls its harness (it is not vitest; read the file's existing cases first).
  The test: fetch the handler with a `.pdf` path and assert the response is 200 with `Content-Type: application/pdf` and `Accept-Ranges: bytes`.
- [ ] Run it and watch it fail: `npm test --workspace trypthos-desktop` - the handler answers 404, because `mediaTypeFor` does not claim `.pdf`.
- [ ] In `mediaProtocol.js`, widen the load-bearing step without touching its comment:

```js
const mediaType = mediaTypeFor(qualified) ?? pdfMediaTypeFor(qualified);
if (mediaType === null) return refuse(404);
```

  Import `pdfMediaTypeFor` from the domain require at the file's top. The "**Decided HERE, from the name.**" comment stays; extend it with one line: the pdf type is declared here for the same reason, and a name no catalogue row claims is still refused rather than guessed at.
- [ ] Run green. Commit: `the media protocol declares a pdf from the name`

---

## Task 5: The renderer opens one

**Files:** modify `packages/domain/src/openDocuments.ts`; modify `packages/domain/src/openDocuments.test.ts`; modify `apps/app/src/hooks/useWorkspace.ts`; modify `apps/app/src/hooks/useWorkspace.test.ts`.

**Interfaces:** Consumes `isPdfName` and `mediaUrl(path)` (already exported). Produces `MediaSource { source: string; kind: "image" | "video" | "audio" | "pdf" }`.

- [ ] Write the failing test in `useWorkspace.test.ts`, inside the "opening a recording" block's style:

```ts
it("opens a document over the protocol without reading it", async () => {
  const { result, reads } = await withWorkspace();

  await act(async () => {
    await result.current.actions.openPath("ws/report.pdf");
  });

  expect(result.current.state.media).toEqual({
    source: "tp-media://workspace/ws%2Freport.pdf",
    kind: "pdf",
  });
  // The bytes never cross IPC, for the reason the recording's test gives.
  expect(reads).toEqual([]);
});
```

- [ ] Run it and watch it fail: `npx vitest run --root apps/app useWorkspace` - the path falls through to `client.readFile` and the read boundary refuses it.
- [ ] In `openDocuments.ts`, widen `MediaSource.kind` to include `"pdf"`. Run `openDocuments.test.ts` green (its fixtures stay; the union widens).
- [ ] In `useWorkspace.ts`, extend the media branch's `mediaKindFor(path)` call site: after the media kind check, add the pdf branch beside it, taking the same `cannotStream` refusal (`media-not-local` - a repository cannot stream either) and the same `mediaUrl(path)` + `revision: { id: "pdf" }` shape. Use `isPdfName(path)` as the guard, mirroring how the image branch uses `isImageName`.
- [ ] Run `npx vitest run --root apps/app useWorkspace` green, including the new test.
- [ ] Commit: `open a pdf over the protocol, like a recording`

---

## Task 6: The viewer

**Files:** create `apps/app/src/components/PdfViewer.tsx`; create `apps/app/src/components/PdfViewer.test.tsx`; modify `apps/app/package.json`; modify `apps/app/src/locales/en.json`.

**Interfaces:** Consumes `PictureView`, `fitScale`, `scaleOf`, `stepPicture`, `wheelPicture`, `toggleFit`, `anchoredScroll` from `./lib/pictureZoom` - reused, not forked. Produces `PdfViewer({ source, name, view, onView, onFit }: Props)`, the same props `ImageViewer` takes.

- [ ] Install the engine first, so the version is real before any code names it: `npm install pdfjs --workspace trypthos-app` (whatever the app's package manager incantation is for this repo - match it), and record the installed version. The worker build's URL is set from the installed copy, never a CDN.
- [ ] Write `PdfViewer.test.tsx` first, in `MediaPlayer.test.tsx`'s jsdom style. The tests, each failing until the component exists:
  - it draws a page as a canvas, not an `<img>` and not a `.cm-content`;
  - it puts the page bar on screen: a "Page 1 of N" label (assert through the i18n-rendered text, invented fixture count);
  - it refuses to draw before the document is parsed (the panel says so, once);
  - a password-encrypted fixture answers with the "needs a password" line, not a blank page;
  - it offers no Live/Source/Preview buttons (the catalogue row's `modes: []` must hold at the surface).
- [ ] Run it and watch it fail: `npx vitest run --root apps/app PdfViewer` - the component does not exist.
- [ ] Write `PdfViewer.tsx`:
  - `const pdfjs = await import("pdfjs")` inside the parse step - a dynamic import, so nothing eager pays the engine (the `languageLoaders` test's reasoning, applied here);
  - parse once per `source` in pdfjs's worker build; cache the document; a re-render with the same source never re-parses;
  - draw the current page to a canvas at `scaleOf(view, fit)` where `fit = fitScale(pageSize, panelBox)`; report `fit` through `onFit` exactly as `ImageViewer` does;
  - the page bar: current page, total, and PageDown/PageUp bound on the window inside the component (the component only exists when a pdf is on screen);
  - wheel and drag: `wheelPicture` about the pointer and `anchoredScroll` for the pan - the picture's gestures, called, not reimplemented;
  - parse failure and encrypted-document failure render the two lines from `en.json` (add `pdfViewer.couldNotOpen` and `pdfViewer.needsPassword` to the locales now; the i18n guard runs green after this task).
- [ ] Run green. Commit: `the pdf surface: pages, a page bar, the picture's zoom`

---

## Task 7: Drawing it

**Files:** modify `apps/app/src/components/EditorPanel.tsx`; modify `apps/app/src/components/EditorPanel.test.tsx`.

**Interfaces:** Consumes `OpenDocument.media.kind === "pdf"`. Produces the render branch and the widened zoom-key gate.

- [ ] Write the failing tests in `EditorPanel.test.tsx`, beside "EditorPanel: a recording":

```tsx
describe("EditorPanel: a document", () => {
  const DOC = { source: "tp-media://workspace/Notes%2Freport.pdf", kind: "pdf" as const };

  const withDoc = () =>
    render(
      <EditorPanel
        workspaceName="Notes"
        paths={["Notes/report.pdf"]}
        activePath="Notes/report.pdf"
        dirty={false}
        value=""
        readOnly
        media={DOC}
        fileTypes={["markdown", "pdf"]}
        onChange={vi.fn()}
      />,
    );

  it("draws pages rather than a picture or a player", () => {
    const { container } = withDoc();
    expect(container.querySelector("canvas")).notToBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  // The row says modes: []; the header has to agree.
  it("offers no view to switch to", () => {
    withDoc();
    for (const view of ["Live", "Source", "Preview"]) {
      expect(screen.queryByRole("button", { name: view })).toBeNull();
    }
  });
});
```

- [ ] Run it and watch it fail: the pdf falls to `MediaPlayer`'s branch.
- [ ] In `EditorPanel.tsx`: add the `media.kind === "pdf"` branch to the render tree before the image branch, passing the same `view`/`onView`/`onFit` props the image branch passes (the `pictureViews` state map is keyed by path, so a pdf gets its own entry - this is the reuse, not a fork). Widen the gate at `:300` to `const picture = page === null && (media?.kind === "image" || media?.kind === "pdf");` and rename it to `zoomable` if the rename keeps the comment honest - the comment at `:299` says why the picture path is taken; extend it for pages.
- [ ] Run `npx vitest run --root apps/app EditorPanel` green.
- [ ] Commit: `the panel draws a pdf`

---

## Task 8: The rest of the reach

**Files:** modify `packages/domain/src/newFile.ts`; modify `packages/domain/src/newFile.test.ts`; modify `packages/domain/src/wikiLink.ts`; modify `packages/domain/src/wikiLink.test.ts`; modify `packages/domain/src/markdownLink.test.ts`.

**Interfaces:** Consumes the catalogue's `kind`. Produces: `newFileTypes` never offers `"pdf"`; `[[report.pdf]]` resolves through the catalogue; the `report.pdf` fixture in `markdownLink.test.ts` flips to openable.

- [ ] `newFile.test.ts`: add the failing test - `newFileTypes(["markdown", "pdf", "image", "video", "audio"])` offers only the markdown entry. Watch it fail (the current filter is `extensions.length > 0`, and pdf has an extension).
- [ ] In `newFile.ts`, extend the filter: `type.kind === "text"` (or `!isWritableKind(type.kind)` if the kinds are already named - match whatever `fileTypes.ts` calls them). Update the guard's comment: it was "a guard rather than a filter anybody sees working"; with media and pdf rows it is now a filter that is seen working, and that is the correction the media rows needed too.
- [ ] `wikiLink.ts`: drop the `"pdf"` literal from `FILE_EXTENSIONS` at `:38` - the catalogue now supplies it through the `flatMap`. Write the failing test in `wikiLink.test.ts` first: `[[report.pdf]]` resolves to the pdf document when the pdf row is enabled, and does not when it is not.
- [ ] `markdownLink.test.ts:177`: the existing fixture `expect(link("report.pdf", null)).toEqual({ kind: "none", reason: "not-openable" })` - read the surrounding call and extend its enabled-types list with `"pdf"`, flipping the expectation to openable. This is the reach the spec's table claims; do not leave the literal and the row both claiming `.pdf` in the same test run.
- [ ] Run the domain suite green. Commit: `the reach: no new pdfs, wiki links resolve, the fixture flips`

---

## Task 9: Proving it in a real window

**Files:** create `apps/desktop/test/fixtures/report.pdf` (or wherever the repo's fixture directory is - match it); modify `apps/desktop/test/pdfViewing.test.js` (new).

**Interfaces:** Consumes the built app. Produces measurements, not assertions about speed.

- [ ] Write the fixture: a hand-written minimal one-page PDF (the smallest valid file: header, one page object, a `Hello.` content stream, xref, trailer). No generated binary, no real document.
- [ ] Write the real-window test in the shell's `node --test` style, beside `mediaProtocol.test.js`'s harness: launch the built app, open the fixture through the real path, assert the window reaches a parsed document with one page and a canvas on screen. This is the same proof pattern as the media plan's real-window task.
- [ ] Run it against the built app: `npm run build` then the test. If it fails, fix the code, not the test.
- [ ] **Measure and record** (the spec's measured-not-assumed list): parse time for the fixture and for one real multi-page document you open manually; whether the worker keeps the parse off the frame budget (open a large document and watch for dropped frames); the installed pdfjs version; the Electron version unchanged at `44.4.5`. Write these into the PR body, not into assertions.
- [ ] Commit: `the real window opens the fixture`

---

## Task 10: The release

**Files:** modify `version.json`; modify `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `apps/app/package-lock.json` (and the root lock if present); modify `apps/app/src/lib/releaseNotes/current.ts`; modify `apps/app/src/lib/appInfo.ts`; modify `README.md`; modify `docs/features.md`; modify `docs/Architecture.md`.

- [ ] `0.102.0` -> `0.103.0` in `version.json` and the four package.json mirrors. Hand-edit `package-lock.json` exactly five edits (top-level version + `packages[""]`, `apps/app`, `apps/desktop`, `packages/domain`); never regenerate the lock.
- [ ] Verify: `npx vitest run --root apps/app versionMirrors` green.
- [ ] `RECENT[0]` in `apps/app/src/lib/releaseNotes/current.ts`: the entry shape `{ version, date, pr, headline, summary, added[], changed[] }`. Confirm the PR number from the pushed branch - do not assume it.
- [ ] The About-box capability row in `apps/app/src/lib/appInfo.ts`, in the documents group, beside the media rows.
- [ ] `README.md` Features row and `docs/features.md` bullet, in lockstep with each other.
- [ ] `docs/Architecture.md`: extend the file-types catalogue section (`:1125`'s area) with the pdf row's reasoning - the transport is reused, the type is declared from the name, the engine runs in the renderer's worker.
- [ ] Run everything green: lint, typecheck, build, test, test:browser.
- [ ] Commit, push `spec/pdf-viewing`, open the PR. The body covers: the decisions (transport reuse, pdfjs over PDFium and why, page bar + picture gestures, what this version does not do), what was proved vs not (Task 9's measurements), the deployment-surface line, and no `Fixes #` for a feature.

---

## Self-review

- **Spec coverage:** every spec section maps - catalogue row (1), migration to 25 (2), transport + declared type (3, 4), surface and page bar (5, 6, 7), reach table (8), measured-not-assumed (9), release mechanics (10).
- **Type consistency:** `pdfMediaTypeFor`, `isPdfName`, `kind: "pdf"`, `revision: { id: "pdf" }`, `PdfViewer`, `pdfViewer.couldNotOpen`, `pdfViewer.needsPassword` - one spelling each, across Tasks 3-10.
- **Known soft spots, flagged not hidden:**
  - `mediaProtocol.test.js`'s harness is not vitest; read its existing cases and match its calling style.
  - The fixture directory for the shell's real-window test: match whatever the repo already calls it.
  - pdfjs's worker-build setup (worker source, fake-worker fallback) is verified against the real app in Task 9, not asserted here; if the worker build cannot run in this renderer, the decision to change is the engine's packaging, not the surface's.
  - Whether `en.json`'s viewer strings belong in a `pdfViewer` block or the `errors` block: match whatever the media surface already does with its player strings.
