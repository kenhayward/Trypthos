# Google Drive - PR 4: Drive video and audio, and picture zoom - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Video and audio in a Google Drive workspace play and seek, streamed from Drive in ranges with the token held in main. Pictures in every source open at Fit (never enlarged), with 100%, zoom about the pointer by Ctrl/Cmd+wheel and trackpad pinch, drag to pan, and double-click to toggle Fit and 100%. Text zoom moves from Shift+wheel to the same Ctrl/Cmd+wheel gesture.

**Architecture:** The media protocol stops assuming a local file. `locate` answers a **byte source**, `{ ok, size, open(start, end) }`, and `open` answers a web stream. A local file is adapted in `locateMedia` from `locateFile`. Drive gains `mediaSource(path)` on the provider, which takes the size from the listing and opens ranges through a new client call, `downloadRange`. That call streams the body, and its deadline covers only the arrival of headers. The renderer stops refusing Drive media. Picture zoom becomes a view model (`fit` or a scale) in a pure `lib/pictureZoom.ts`, used by a rewritten `ImageViewer`.

**Tech Stack:** Electron CommonJS + `net.fetch` + `protocol.handle` (shell), React 19 (renderer), vitest (jsdom and browser), `node --test`.

**Spec:** `docs/specs/google-drive-workspace.md` delivery row 4; `docs/specs/media-playback.md` (the protocol this generalises).

**Delivery:** ONE PR from branch `claude/google-drive-pr4`, version `0.98.0` -> `0.99.0`. Commit after every task. The controller does the manual check, line endings, push and PR.

## Decisions taken with the user (2026-10-06)

| Decision | Choice | Reason |
|---|---|---|
| Picture opens at | **Fit, never enlarged**: a picture larger than the panel is scaled down to fit; a smaller one shows at 100% | What Windows Photos and macOS Preview do. Replaces "always 100%" (the old reason, an unreadable shrunk screenshot, is answered by double-click and the 100% button). |
| Zoom gesture | **Ctrl+wheel (Cmd+wheel on macOS) and trackpad pinch, everywhere**: pictures, the editor and Preview. Shift+wheel goes back to sideways scrolling | Browsers, VS Code, Photos and Preview all do this. Chromium reports a pinch as a wheel event with `ctrlKey`, so one handler serves both. |
| Picture keys | Ctrl/Cmd + `=`/`+` and `-`/`_` step; **Ctrl/Cmd+0 = Fit**; **Ctrl/Cmd+1 = 100%** | Photoshop and Preview. For text, Ctrl+0 stays "back to 100%" and Ctrl+1 does nothing (not prevented). |

## Decisions taken while planning (controller)

| Decision | Choice | Reason |
|---|---|---|
| Byte source | `locate` answers `{ ok: true, size, open(start, end) }`; `open` answers `{ ok: true, body: ReadableStream }` or a failure | One handler for every streaming provider. The Range logic (`parseRange`, 206/416) stays in one place. |
| Drive size | From the listing entry (`sizeBytes`, cached up to 60 s), never a `fileMeta` per range request | A player makes many range requests. A file that changed size since its listing gets a 416 or a short read, which the player reports. Refresh fixes it. |
| Drive deadline | `downloadRange` races only **headers** against the 30 s deadline; the body streams with no deadline | A two-hour video cannot download in 30 s. The player cancels the stream on seek or close, and cancellation reaches `net.fetch` through the stream. |
| Drive retries | 401 (refresh once) and rate limit (wait once) as in `send`; a failed response's body is drained before the retry | Same rules as every other Drive read. |
| Drive range answered 200 | Accepted only when the request asked from byte 0; otherwise a failure | Drive honours `Range` on `alt=media`. A 200 for a mid-file seek would play the wrong bytes. |
| Not streamable | A Google Doc, a folder, or an entry with no `sizeBytes` answers `not-found` | No bytes to range over. |
| GitHub | Still refused (`errors.mediaNotLocal`) | Blobs arrive base64 with no range support. Unchanged. |
| `driveMediaNotLocal` | Removed: key, mapping and test | Drive media plays now; the i18n guard fails on an orphaned key. |
| Picture scale range | `PICTURE_MIN = 0.1` (or the Fit scale if smaller), `PICTURE_MAX = 8`; key steps walk `PICTURE_ZOOM_LEVELS` = `[0.1, 0.25, 0.33, ...ZOOM_LEVELS, 5, 6, 8]` | Text keeps its 0.5-4 ladder. A picture needs further out (huge scans) and further in (pixel inspection). |
| Wheel on a picture | Continuous: `scale * exp(-deltaPixels * 0.002)`, anchored at the pointer | A ladder per notch is jumpy under pinch, which sends many tiny deltas. 100% stays one double-click or Ctrl+1 away. |
| Wheel on text | Still the ladder, with deltas **accumulated** until 50 px of travel per step | Pinch sends many small deltas; one rung per event would rocket through the ladder. |
| Pan | Pictures: plain left-drag when the picture overflows (`cursor: grab`/`grabbing`). Text: Shift+drag, unchanged | A plain drag on text selects; on a picture it has no other job. |
| Fit on resize | While in Fit, a panel resize (ResizeObserver) refits | Fit is a mode, not a number. |
| Zoom readout | A small toolbar over the picture, bottom right: Fit, 100%, minus, the percentage, plus | Says where you are, and gives mouse-only users the two states. |
| Electron page zoom | Verify Ctrl+wheel over the app's chrome does not scale the whole window; if it does, suppress it in main (`webContents.setVisualZoomLevelLimits(1, 1)` and a `zoom-changed` no-op) | The surfaces prevent default; the chrome around them must not zoom the app. |

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine (jsdom fails on `console.error`; shell tests inject a collecting `logger`).
- Commands from the repo root. `npm ci`, never `npm install`. No new dependencies. Renderer tests: from `apps/app`, `npx vitest run <file>` (vitest is installed per workspace); browser suite `npm run test:browser`.
- Browser-suite pointer input uses `userEvent` from `vitest/browser`, never `@testing-library/user-event`.
- Domain: no React, Electron, `fs` or `node:*`. Shell: CommonJS, `node:test` + `node:assert/strict`.
- Failures cross IPC as results, never throws. Log lines: step + `error.code ?? error.name` only - never a URL, a file name, a token or `error.message`.
- Every Drive id is checked with `isDriveId` before it reaches a URL. The token never leaves main.
- Every user-facing string in `apps/app/src/locales/en.json` via literal `t("...")`; plain hyphens only in user-facing text.
- Files with regex escapes are written with the editor tools, not a heredoc. Do not repair line endings (the controller does, against `main`). Do not push.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `apps/desktop/src/googleDriveApi.js` (+test) | `downloadRange(id, start, end)`: streamed, header-only deadline, retries |
| `apps/desktop/src/googleDriveWorkspace.js` (+test) | `mediaSource(path)` |
| `apps/desktop/src/mediaProtocol.js` (+test) | serve a byte source; no `fs` reads of its own |
| `apps/desktop/src/ipcHandlers.js` (+ `googleDriveIpc.test.js`) | `locateMedia` adapts `locateFile` (local) and `mediaSource` (Drive) to a byte source |
| `apps/app/src/hooks/useWorkspace.ts` (+test), `locales/en.json` | Drive media opens; `driveMediaNotLocal` removed |
| `apps/app/src/lib/zoom.ts` (+test), `hooks/useZoomPan.ts` | Ctrl/Cmd+wheel with accumulation; `actual` key command |
| `apps/app/src/lib/pictureZoom.ts` (+test) | the picture view model, Fit, steps, wheel, anchoring |
| `apps/app/src/components/ImageViewer.tsx`, `EditorPanel.tsx` (+ jsdom and browser tests) | the viewer, its toolbar, its gestures and keys |
| `apps/desktop/src/main.js` | only if the Electron page-zoom check fails |
| Docs / release | version + mirrors, release notes, About, README, features.md, Architecture.md, spec, CLAUDE.md status line |

---

### Task 1: Shell - `downloadRange` on the Drive client

**Files:** `apps/desktop/src/googleDriveApi.js`, `apps/desktop/test/googleDriveApi.test.js`

**Produces:** `api.downloadRange(id, start, end)` answers `{ ok: true, status: 200 | 206, body: ReadableStream }` or `failure(reason)`. `start`/`end` are inclusive byte offsets; `end` may be `null` for open-ended.

- [ ] Tests first (fake `fetch` returning `new Response(stream, { status, headers })`):
  - Sends `Range: bytes=<start>-<end>` (or `bytes=<start>-` when `end` is null) with the bearer token, to `driveMediaUrl(id)`.
  - A 206 answers `{ ok: true, status: 206, body }`, and the body is the **unread** stream: assert the fake's stream has not been pulled before the caller reads it.
  - The deadline covers headers only: a fake whose headers arrive at once but whose body stalls past `timeoutMs` still answers ok (use a tiny `timeoutMs`; the test reads nothing from the body).
  - Headers that never arrive answer `offline` after `timeoutMs`, and the fetch's signal was aborted.
  - 401 then 206: refreshes once (`accessToken({ force: true })`) and answers the 206. The 401's body was consumed or cancelled (track it in the fake).
  - 429 then 206: waits once via injected `sleep`, then answers.
  - 416 answers `failure("unsatisfiable")`; 404 `not-found`; 403 `permission-denied` (via `driveErrorFor`).
  - A 200 to a request with `start === 0` is ok with `status: 200`; a 200 to `start > 0` answers `failure("offline")`, and its body is cancelled.
  - An id failing `isDriveId` answers `not-found` with no fetch.
  - No log line contains the URL, the id or the token.
- [ ] Implement as a sibling of `attempt`/`send` (do not route through `read`, which buffers): `attemptHeaders(url, token, headers)` races `fetch` against the deadline and returns the response unread; on a non-ok status read the JSON error body (bounded by the same deadline) for `driveErrorFor`. Map 416 before `driveErrorFor`.
- [ ] Run the shell suite; commit "Stream a byte range of a Drive file".

### Task 2: Shell - a byte source for the media protocol, and Drive's `mediaSource`

**Files:** `apps/desktop/src/mediaProtocol.js` (+test), `apps/desktop/src/ipcHandlers.js`, `apps/desktop/src/googleDriveWorkspace.js` (+test), `apps/desktop/test/googleDriveIpc.test.js`

**Produces:** `createMediaHandler({ locate })` where `locate(qualified)` answers `{ ok: true, size, open(start, end) }`; Drive provider `mediaSource(candidate)` answering the same shape; `locateMedia` adapting both.

- [ ] Media protocol tests first. Rewrite the fake `locate` to answer a byte source over an in-memory buffer, and keep every existing assertion (200 whole file, 206 ranges, suffix range, 416 with `bytes */size`, `Accept-Ranges`, empty file, 400/403/404). Add:
  - `open` is called with the inclusive `start`/`end` from `parseRange` (and `0, size - 1` for no Range); for an empty file `open` is not called and the body is empty.
  - `open` failing answers 502 with no body (`permission-denied` stays 403, `not-found` 404).
- [ ] `mediaProtocol.js`: drop `createReadStream`/`Readable`; `streamOf` moves to `ipcHandlers.js`'s local adapter. The handler calls `found.open(start, end)`.
- [ ] `locateMedia` in `ipcHandlers.js`: if the provider has `mediaSource`, return it; else if it has `locateFile`, wrap `{ ok, path, size }` as `{ ok, size, open: (s, e) => ({ ok: true, body: streamOf(path, s, e) }) }`; else `unsupported`. Test the local adapter through the real handlers (a temp file, a 206 read end to end) in the existing local media test file or `googleDriveIpc.test.js`'s neighbour, whichever already boots the handlers.
- [ ] Drive provider tests first (`googleDriveWorkspace.test.js`, using the fake api with a new `downloadRange` that records calls and answers a stream):
  - `mediaSource("clip.mp4")` answers `{ ok, size }` from the listing's `sizeBytes`, with **no** `fileMeta` and no download.
  - `open(10, 19)` calls `downloadRange(<fileId>, 10, 19)` and answers its body.
  - A path outside the workspace is `permission-denied` before Drive is asked; a folder, a Google Doc, an unknown path, and an entry with null `sizeBytes` answer `not-found`.
  - A path nobody has listed is found by the same walk `read` uses (`fileAt`).
- [ ] Implement `mediaSource` beside `readBytes` (reuse `drivePath` and `fileAt`).
- [ ] IPC test (`googleDriveIpc.test.js`): open a Drive workspace through the real handlers with the fake api, call `locateMedia(qualified)` and `open`, and assert the bytes; the token and the Drive URL appear in no log line.
- [ ] Run the shell suite; commit "Play video and audio from Google Drive, in ranges".

### Task 3: Renderer - Drive media opens

**Files:** `apps/app/src/hooks/useWorkspace.ts` (+test), `apps/app/src/locales/en.json`

- [ ] Tests first: opening `Notes/clip.mp4` in a Drive workspace opens a media document with `source === mediaUrl(path)` and `kind: "video"` (likewise an `.mp3` as audio); a GitHub workspace still answers `errors.mediaNotLocal`. Update the existing `driveMediaNotLocal` tests (useWorkspace.test.ts around the `providerFailureKey` block and the openPath media block) to the new behaviour.
- [ ] Replace `isKnownNonLocal` with `cannotStream(workspaces, path)`: true only for a known workspace whose `ref.kind === "github"`. Keep the comment's point (the shell decides; this only improves wording). Remove the `google-drive` + `media-not-local` mapping in `providerFailureKey` and the `errors.driveMediaNotLocal` key.
- [ ] Run the renderer suite (the i18n guard included); commit "Open Drive video and audio in the player".

### Task 4: Renderer - Ctrl/Cmd+wheel zooms text, with pinch

**Files:** `apps/app/src/lib/zoom.ts` (+test), `apps/app/src/hooks/useZoomPan.ts`, `apps/app/src/components/EditorPanel.tsx` (+ `EditorPanel.test.tsx`, `EditorPanel.browser.test.tsx`)

**Produces:** `wheelZoomTravel(event): number | null` (pixels of zoom travel, negative = in, null when not a zoom gesture); `ZoomCommand` gains `"actual"` for Ctrl/Cmd+1.

- [ ] `zoom.test.ts` first:
  - Ctrl+wheel (`ctrlKey`, `deltaY`) is zoom travel on every platform (a pinch arrives as `ctrlKey` on macOS and Windows); Cmd+wheel (`metaKey`) is zoom travel too. Shift alone is **not** (null). Plain wheel is null.
  - `deltaMode` 1 (lines) is converted at 40 px per line, mode 2 (pages) at 800.
  - `zoomKeyCommand` answers `"actual"` for Ctrl+1 (Cmd+1 on macOS), with the existing Alt and platform-modifier rules.
- [ ] `useZoomPan`: replace the Shift check with `wheelZoomTravel`; accumulate travel and call `onZoom("in" | "out")` once per 50 px, keeping the remainder; reset the accumulator when the direction flips. Shift+drag pan unchanged. Update the hook's doc comment.
- [ ] `EditorPanel`'s key handler: `"actual"` is ignored for text (no `preventDefault`).
- [ ] Update the jsdom and browser tests that dispatch Shift+wheel to Ctrl+wheel, and add: Shift+wheel no longer zooms; ten small pinch deltas (`ctrlKey`, `deltaY: -5`) step one rung, not ten.
- [ ] Run the renderer and browser suites; commit "Zoom text with Ctrl and the wheel, and by pinching".

### Task 5: Renderer - picture view: Fit, 100%, zoom about the pointer, drag to pan

**Files:** `apps/app/src/lib/pictureZoom.ts` (+test, new), `apps/app/src/components/ImageViewer.tsx`, `apps/app/src/components/EditorPanel.tsx` (+ jsdom and browser tests), `apps/app/src/locales/en.json`

**Produces (pure):**
```ts
export type PictureView = { kind: "fit" } | { kind: "scale"; scale: number };
export const PICTURE_MAX = 8;
export const PICTURE_ZOOM_LEVELS: readonly number[]; // [0.1, 0.25, 0.33, ...ZOOM_LEVELS, 5, 6, 8]
export function fitScale(natural: Size, box: Size): number;           // min(1, box.w / n.w, box.h / n.h); 1 for a zero box
export function minScale(fit: number): number;                        // min(0.1, fit)
export function scaleOf(view: PictureView, fit: number): number;
export function stepPicture(view: PictureView, fit: number, dir: ZoomDirection): PictureView; // next rung from the effective scale, clamped
export function wheelPicture(view: PictureView, fit: number, travel: number): PictureView;     // scale * exp(-travel * 0.002), clamped
export function toggleFit(view: PictureView, fit: number): PictureView;  // fit (or a scale equal to fit) -> 100%; anything else -> fit
export function anchoredScroll(a: { scroll: Point; pointer: Point; offset: Point; oldScale: number; newScale: number; newOffset: Point }): Point;
// picture point under the pointer = (scroll + pointer - offset) / oldScale; new scroll = point * newScale + newOffset - pointer, floored at 0
```
- [ ] `pictureZoom.test.ts` first: every function above, including clamps at both ends, Fit never above 1, a picture smaller than the box fitting at exactly 1, `toggleFit` from Fit to 100% and back, a step from Fit starting at the fit scale, and `anchoredScroll` keeping the picture point under the pointer.
- [ ] `EditorPanel`: pictures keep a `PictureView` per path (`pictureViews`, default `{ kind: "fit" }`, not persisted) instead of the numeric `zooms`. The window key handler, when the document on screen is a picture: `in`/`out` step, `reset` -> Fit, `actual` -> 100%, each with `preventDefault`. The text path is unchanged.
- [ ] `ImageViewer` (props: `source`, `name`, `view`, `onView(next: PictureView, anchor: Point | null)`):
  - Layout: the scroller (`overflow-auto bg-sunken`) holds a wrapper `display: grid; place-items: center; min-width: 100%; min-height: 100%; width: max-content; padding: 16px`, which centres a small picture and lets a large one scroll from 0. The `img` gets explicit pixel width and height (`natural * scale`), never a transform.
  - Fit: measured from the scroller's client box minus the padding, re-measured by a `ResizeObserver` while the view is Fit.
  - Ctrl/Cmd+wheel and pinch: a non-passive wheel listener using `wheelZoomTravel`; `preventDefault`; `wheelPicture`; then, in a layout effect after the new size renders, set the scroll with `anchoredScroll` (the offset is the `img`'s `offsetLeft/Top` within the wrapper).
  - Drag: plain left-button drag pans (`panScroll`) when the picture overflows; `cursor: grab`, `grabbing` while dragging. A click without travel does nothing.
  - Double-click: `toggleFit`, anchored at the click point.
  - Toolbar (absolute, bottom right, over the picture, token colours): buttons Fit (`aria-pressed` in Fit), 100% (`aria-pressed` at scale 1), zoom out, a live percentage (`role="status"`), zoom in. New keys under `editor.picture.*` (`fit`, `actual`, `zoomIn`, `zoomOut`, `zoomLevel` with `{{percent}}`).
- [ ] jsdom tests (`EditorPanel.test.tsx` "zooming an image" block, rewritten): opens in Fit; the buttons switch Fit and 100% and step; Ctrl+0 returns to Fit and Ctrl+1 goes to 100%; Ctrl+1 does nothing to a text document's zoom.
- [ ] Browser tests (`EditorPanel.browser.test.tsx` "Zooming a picture" block, rewritten with real geometry): a picture larger than the panel opens scaled to fit and never above 100% for a small one; Ctrl+wheel over a point keeps that point under the pointer (within 1 px); drag pans; double-click toggles Fit and 100%; resizing the panel refits while in Fit.
- [ ] Run the renderer and browser suites; commit "Fit, 100% and zoom about the pointer for pictures".

### Task 6: Release and docs (the controller does the manual check, line endings, push and PR)

- [ ] `0.99.0` in `version.json` and every mirror (exactly five `package-lock.json` entries).
- [ ] `RECENT[0]` (PR number confirmed before `gh pr create`): headline, prose summary, added/changed bullets - Drive video and audio, picture Fit/100%/zoom/pan for every source, Ctrl/Cmd+wheel and pinch replace Shift+wheel.
- [ ] README, `docs/features.md` and the About box in lockstep: the Images, Zoom and pan, and Google Drive rows (drop "videos and audio in Drive are not playable yet" wherever it appears).
- [ ] `docs/Architecture.md`: the media protocol's byte source, `downloadRange` and its header-only deadline, Drive `mediaSource`, the picture view model, and the gesture change in the zoom section.
- [ ] Spec: PR 4 delivered. `CLAUDE.md` status line: Google Drive folders are no longer "in progress".
- [ ] Manual check (controller, dev build): a Drive `.mp4` plays and seeks (shared drive and My Drive); an `.mp3` plays; a large picture opens at Fit and a small one at 100%; Ctrl+wheel, pinch, drag, double-click, Ctrl+0, Ctrl+1; Ctrl+wheel in the editor and Preview; Ctrl+wheel over the folder browser does not scale the app (else the main-process fix from the decisions table).
