# Video and audio playback - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play video and audio files from a local workspace in the centre panel, with transport
controls and fullscreen.

**Architecture:** A privileged `tp-media://` scheme registered before app-ready and served by
`protocol.handle` in the main process, honouring HTTP `Range` so seeking works and memory stays flat
whatever the file size. The renderer builds the URL from the qualified workspace path and reads
nothing over IPC, so the entire new cross-process surface is one handler. Two new catalogue rows
(`video`, `audio`) make the files visible and openable; one new component plays them.

**Tech Stack:** Electron 44.1.0 (Chromium 152), React 19, TypeScript, zod, vitest (renderer +
domain), `node --test` (shell), Playwright (browser suite).

**Spec:** `docs/specs/media-playback.md`

## Global Constraints

Copied from the spec and from CLAUDE.md. Every task's requirements implicitly include these.

- **TDD is required.** Write the failing test, run it, watch it fail, then write the minimal code.
  No production code without a failing test that preceded it.
- **Test output must be pristine.** A passing run prints no errors and no warnings.
- **No em dashes or en dashes in user-facing text.** Plain hyphen `-` in every UI string, i18n value
  and release note. Code, comments and internal docs are exempt.
- **No real user data anywhere** - not in fixtures, tests, commits, issues or PRs. Invent names
  (`Ada`, `Grace`, `Alice`).
- **The renderer is untrusted.** Every boundary check happens in the main process. The renderer
  having already checked is not a check.
- **The boundary check lives in one shared module.** Never re-implement it per caller.
- **Declared media types are decided in the main process from the file's name**, never accepted from
  the renderer.
- **The branch is `spec/media-playback`.** `main` is branch-protected; this lands as one PR.
- **This is a feature, not a fix, so no GitHub issue is required.** The PR body states the
  deployment surface.
- **Exact media type values** (used verbatim in several tasks):
  `mp4`/`m4v`/`mov` -> `video/mp4`; `webm` -> `video/webm`; `mkv` -> `video/x-matroska`;
  `3gp` -> `video/3gpp`; `mp3` -> `audio/mpeg`; `m4a` -> `audio/mp4`; `aac` -> `audio/aac`;
  `wav` -> `audio/wav`; `flac` -> `audio/flac`; `ogg`/`oga`/`opus` -> `audio/ogg`;
  `weba` -> `audio/webm`.
- **Final version is 0.87.0** and the settings schema version becomes **22**.
- **Windows line endings:** this repo has mixed CRLF/LF files. After every edit run
  `git diff --stat` and confirm the line count is the change you made, not the whole file.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/domain/src/mediaFiles.ts` | **new.** Extension to media type, `mediaKindFor`, the URL's two halves (`mediaUrl`, `mediaPathFromUrl`). Pure, no Electron, no `fs`. |
| `packages/domain/src/mediaFiles.test.ts` | **new.** |
| `packages/domain/src/fileTypes.ts` | Two catalogue rows; `FileTypeKind` gains `video` and `audio`; the `images` group becomes `media`. |
| `packages/domain/src/settings.ts` | Migration to version 22. |
| `packages/domain/src/openDocuments.ts` | `media` widens to carry its kind. |
| `packages/domain/src/index.ts` | Barrel exports. |
| `apps/desktop/src/mediaRange.js` | **new, pure.** A `Range` header to a start, end and length. |
| `apps/desktop/src/openWorkspaces.js` | **new.** The open-workspace map and the qualified-path locator, extracted so two callers share one boundary check. |
| `apps/desktop/src/mediaProtocol.js` | **new.** The scheme's privileges and its request handler. |
| `apps/desktop/src/localWorkspace.js` | A `locate` method, for the one caller that streams. |
| `apps/desktop/src/ipcHandlers.js` | Uses the extracted registry; exposes `locateMedia` for the protocol. |
| `apps/desktop/src/main.js` | Registers the scheme before app-ready and the handler after. |
| `apps/app/src/components/MediaPlayer.tsx` | **new.** The player, for both kinds. |
| `apps/app/src/components/EditorPanel.tsx` | Picks viewer or player from `media.kind`. |
| `apps/app/src/hooks/useWorkspace.ts` | `openPath` opens media without a read; refuses non-local. |
| `apps/app/src/components/WorkspacePanel.tsx` | "Add to chat" excluded for media. |
| `apps/app/src/locales/en.json` | Labels, the group name, the player's two failure lines. |

**Intermediate state warning:** after Task 1 the tree lists video files and the editor will try to
read one as text and show an error banner. That is expected and is fixed in Task 9. Nothing is
merged until the whole branch is green.

---

## Task 1: The media catalogue

**Files:**
- Create: `packages/domain/src/mediaFiles.ts`
- Create: `packages/domain/src/mediaFiles.test.ts`
- Modify: `packages/domain/src/fileTypes.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `FileTypeId` from `./fileTypes`.
- Produces: `VIDEO_TYPE_ID`, `AUDIO_TYPE_ID`, `MediaKind = "video" | "audio"`,
  `mediaKindFor(name: string): MediaKind | null`, `mediaTypeFor(name: string): string | null`,
  `isMediaName(name: string): boolean`. `FileTypeKind` gains `"video" | "audio"`.
  `FileTypeGroup`'s `"images"` becomes `"media"`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/mediaFiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_TYPES, FILE_TYPES, fileTypeFor } from "./fileTypes";
import { AUDIO_TYPE_ID, VIDEO_TYPE_ID, isMediaName, mediaKindFor, mediaTypeFor } from "./mediaFiles";

/// What this app will play, measured rather than assumed.
///
/// Every type here answered "probably" to `canPlayType` in Electron 44.1.0 (Chromium 152). The
/// absences are measured too: Theora was removed from Chromium in 2024, and there is no demuxer for
/// AVI, WMV, MPEG or FLV. A row for one of those would open a file and then fail to play it.
describe("video files", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens the containers the engine can demux", () => {
    for (const name of ["a.mp4", "a.m4v", "a.mov", "a.webm", "a.mkv", "a.3gp"]) {
      expect(openedAs(name)).toBe(VIDEO_TYPE_ID);
    }
  });

  it("leaves out the containers the engine cannot demux", () => {
    for (const name of ["a.ogv", "a.avi", "a.wmv", "a.mpg", "a.mpeg", "a.flv"]) {
      expect(openedAs(name)).toBe(null);
    }
  });

  // `video/quicktime` is refused outright, even with an explicit H.264 codec string. MOV and MP4
  // are both ISO base media format, so the MP4 demuxer reads both - and declaring `video/mp4` is
  // the only way a `.mov` plays at all. Recorded here because it is a deliberate exception to the
  // rule that a media type is read from the name and never substituted.
  it("declares a QuickTime file as mp4, because quicktime is refused", () => {
    expect(mediaTypeFor("clip.mov")).toBe("video/mp4");
  });

  it("is its own kind, so nothing tries to edit it", () => {
    expect(FILE_TYPES.find((type) => type.id === VIDEO_TYPE_ID)?.kind).toBe("video");
  });

  it("offers no view modes", () => {
    expect(FILE_TYPES.find((type) => type.id === VIDEO_TYPE_ID)?.modes).toEqual([]);
  });
});

describe("audio files", () => {
  const openedAs = (name: string) => fileTypeFor(name, DEFAULT_FILE_TYPES)?.id ?? null;

  it("opens the formats the engine can decode", () => {
    for (const name of ["a.mp3", "a.m4a", "a.aac", "a.wav", "a.flac", "a.ogg", "a.oga", "a.opus", "a.weba"]) {
      expect(openedAs(name)).toBe(AUDIO_TYPE_ID);
    }
  });

  it("leaves out the formats the engine cannot decode", () => {
    for (const name of ["a.wma", "a.aiff"]) expect(openedAs(name)).toBe(null);
  });

  // `audio/x-flac` is refused and `audio/flac` is not. One character, and the difference between a
  // file that plays and one that does not.
  it("declares FLAC as audio/flac, never audio/x-flac", () => {
    expect(mediaTypeFor("song.flac")).toBe("audio/flac");
  });
});

describe("mediaKindFor", () => {
  it("separates the two kinds", () => {
    expect(mediaKindFor("clip.MP4")).toBe("video");
    expect(mediaKindFor("song.Mp3")).toBe("audio");
  });

  it("claims nothing that is not media", () => {
    for (const name of ["notes.md", "photo.png", "a.ts", "noextension", ".gitignore"]) {
      expect(mediaKindFor(name)).toBe(null);
      expect(isMediaName(name)).toBe(false);
    }
  });

  it("answers null rather than guessing a type it does not know", () => {
    expect(mediaTypeFor("movie.rmvb")).toBe(null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --root packages/domain mediaFiles
```

Expected: FAIL - cannot resolve `./mediaFiles`.

- [ ] **Step 3: Write `packages/domain/src/mediaFiles.ts`**

```ts
import { type FileTypeId } from "./fileTypes";

/// Video and audio - looked at and listened to, never edited.
///
/// The same shape as `imageFiles.ts` and for the same reason: the read boundary refuses anything
/// binary, which is right for a document and wrong for a recording. What differs is the route out
/// of the shell. A picture crosses IPC as a data URL; a clip is far too large for that, and a data
/// URL cannot be seeked because seeking is byte ranges. So media travels over its own streaming
/// protocol, and this module owns both halves of its URL so the two processes cannot disagree.
///
/// **The format list is measured, not assumed.** Every type below answered "probably" to
/// `canPlayType` in Electron 44.1.0 (Chromium 152); every common format that is absent answered
/// "no" and would have opened a file this app then could not play.

export const VIDEO_TYPE_ID: FileTypeId = "video";
export const AUDIO_TYPE_ID: FileTypeId = "audio";

export type MediaKind = "video" | "audio";

/// `mov` is declared as `video/mp4` deliberately.
///
/// `video/quicktime` is refused by the engine even with an explicit H.264 codec string, and MOV is
/// an ISO base media file exactly as MP4 is - the same demuxer reads both. Leaving it out would
/// leave out every video an iPhone records.
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  // Partially supported, and included knowingly: H.264 and AV1 play, VP9 and AC-3 do not. The
  // player says so plainly rather than showing a black rectangle, which is what makes this
  // defensible - omitting the row would fail the common case to avoid admitting the uncommon one.
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
};

/// `flac` is `audio/flac`. `audio/x-flac` is refused, and the two differ by two characters.
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  // `.ogg` can carry video, but in a folder of notes it essentially never does, and one extension
  // gets one owner - the rule that put `.svg` with XML rather than with pictures.
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
};

function extensionOf(name: string): string {
  // `dot <= 0` rather than `=== -1`: a leading dot is a hidden file, not a name that is all
  // extension.
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function mediaKindFor(name: string): MediaKind | null {
  const extension = extensionOf(name);
  if (extension in VIDEO_TYPES) return "video";
  if (extension in AUDIO_TYPES) return "audio";
  return null;
}

/// What the main process tells the window the bytes are, or null when nothing here claims the name.
///
/// Null rather than a default: a declared type is an instruction about how to interpret bytes, and
/// the wrong one tells the engine to read one kind of file as another.
export function mediaTypeFor(name: string): string | null {
  const extension = extensionOf(name);
  return VIDEO_TYPES[extension] ?? AUDIO_TYPES[extension] ?? null;
}

export function isMediaName(name: string): boolean {
  return mediaKindFor(name) !== null;
}
```

- [ ] **Step 4: Add the two catalogue rows**

In `packages/domain/src/fileTypes.ts`, widen the two unions:

```ts
export type FileTypeId =
  | "markdown"
  | "text"
```
becomes the same list with `| "video"` and `| "audio"` added after `| "image"`.

```ts
export type FileTypeGroup = "documents" | "data" | "media" | "languages" | "utility";
```

```ts
/// `video` and `audio` are not editing behaviours either. Like `image` they are the ABSENCE of
/// editing: the file never reaches CodeMirror, is never written, and leaves the shell by a route of
/// its own - for media, a streaming protocol rather than IPC at all.
export type FileTypeKind = "prose" | "plain" | "code" | "image" | "video" | "audio";
```

```ts
export const FILE_TYPE_GROUPS: readonly FileTypeGroup[] = [
  "documents",
  "data",
  "media",
  "languages",
  "utility",
];
```

Change the existing image row's `group: "images"` to `group: "media"`, and add two rows directly
after it:

```ts
  {
    id: "video",
    labelKey: "fileTypes.video",
    group: "media",
    // Measured against Electron 44.1.0 - see mediaFiles.ts. No ogv: Theora is gone from Chromium.
    extensions: ["mp4", "m4v", "mov", "webm", "mkv", "3gp"],
    filenames: [],
    // Nothing to switch between, as with a picture. Live and Preview are markdown constructs and
    // Source is text; a recording is none of the three.
    modes: [],
    kind: "video",
    pinned: false,
  },
  {
    id: "audio",
    labelKey: "fileTypes.audio",
    group: "media",
    extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"],
    filenames: [],
    modes: [],
    kind: "audio",
    pinned: false,
  },
```

- [ ] **Step 5: Export from the barrel**

In `packages/domain/src/index.ts`, beside the existing `./imageFiles` export block:

```ts
export {
  AUDIO_TYPE_ID,
  VIDEO_TYPE_ID,
  isMediaName,
  mediaKindFor,
  mediaTypeFor,
} from "./mediaFiles";
export type { MediaKind } from "./mediaFiles";
```

- [ ] **Step 6: Add the labels**

In `apps/app/src/locales/en.json`, in the `fileTypes` block beside `"image": "Images"`:

```json
    "video": "Video",
    "audio": "Audio",
```

and rename the group key under `settings.fileTypes.group`, replacing `"images": "Images"` with:

```json
        "media": "Pictures, video and audio",
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run --root packages/domain mediaFiles
npm test
```

Expected: the new file passes. `i18nKeys.test.ts` passes because `fileTypes.video`, `fileTypes.audio`
and the group key are all reached through `labelKey` and the group loop, which the guard resolves
through the catalogue. If the guard reports `settings.fileTypes.group.images` as orphaned, the
rename missed a usage - search for `"images"` and finish it.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/mediaFiles.ts packages/domain/src/mediaFiles.test.ts packages/domain/src/fileTypes.ts packages/domain/src/index.ts apps/app/src/locales/en.json
git commit -m "Add video and audio to the file type catalogue"
```

---

## Task 2: Existing installations get the new rows

**Files:**
- Modify: `packages/domain/src/settings.ts`
- Modify: `packages/domain/src/settings.test.ts`

**Interfaces:**
- Consumes: `SETTINGS_MIGRATIONS` and `SETTINGS_VERSION` from `./settings`.
- Produces: `SETTINGS_VERSION === 22`.

**Why this departs from the written rule:** `docs/specs/file-types.md` says new types get no
migration, because an upgrade must not change what somebody's folder browser shows. That protects a
choice the user made. Nobody chose to exclude video - there was no row to leave unticked. So this
one migrates, and the release notes say so and name the page to untick it on.

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/settings.test.ts`:

```ts
describe("version 22", () => {
  // A type that did not exist when a list was written was never a choice. Migrating is the
  // difference between shipping this feature and shipping it switched off for everybody who
  // already has the app.
  it("gives an existing installation the video and audio rows", () => {
    const loaded = loadSettings({
      schemaVersion: 21,
      ...DEFAULT_SETTINGS,
      fileTypes: { enabled: ["markdown", "json"] },
    });

    expect(loaded.fileTypes.enabled).toContain("video");
    expect(loaded.fileTypes.enabled).toContain("audio");
  });

  it("keeps every other type the user had", () => {
    const loaded = loadSettings({
      schemaVersion: 21,
      ...DEFAULT_SETTINGS,
      fileTypes: { enabled: ["markdown", "json"] },
    });

    expect(loaded.fileTypes.enabled).toContain("markdown");
    expect(loaded.fileTypes.enabled).toContain("json");
  });

  it("does not list a type twice when the file already has it", () => {
    const loaded = loadSettings({
      schemaVersion: 21,
      ...DEFAULT_SETTINGS,
      fileTypes: { enabled: ["markdown", "video"] },
    });

    expect(loaded.fileTypes.enabled.filter((id) => id === "video")).toHaveLength(1);
  });
});
```

Check the imports at the top of that file already cover `loadSettings` and `DEFAULT_SETTINGS`; add
whichever is missing.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --root packages/domain settings
```

Expected: FAIL - `enabled` does not contain `"video"`.

- [ ] **Step 3: Bump the version and add the migration**

In `packages/domain/src/settings.ts`, change the constant:

```ts
export const SETTINGS_VERSION = 22;
```

and add a new entry at the **top** of `SETTINGS_MIGRATIONS` (the array runs newest first):

```ts
  {
    to: 22,
    // Version 22 added video and audio. Unlike every other type added since version 11, these are
    // appended to an existing list rather than left for the user to find. `file-types.md` says not
    // to migrate, and that rule protects a choice somebody MADE; nobody chose to exclude a type
    // that had no row. Written out rather than read from a constant, because a migration is a
    // record of what a version did and must not change when the catalogue does.
    migrate: (input) => {
      const fileTypes = (input as { fileTypes?: { enabled?: unknown } }).fileTypes ?? {};
      const enabled = Array.isArray(fileTypes.enabled) ? fileTypes.enabled : [];
      const added = ["video", "audio"].filter((id) => !enabled.includes(id));
      return { ...input, fileTypes: { ...fileTypes, enabled: [...enabled, ...added] } };
    },
  },
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run --root packages/domain settings
npm test
```

Expected: PASS. If a test asserts `SETTINGS_VERSION` literally, update it to 22.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/settings.ts packages/domain/src/settings.test.ts
git commit -m "Give an upgrade the video and audio file types"
```

---

## Task 3: Parsing a Range header

**Files:**
- Create: `apps/desktop/src/mediaRange.js`
- Create: `apps/desktop/test/mediaRange.test.js`

**Interfaces:**
- Produces: `parseRange(header, size)` returning `null` (send the whole file),
  `{ unsatisfiable: true }` (416), or `{ start, end, length }` with inclusive `start` and `end`.

Pure and separate from the handler on purpose: this is where the off-by-ones live, and it can be
tested exhaustively without Electron, a window or a filesystem.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/mediaRange.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRange } = require("../src/mediaRange");

/// Seeking a video IS a range request, so these numbers are the scrub bar.
///
/// Both ends of a byte range are INCLUSIVE, which is the off-by-one this module exists to get right
/// in one place: `bytes=0-0` is one byte, not zero.

test("no header means the whole file", () => {
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange("", 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

test("an open-ended range runs to the last byte", () => {
  assert.deepEqual(parseRange("bytes=0-", 1000), { start: 0, end: 999, length: 1000 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999, length: 500 });
});

test("both ends are inclusive", () => {
  assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199, length: 100 });
  assert.deepEqual(parseRange("bytes=0-0", 1000), { start: 0, end: 0, length: 1 });
});

// `bytes=-500` is the LAST 500 bytes, not the first 500. Reading it the other way serves the wrong
// part of the file and the player shows nothing, with no error anywhere to explain it.
test("a suffix range is the last n bytes", () => {
  assert.deepEqual(parseRange("bytes=-500", 1000), { start: 500, end: 999, length: 500 });
});

test("a suffix larger than the file is the whole file", () => {
  assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999, length: 1000 });
});

test("an end past the file is clamped to the last byte", () => {
  assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999, length: 100 });
});

test("a start past the file cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=1000-", 1000), { unsatisfiable: true });
  assert.deepEqual(parseRange("bytes=2000-3000", 1000), { unsatisfiable: true });
});

test("a backwards range cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=500-100", 1000), { unsatisfiable: true });
});

test("an empty file cannot satisfy any range", () => {
  assert.deepEqual(parseRange("bytes=0-", 0), { unsatisfiable: true });
});

// Answering 200 with the whole file is a legitimate response to a Range a server will not honour,
// and a media element copes with it. Guessing at one of several ranges would not be legitimate.
test("several ranges at once are declined, and the whole file is sent", () => {
  assert.equal(parseRange("bytes=0-99,200-299", 1000), null);
});

test("a header that is not a byte range is ignored", () => {
  assert.equal(parseRange("items=0-99", 1000), null);
  assert.equal(parseRange("bytes=abc-def", 1000), null);
  assert.equal(parseRange("bytes=-", 1000), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test apps/desktop/test/mediaRange.test.js
```

Expected: FAIL - cannot find `../src/mediaRange`.

- [ ] **Step 3: Write `apps/desktop/src/mediaRange.js`**

```js
"use strict";

/// A `Range` header, as a position in a file of `size` bytes.
///
/// Three answers, because a range request has three outcomes and collapsing any two of them loses
/// the one the caller has to behave differently about:
///
///  - `null`     - there is no range to honour. Send the whole file, 200.
///  - `{ unsatisfiable: true }` - the header asks for bytes that are not there. 416, not 200: a
///                 player given the start of a file it asked to seek past will sit there silently.
///  - `{ start, end, length }` - serve exactly that, 206. Both ends INCLUSIVE.
///
/// Pure, and its own module, because every mistake available here is an off-by-one and they are all
/// invisible in ordinary playback - a video that only misbehaves when you drag the scrub bar to the
/// last second is a bug nobody reports clearly.
function parseRange(header, size) {
  if (typeof header !== "string") return null;

  const trimmed = header.trim();
  if (trimmed === "") return null;

  // One range only. A comma means several, which this declines by answering "no range" - serving
  // the whole file is a legal response to a Range header, and serving a guess is not.
  const match = /^bytes=(\d*)-(\d*)$/.exec(trimmed);
  if (match === null) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  // A suffix range: `bytes=-500` is the LAST 500 bytes. Reading it as "the first 500" serves the
  // wrong part of the file and looks, from the player, like nothing happened.
  if (rawStart === "") {
    const wanted = Number(rawEnd);
    if (wanted === 0 || size === 0) return { unsatisfiable: true };
    const start = Math.max(0, size - wanted);
    return { start, end: size - 1, length: size - start };
  }

  const start = Number(rawStart);
  if (start >= size) return { unsatisfiable: true };

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { unsatisfiable: true };

  return { start, end, length: end - start + 1 };
}

module.exports = { parseRange };
```

- [ ] **Step 4: Run the tests**

```bash
node --test apps/desktop/test/mediaRange.test.js
```

Expected: PASS, all 12.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/mediaRange.js apps/desktop/test/mediaRange.test.js
git commit -m "Parse a byte range, inclusive at both ends"
```

---

## Task 4: One registry, two callers

**Files:**
- Create: `apps/desktop/src/openWorkspaces.js`
- Modify: `apps/desktop/src/ipcHandlers.js:83` (the `open` map) and `:157-163` (`locateQualified`)

**Interfaces:**
- Produces: `openWorkspaces` (the `Map`), and
  `locateQualifiedPath(qualifiedPath: string): { workspace, path } | null`.

A pure refactor. The protocol handler needs the same registry and the same locator the IPC handlers
use, and CLAUDE.md requires the boundary check to live in **one** shared module rather than being
written twice with a small difference nobody notices.

- [ ] **Step 1: Create the shared module**

Create `apps/desktop/src/openWorkspaces.js`:

```js
"use strict";

const { splitQualified } = require("@trypthos/domain");

/// The open workspaces, by the id the main process minted for each.
///
/// Module state on purpose, and shared by the two surfaces that can reach a file: the IPC handlers
/// and the media protocol. A renderer can name an id - which is a thing this side made up - and can
/// never name a root, which would be a way to reach any directory on the machine.
///
/// It lives here rather than in `ipcHandlers.js` because the protocol needs the same map AND the
/// same lookup. Two copies of this would be two boundary checks, and the day they differ is the day
/// one of them is wrong in a way nothing fails on.
const openWorkspaces = new Map();

/// The ONE place a qualified path is taken apart.
///
/// What comes out is an ordinary workspace-relative path, and it goes to the provider's guard
/// unchanged: naming a workspace adds a folder to a path, never permission to leave it.
function locateQualifiedPath(qualifiedPath) {
  const split = splitQualified(qualifiedPath ?? "");
  if (split === null) return null;

  const workspace = openWorkspaces.get(split.workspaceId);
  return workspace === undefined ? null : { workspace, path: split.path };
}

module.exports = { openWorkspaces, locateQualifiedPath };
```

- [ ] **Step 2: Point `ipcHandlers.js` at it**

Replace the declaration at `apps/desktop/src/ipcHandlers.js:83`:

```js
const open = new Map();
```

with a require near the other requires at the top of the file, and an alias where the map was:

```js
const { openWorkspaces, locateQualifiedPath } = require("./openWorkspaces");
```

```js
/// The open workspaces. Shared with the media protocol - see `openWorkspaces.js` for why this is
/// not local to this file.
const open = openWorkspaces;
```

Then replace the body of `locateQualified` at `:157`, keeping its request-shaped signature so no
call site changes:

```js
function locateQualified(request) {
  return locateQualifiedPath(request.path ?? "");
}
```

Leave its existing doc comment in place and add one line to it: `Delegates to openWorkspaces.js, so
the protocol and the IPC surface cannot drift apart.`

- [ ] **Step 3: Run the shell suite**

```bash
npm test --workspace trypthos-desktop
```

Expected: PASS, with no change in the count. This step changes no behaviour; if anything fails, the
alias is wrong, not the tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/openWorkspaces.js apps/desktop/src/ipcHandlers.js
git commit -m "Share one open-workspace registry between IPC and anything else"
```

---

## Task 5: The provider can locate a file to stream

**Files:**
- Modify: `apps/desktop/src/localWorkspace.js` (add `locate` to the returned object, beside
  `readBytes` at `:258-285`)
- Modify: `apps/desktop/test/localWorkspace.test.js`

**Interfaces:**
- Produces: `provider.locate(relativePath)` answering
  `{ ok: true, path: string, size: number }` or a failure with a `reason`.
  **Only the local provider has it.** `githubWorkspace.js` deliberately does not, which is how
  playback stays local-only without a second place deciding that.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/test/localWorkspace.test.js`, following the harness already in that file:

```js
test("locate answers a real path and a size for a file in the workspace", async () => {
  await withWorkspace({ "clip.mp4": "0123456789" }, async ({ provider }) => {
    const found = await provider.locate("clip.mp4");
    assert.equal(found.ok, true);
    assert.equal(found.size, 10);
    assert.equal(path.basename(found.path), "clip.mp4");
  });
});

// The same two gates as every other call: the lexical guard, then realpath against the root. A
// streaming caller must not get a cheaper check than a reading one.
test("locate refuses a path that leaves the workspace", async () => {
  await withWorkspace({ "clip.mp4": "x" }, async ({ provider }) => {
    for (const bad of ["../outside.mp4", "a/../../outside.mp4"]) {
      const found = await provider.locate(bad);
      assert.equal(found.ok, false, bad);
      assert.equal(found.reason, "permission-denied", bad);
    }
  });
});

test("locate refuses a directory, which has no bytes to serve", async () => {
  await withWorkspace({ "folder/clip.mp4": "x" }, async ({ provider }) => {
    const found = await provider.locate("folder");
    assert.equal(found.ok, false);
  });
});

test("locate reports a missing file rather than throwing", async () => {
  await withWorkspace({ "clip.mp4": "x" }, async ({ provider }) => {
    const found = await provider.locate("gone.mp4");
    assert.equal(found.ok, false);
    assert.equal(found.reason, "not-found");
  });
});
```

If that file's harness exposes something other than `provider`, match whatever it already yields,
and add `const path = require("node:path");` at the top if it is not already required.

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test apps/desktop/test/localWorkspace.test.js
```

Expected: FAIL - `provider.locate is not a function`.

- [ ] **Step 3: Add the method**

In `apps/desktop/src/localWorkspace.js`, directly after `readBytes` in the returned object:

```js
    /// Where a file really is, and how big, for the one caller that must STREAM rather than read.
    ///
    /// The media protocol serves byte ranges out of a file that may be gigabytes, so it cannot go
    /// through `readBytes` - that answers with the whole thing in memory. What it needs is a path it
    /// is allowed to open, and that permission is this function's whole purpose.
    ///
    /// **The boundary is unchanged.** Same `resolve`, so the same lexical guard and the same
    /// realpath check that stops a symlink out of the workspace. A streaming caller gets no cheaper
    /// check than a reading one.
    ///
    /// The size comes back with the path because a range response needs both, and asking twice is
    /// two answers about a file that can change in between.
    ///
    /// Deliberately absent from the GitHub provider: a repository's blobs arrive base64 over an
    /// API with no ranges, so playback is local-only and this is the one place that says so.
    async locate(relativePath) {
      const resolved = await resolve(relativePath, { mustExist: true });
      if (!resolved.ok) return resolved;

      try {
        const stats = await fs.stat(resolved.path);
        // A directory resolves perfectly well and has nothing to serve.
        if (!stats.isFile()) return failure("not-found");
        return { ok: true, path: resolved.path, size: stats.size };
      } catch (error) {
        return mapError(error);
      }
    },
```

- [ ] **Step 4: Run the tests**

```bash
node --test apps/desktop/test/localWorkspace.test.js
npm test --workspace trypthos-desktop
```

Expected: PASS. `providers.test.js` may assert the provider's method list; if so, add `locate` to it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/localWorkspace.js apps/desktop/test/localWorkspace.test.js
git commit -m "Let the local provider locate a file for streaming"
```

---

## Task 6: The URL, agreed by both processes

**Files:**
- Modify: `packages/domain/src/mediaFiles.ts`
- Modify: `packages/domain/src/mediaFiles.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MEDIA_SCHEME = "tp-media"`, `mediaUrl(qualifiedPath: string): string`,
  `mediaPathFromUrl(url: string): string | null`.

Both halves live in the domain because the renderer builds the URL and the main process takes it
apart. Two implementations of one format is the classic way a path arrives subtly different from
how it left.

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/mediaFiles.test.ts`:

```ts
describe("the media URL", () => {
  it("round-trips an ordinary path", () => {
    const qualified = "Notes/recordings/standup.mp4";
    expect(mediaPathFromUrl(mediaUrl(qualified))).toBe(qualified);
  });

  // A workspace id is a folder's name, so it can hold spaces, accents and anything else a disk
  // allows. Encoding the whole qualified path as ONE segment is what stops a slash in it becoming
  // a path of its own.
  it("round-trips a path with characters a URL cares about", () => {
    for (const qualified of [
      "Ada's Notes/a b/clip.mp4",
      "Grace/100% done/clip.mp4",
      "Alice/caf\u00e9/sound.mp3",
      "Notes/a#b/clip.mp4",
      "Notes/a?b/clip.mp4",
    ]) {
      expect(mediaPathFromUrl(mediaUrl(qualified))).toBe(qualified);
    }
  });

  it("uses a fixed host, because a hostname cannot carry a workspace name", () => {
    expect(mediaUrl("Notes/clip.mp4").startsWith("tp-media://workspace/")).toBe(true);
  });

  it("refuses a URL of another scheme or another host", () => {
    expect(mediaPathFromUrl("https://workspace/Notes%2Fclip.mp4")).toBe(null);
    expect(mediaPathFromUrl("tp-media://elsewhere/Notes%2Fclip.mp4")).toBe(null);
  });

  it("refuses a URL with more than one segment, so no path can be built out of parts", () => {
    expect(mediaPathFromUrl("tp-media://workspace/Notes/clip.mp4")).toBe(null);
  });

  it("refuses an empty path and malformed encoding rather than throwing", () => {
    expect(mediaPathFromUrl("tp-media://workspace/")).toBe(null);
    expect(mediaPathFromUrl("tp-media://workspace/%E0%A4%A")).toBe(null);
    expect(mediaPathFromUrl("not a url at all")).toBe(null);
  });
});
```

Add `MEDIA_SCHEME`, `mediaPathFromUrl` and `mediaUrl` to that file's import from `./mediaFiles`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --root packages/domain mediaFiles
```

Expected: FAIL - `mediaUrl` is not exported.

- [ ] **Step 3: Add the two halves to `mediaFiles.ts`**

```ts
/// The scheme the main process serves media on.
///
/// Its own scheme rather than `file:`, which the renderer cannot reach and should not: `file:` would
/// be the whole disk, and this is one open workspace.
export const MEDIA_SCHEME = "tp-media";

/// Where the window fetches a file from, given its qualified workspace path.
///
/// A FIXED host, with the whole qualified path as a single encoded segment. A hostname is lowercased
/// and character-restricted by the URL parser, and a workspace id is a folder's name - so putting
/// the id in the host would quietly mangle it. One encoded segment also means a slash inside the
/// path cannot become a path separator in the URL, which is the shape of mistake that turns a
/// boundary check into a formality.
export function mediaUrl(qualifiedPath: string): string {
  return `${MEDIA_SCHEME}://workspace/${encodeURIComponent(qualifiedPath)}`;
}

/// The qualified path a URL names, or null when it is not one of ours.
///
/// Total: a malformed URL, a foreign scheme, a wrong host, an empty path or broken percent-encoding
/// all answer null rather than throwing. This runs in the main process on a string the renderer
/// chose, so it is parsing untrusted input and must not have an exceptional path at all.
export function mediaPathFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  if (parsed.hostname !== "workspace") return null;

  // One segment. `pathname` always starts with a slash, and anything after the first segment means
  // the URL was built some other way than by `mediaUrl`.
  const segments = parsed.pathname.slice(1).split("/");
  if (segments.length !== 1 || segments[0] === "") return null;

  try {
    const decoded = decodeURIComponent(segments[0]);
    return decoded === "" ? null : decoded;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Export from the barrel**

Extend the `./mediaFiles` export block in `packages/domain/src/index.ts` with `MEDIA_SCHEME`,
`mediaPathFromUrl` and `mediaUrl`.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --root packages/domain mediaFiles
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/mediaFiles.ts packages/domain/src/mediaFiles.test.ts packages/domain/src/index.ts
git commit -m "Agree the media URL in one place, for both processes"
```

---

## Task 7: The protocol handler

**Files:**
- Create: `apps/desktop/src/mediaProtocol.js`
- Create: `apps/desktop/test/mediaProtocol.test.js`
- Modify: `apps/desktop/src/ipcHandlers.js` (export a media locator)
- Modify: `apps/desktop/src/main.js`

**Interfaces:**
- Consumes: `parseRange` from `./mediaRange`; `mediaPathFromUrl`, `mediaTypeFor`, `MEDIA_SCHEME`
  from `@trypthos/domain`; `locateQualifiedPath` from `./openWorkspaces`.
- Produces: `MEDIA_SCHEME_PRIVILEGES` (the object for `registerSchemesAsPrivileged`),
  `createMediaHandler({ locate })` returning `async (request) => Response`, and
  `locateMedia(qualifiedPath)`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/mediaProtocol.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { mediaUrl } = require("@trypthos/domain");
const { createMediaHandler, MEDIA_SCHEME_PRIVILEGES } = require("../src/mediaProtocol");

/// The second route out of the shell, and therefore the second place the workspace boundary has to
/// hold. Everything here is about what the handler REFUSES; the one success case exists to prove
/// the refusals are not refusing everything.

const BODY = Buffer.from("0123456789ABCDEFGHIJ"); // 20 bytes, each one identifiable by position.

/// A locator standing in for the real registry, so none of this needs Electron or a workspace.
///
/// It answers for exactly one file, and refuses everything else the way the real one does - which
/// is what lets the refusal tests say something about the handler rather than about a fake.
async function withFile(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-media-"));
  const file = path.join(dir, "clip.mp4");
  await fs.writeFile(file, BODY);

  const locate = async (qualified) => {
    if (qualified === "Notes/clip.mp4") return { ok: true, path: file, size: BODY.length };
    if (qualified === "Notes/secret.mp4") return { ok: false, reason: "permission-denied" };
    if (qualified === "Repo/clip.mp4") return { ok: false, reason: "unsupported" };
    return { ok: false, reason: "not-found" };
  };

  try {
    await body({ handle: createMediaHandler({ locate }) });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const get = (url, headers = {}) => new Request(url, { headers });

test("the scheme is privileged in the ways playback needs, and no others", () => {
  const { privileges } = MEDIA_SCHEME_PRIVILEGES;
  // `stream` is the one that matters: without it a media element cannot issue a Range request
  // against the scheme, and the scrub bar is dead.
  assert.equal(privileges.stream, true);
  assert.equal(privileges.supportFetchAPI, true);
  assert.equal(privileges.secure, true);
  // There is no CSP in the app today. Pinning this to false means adding one later is a policy
  // decision rather than a hole that was already open.
  assert.equal(privileges.bypassCSP, false);
});

test("serves a whole file when nothing asks for a range", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4")));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "video/mp4");
    assert.equal(response.headers.get("Content-Length"), "20");
    // Without this a player will not even try to seek, however well the handler serves ranges.
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), BODY.toString());
  });
});

test("serves exactly the bytes a range asks for", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=10-14" }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 10-14/20");
    assert.equal(response.headers.get("Content-Length"), "5");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "ABCDE");
  });
});

test("answers 416 for a range past the end, never the start of the file", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Notes/clip.mp4"), { Range: "bytes=100-200" }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */20");
  });
});

test("refuses a name no media row claims, rather than guessing a type", async () => {
  await withFile(async ({ handle }) => {
    for (const name of ["Notes/clip.avi", "Notes/notes.md", "Notes/photo.png"]) {
      const response = await handle(get(mediaUrl(name)));
      assert.equal(response.status, 404, name);
    }
  });
});

test("refuses a workspace that is not open", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Elsewhere/clip.mp4")));
    assert.equal(response.status, 404);
  });
});

// The locator applies the guard, and these are the strings that reach it. The assertion is that the
// handler does not serve them - it must never resolve a path itself.
test("refuses a path that tries to leave the workspace", async () => {
  await withFile(async ({ handle }) => {
    for (const bad of [
      "Notes/../../outside.mp4",
      "Notes/..\\..\\outside.mp4",
      "Notes//server/share/clip.mp4",
      "Notes/C:/Windows/clip.mp4",
      "Notes/secret.mp4",
    ]) {
      const response = await handle(get(mediaUrl(bad)));
      assert.ok(response.status === 403 || response.status === 404, `${bad} gave ${response.status}`);
    }
  });
});

// A repository's blobs arrive base64 over an API with no ranges. The provider has no `locate`, so
// this is refused by the same path everything else is.
test("refuses a workspace that cannot stream", async () => {
  await withFile(async ({ handle }) => {
    const response = await handle(get(mediaUrl("Repo/clip.mp4")));
    assert.equal(response.status, 404);
  });
});

test("refuses a URL that is not one of ours", async () => {
  await withFile(async ({ handle }) => {
    for (const url of ["tp-media://elsewhere/Notes%2Fclip.mp4", "tp-media://workspace/"]) {
      const response = await handle(get(url));
      assert.equal(response.status, 400, url);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test apps/desktop/test/mediaProtocol.test.js
```

Expected: FAIL - cannot find `../src/mediaProtocol`.

- [ ] **Step 3: Write `apps/desktop/src/mediaProtocol.js`**

```js
"use strict";

const { createReadStream } = require("node:fs");
const { Readable } = require("node:stream");
const { MEDIA_SCHEME, mediaPathFromUrl, mediaTypeFor } = require("@trypthos/domain");
const { parseRange } = require("./mediaRange");

/// Serving video and audio to the window.
///
/// The second route out of the shell, after IPC, and it exists because the first one cannot do this
/// job: a picture crosses IPC as a data URL, and a clip is a hundred times too large for that and
/// could not be seeked anyway, because seeking is byte ranges.
///
/// What is NOT here is as important as what is. This module never resolves a path, never touches a
/// workspace root, and never decides whether a file may be read. It is handed a `locate` function
/// and does what that says - the same locator the IPC handlers use, so there is one boundary check
/// in this app and not two that could drift.

/// Registered BEFORE app-ready, because a scheme's privileges cannot be granted once a page has
/// loaded.
///
/// `stream` is the load-bearing one: without it a media element will not issue a Range request
/// against the scheme at all, and the scrub bar is dead however well the handler serves ranges.
const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
    // There is no Content-Security-Policy in the app today, so this changes nothing now. Pinned so
    // that adding one later is a deliberate policy decision rather than a hole already open.
    bypassCSP: false,
  },
};

/// A refusal with no body.
///
/// Deliberately uninformative. The window already knows what it asked for, and the difference
/// between "no such file" and "not allowed" is not something to spell out to the untrusted side.
const refuse = (status, headers) => new Response("", { status, headers });

function createMediaHandler({ locate }) {
  return async function handle(request) {
    const qualified = mediaPathFromUrl(request.url);
    if (qualified === null) return refuse(400);

    // **Decided HERE, from the name.** A declared media type is an instruction to the engine about
    // how to read the bytes that follow, so it is never taken from the renderer - and a name no row
    // claims is refused rather than guessed at.
    const mediaType = mediaTypeFor(qualified);
    if (mediaType === null) return refuse(404);

    const found = await locate(qualified);
    if (!found.ok) return refuse(found.reason === "permission-denied" ? 403 : 404);

    const range = parseRange(request.headers.get("Range"), found.size);

    if (range !== null && range.unsatisfiable === true) {
      // 416 rather than 200. A player handed the start of a file it asked to seek past will sit
      // there showing nothing, with no error anywhere to explain why.
      return refuse(416, { "Content-Range": `bytes */${found.size}` });
    }

    // `Accept-Ranges` on every response, including the whole-file one: it is how the engine learns
    // it MAY seek, and it asks before it has any reason to send a Range of its own.
    const headers = { "Content-Type": mediaType, "Accept-Ranges": "bytes" };

    if (range === null) {
      return new Response(streamOf(found.path, 0, found.size - 1), {
        status: 200,
        headers: { ...headers, "Content-Length": String(found.size) },
      });
    }

    return new Response(streamOf(found.path, range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.start}-${range.end}/${found.size}`,
      },
    });
  };
}

/// The bytes, as a web stream the Response can take.
///
/// A stream rather than a buffer is the entire reason this feature has a protocol: memory stays
/// flat whether the file is four megabytes or four gigabytes. `createReadStream` takes an inclusive
/// `end`, which is the same convention `parseRange` answers in, so no arithmetic happens here.
function streamOf(file, start, end) {
  if (end < start) return new Blob([]).stream();
  return Readable.toWeb(createReadStream(file, { start, end }));
}

module.exports = { MEDIA_SCHEME_PRIVILEGES, createMediaHandler };
```

- [ ] **Step 4: Run the tests**

```bash
node --test apps/desktop/test/mediaProtocol.test.js
```

Expected: PASS, all 10.

- [ ] **Step 5: Export the real locator from `ipcHandlers.js`**

Add this function near `locateQualified` in `apps/desktop/src/ipcHandlers.js`, and add
`locateMedia` to that file's `module.exports`:

```js
/// Where a media file is, for the protocol that streams it.
///
/// The same registry and the same guard as every IPC handler, which is the point: the protocol is a
/// second way to reach a file and must not be a second set of rules. A provider with no `locate` -
/// GitHub - answers "unsupported" here, which is how playback stays local-only without a second
/// place deciding it.
async function locateMedia(qualifiedPath) {
  const attached = locateQualifiedPath(qualifiedPath);
  if (attached === null) return { ok: false, reason: "no-workspace" };

  const { workspace, path: relativePath } = attached;
  if (typeof workspace.provider.locate !== "function") return { ok: false, reason: "unsupported" };
  if (relativePath === "") return { ok: false, reason: "not-found" };

  return workspace.provider.locate(relativePath);
}
```

- [ ] **Step 6: Register the scheme in `main.js`**

At the top of `apps/desktop/src/main.js`, with the other requires:

```js
const { MEDIA_SCHEME_PRIVILEGES, createMediaHandler } = require("./mediaProtocol");
const { locateMedia } = require("./ipcHandlers");
```

Then, at **module scope** - before `app.whenReady()` at `:359`, not inside it, because privileges
cannot be granted after the first page loads:

```js
// Before app-ready, deliberately: a scheme's privileges are fixed once a page has loaded, and the
// failure mode is a video that plays from the start and refuses to seek.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);
```

Add `protocol` to the existing `require("electron")` destructuring. Then inside the
`app.whenReady().then(...)` body, after `registerIpcHandlers({ ... })`:

```js
protocol.handle(MEDIA_SCHEME_PRIVILEGES.scheme, createMediaHandler({ locate: locateMedia }));
```

- [ ] **Step 7: Run everything**

```bash
npm test --workspace trypthos-desktop
npm run lint
```

Expected: PASS. If `dependencies.test.js` asserts which modules `main.js` requires, add the new one.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/mediaProtocol.js apps/desktop/test/mediaProtocol.test.js apps/desktop/src/ipcHandlers.js apps/desktop/src/main.js
git commit -m "Serve video and audio over a streaming protocol"
```

---

## Task 8: The player

**Files:**
- Create: `apps/app/src/components/MediaPlayer.tsx`
- Create: `apps/app/src/components/MediaPlayer.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `MediaKind` from `@trypthos/domain`.
- Produces: `MediaPlayer` (default export) with props
  `{ source: string; kind: MediaKind; name: string }`.

- [ ] **Step 1: Add the strings**

In `apps/app/src/locales/en.json`, in the `editor` block beside `"imageAlt"`:

```json
      "videoLabel": "{{name}}",
      "audioLabel": "{{name}}",
      "mediaUndecodable": "This file opened, but this computer cannot play its video or audio coding.",
      "mediaUnreadable": "This file could not be read.",
      "mediaNotLocal": "Video and audio play from a folder on this computer, not from a repository."
```

No long dashes, per the house rule.

- [ ] **Step 2: Write the failing test**

Create `apps/app/src/components/MediaPlayer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MediaPlayer from "./MediaPlayer";

/// A recording, played rather than edited.
///
/// The controls themselves are Chromium's and are not worth asserting - what is worth asserting is
/// everything around them that would be wrong by default: a file that starts playing on open, a
/// whole video fetched to show a tab, and a failure that draws a black rectangle and says nothing.

describe("MediaPlayer", () => {
  const video = { source: "tp-media://workspace/Notes%2Fclip.mp4", kind: "video" as const, name: "Notes/clip.mp4" };
  const audio = { source: "tp-media://workspace/Notes%2Fsong.mp3", kind: "audio" as const, name: "Notes/song.mp3" };

  it("draws a video element for a video", () => {
    const { container } = render(<MediaPlayer {...video} />);
    const element = container.querySelector("video");
    expect(element).not.toBeNull();
    expect(element?.getAttribute("src")).toBe(video.source);
  });

  it("draws an audio element for a sound, and names the file beside it", () => {
    const { container } = render(<MediaPlayer {...audio} />);
    expect(container.querySelector("audio")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("Notes/song.mp3")).toBeTruthy();
  });

  it("offers controls", () => {
    const { container } = render(<MediaPlayer {...video} />);
    expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true);
  });

  // Opening a tab must not start making noise, and must not pull a gigabyte to show a first frame.
  it("does not autoplay, and fetches only the metadata to begin with", () => {
    const { container } = render(<MediaPlayer {...video} />);
    const element = container.querySelector("video");
    expect(element?.hasAttribute("autoplay")).toBe(false);
    expect(element?.getAttribute("preload")).toBe("metadata");
  });

  // A Matroska file carrying VP9, or an MP4 carrying AC-3, opens and cannot be decoded. Saying so
  // is what makes including those containers defensible - a bare video element shows black and
  // explains nothing.
  it("says plainly when the file cannot be decoded", () => {
    const { container } = render(<MediaPlayer {...video} />);
    const element = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(element, "error", { value: { code: 4 }, configurable: true });
    element.dispatchEvent(new Event("error"));

    expect(screen.getByText(/cannot play its video or audio coding/i)).toBeTruthy();
  });

  it("separates a file it cannot read from one it cannot decode", () => {
    const { container } = render(<MediaPlayer {...video} />);
    const element = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(element, "error", { value: { code: 2 }, configurable: true });
    element.dispatchEvent(new Event("error"));

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run --root apps/app MediaPlayer
```

Expected: FAIL - cannot resolve `./MediaPlayer`.

- [ ] **Step 4: Write `apps/app/src/components/MediaPlayer.tsx`**

```tsx
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MediaKind } from "@trypthos/domain";

interface Props {
  /// Where the main process serves the file, as a `tp-media://` URL. Nothing here touches the disk,
  /// and nothing here holds the bytes: the engine fetches ranges as it needs them.
  source: string;
  kind: MediaKind;
  /// The path it was opened from. The accessible name, and for a sound the only thing on screen
  /// that says which file is playing.
  name: string;
}

/// Why `MEDIA_ERR_DECODE` and `MEDIA_ERR_SRC_NOT_SUPPORTED` are told apart from the rest.
///
/// Those two are the formats this app knowingly admits and cannot always play - a Matroska file
/// carrying VP9, an MP4 carrying AC-3 audio. They are not failures to find the file, and saying "it
/// could not be read" about one would send somebody looking for a problem that is not there.
const DECODE_FAILURES = new Set([2, 4]);

/// A recording, played rather than edited.
///
/// Deliberately NO zoom and no pan, unlike the image viewer beside it. A screenshot shrunk into a
/// side panel is unreadable, which is the whole reason a picture pans; a video is watched at the
/// panel's size, and the way to make it bigger is fullscreen.
///
/// The controls are Chromium's own, which is a decision rather than a shortcut: the native bar
/// carries play, a scrub bar, elapsed and total, volume, playback speed, Picture-in-Picture and
/// fullscreen, every one of them keyboard reachable and labelled in the user's language. Hand
/// building that bar would mean rewriting all of its accessibility to gain colour tokens.
export default function MediaPlayer({ source, kind, name }: Props) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<"undecodable" | "unreadable" | null>(null);

  const onError = (event: SyntheticEvent<HTMLMediaElement>) => {
    const code = event.currentTarget.error?.code ?? 0;
    setFailure(DECODE_FAILURES.has(code) ? "undecodable" : "unreadable");
  };

  if (failure !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-sunken p-6">
        <p className="max-w-md text-center text-ink-3">
          {failure === "undecodable" ? t("editor.mediaUndecodable") : t("editor.mediaUnreadable")}
        </p>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-sunken p-4">
        {/* `preload="metadata"` and no autoplay: opening a tab fetches a duration and a first
            frame, not the file, and never starts making noise on its own. */}
        <video
          src={source}
          controls
          preload="metadata"
          aria-label={t("editor.videoLabel", { name })}
          onError={onError}
          className="max-h-full max-w-full"
        />
      </div>
    );
  }

  // A sound has no picture to fill a panel with, so the file's name stands in for one - otherwise
  // the panel is a control bar floating in an empty rectangle with nothing saying what it plays.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-sunken p-4">
      <p className="max-w-full truncate text-ink-2" title={name}>
        {name}
      </p>
      <audio
        src={source}
        controls
        preload="metadata"
        aria-label={t("editor.audioLabel", { name })}
        onError={onError}
        className="w-full max-w-xl"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --root apps/app MediaPlayer
npx vitest run --root apps/app i18nKeys
```

Expected: PASS both. The i18n guard checks literal `t("...")` calls, which is why the two failure
lines are written as a ternary over two whole calls rather than one call over a built key.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/MediaPlayer.tsx apps/app/src/components/MediaPlayer.test.tsx apps/app/src/locales/en.json
git commit -m "Play a recording, and say so when it cannot be decoded"
```

---

## Task 9: Opening a recording

**Files:**
- Modify: `packages/domain/src/openDocuments.ts:36,61,143`
- Modify: `apps/app/src/hooks/useWorkspace.ts:1018-1037` and `failureKey` at `:254`
- Modify: `apps/app/src/components/EditorPanel.tsx:52,155,275,360,370,380-390,430`
- Modify: `apps/app/src/App.tsx:859`
- Modify: `apps/app/src/components/WorkspacePanel.tsx:206`
- Modify: `apps/app/src/locales/en.json`
- Modify: `apps/app/src/components/EditorPanel.test.tsx`, `apps/app/src/hooks/useWorkspace.test.ts`

**Interfaces:**
- Consumes: `MediaPlayer` from Task 8; `mediaKindFor`, `mediaUrl` from Task 1 and Task 6.
- Produces: `OpenDocument["media"]` is now
  `{ source: string; kind: "image" | "video" | "audio" } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/hooks/useWorkspace.test.ts`, matching that file's existing harness:

```ts
it("opens a video without reading it, because the protocol serves the bytes", async () => {
  const client = fakeClient({ workspaces: [localWorkspace("Notes")] });
  const { result } = renderWorkspace(client);

  await act(() => result.current.actions.openPath("Notes/clip.mp4"));

  expect(client.readFileCalls).toEqual([]);
  expect(client.readImageCalls).toEqual([]);
  expect(result.current.state.media).toEqual({
    source: "tp-media://workspace/Notes%2Fclip.mp4",
    kind: "video",
  });
});

it("opens a sound the same way", async () => {
  const client = fakeClient({ workspaces: [localWorkspace("Notes")] });
  const { result } = renderWorkspace(client);

  await act(() => result.current.actions.openPath("Notes/song.mp3"));

  expect(result.current.state.media?.kind).toBe("audio");
});

// A repository's blobs arrive base64 over an API with no ranges. Opening a tab that could only ever
// show a failure is worse than saying so where the user clicked.
it("says plainly that a repository cannot play a recording", async () => {
  const client = fakeClient({ workspaces: [githubWorkspace("Repo")] });
  const { result } = renderWorkspace(client);

  await act(() => result.current.actions.openPath("Repo/clip.mp4"));

  expect(result.current.state.errorKey).toBe("errors.mediaNotLocal");
  expect(result.current.state.media).toBe(null);
});
```

Use whatever this file already calls its fake client and its local and GitHub workspace builders; if
there is no GitHub builder, add one that differs only in `ref.kind`.

Append to `apps/app/src/components/EditorPanel.test.tsx`:

```tsx
it("plays a video rather than drawing it as a picture", () => {
  const { container } = render(
    <EditorPanel
      {...defaultProps}
      activePath="Notes/clip.mp4"
      media={{ source: "tp-media://workspace/Notes%2Fclip.mp4", kind: "video" }}
    />,
  );

  expect(container.querySelector("video")).not.toBeNull();
  expect(container.querySelector("img")).toBeNull();
});

// A word count and a caret position are questions about text, and three view buttons over a
// recording would be three buttons that do nothing.
it("offers no view modes and no status bar for a recording", () => {
  render(
    <EditorPanel
      {...defaultProps}
      activePath="Notes/clip.mp4"
      media={{ source: "tp-media://workspace/Notes%2Fclip.mp4", kind: "video" }}
    />,
  );

  expect(screen.queryByRole("button", { name: /source/i })).toBeNull();
});
```

Match `defaultProps` to whatever that file already builds.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run --root apps/app useWorkspace EditorPanel
```

Expected: FAIL - `media` is a string, and no `video` element is rendered.

- [ ] **Step 3: Widen the document's media field**

In `packages/domain/src/openDocuments.ts`, replace the type at `:36` and `:61`:

```ts
  /// What is SHOWN rather than edited, and how to show it.
  ///
  /// A picture arrives as a data URL; a recording arrives as a `tp-media://` URL the main process
  /// serves in ranges. The kind travels with the source because the two are drawn by different
  /// elements and a URL alone cannot say which.
  readonly media: MediaSource | null;
```

and add above the interface:

```ts
export interface MediaSource {
  readonly source: string;
  readonly kind: "image" | "video" | "audio";
}
```

Export `MediaSource` from `packages/domain/src/index.ts` alongside the other `openDocuments` types.
Line `:143` stays as `media: source.media ?? null`.

- [ ] **Step 4: Open media in `useWorkspace`**

In `apps/app/src/hooks/useWorkspace.ts`, add `mediaKindFor` and `mediaUrl` to the
`@trypthos/domain` import, and replace the image branch at `:1018` with:

```ts
      // An image goes down a different channel, because `readFile` decodes and would refuse it -
      // which is right for a document and wrong for a picture.
      if (isImageName(path)) {
        const image = await client.readImage(path);
        if (!image.ok) return fail(image);

        setInternal((prev) => ({
          ...prev,
          documents: openDocument(prev.documents, {
            path,
            // Nothing in it, deliberately: `content` is what chat sends and what the editor holds.
            content: "",
            revision: { id: "image" },
            readOnly: true,
            media: { source: image.dataUrl, kind: "image" },
          }),
          busy: false,
        }));

        reportIfLocal(reportOpened, stateRef.current.workspaces, path);
        return;
      }

      // A recording is read by nothing at all. The main process serves it in ranges over its own
      // protocol, so all the renderer needs is where to point the element - which is the qualified
      // path it already has.
      const mediaKind = mediaKindFor(path);
      if (mediaKind !== null) {
        // Only from a folder on this computer. A repository's blobs come base64 over an API with no
        // ranges, so a tab opened here could only ever show a failure. Said where the click was.
        if (!isLocalWorkspaceFor(stateRef.current.workspaces, path)) {
          return fail({ ok: false, reason: "media-not-local" });
        }

        setInternal((prev) => ({
          ...prev,
          documents: openDocument(prev.documents, {
            path,
            content: "",
            revision: { id: "media" },
            readOnly: true,
            media: { source: mediaUrl(path), kind: mediaKind },
          }),
          busy: false,
        }));

        reportIfLocal(reportOpened, stateRef.current.workspaces, path);
        return;
      }
```

Add the helper next to `reportIfLocal` in the same file:

```ts
/// Whether a qualified path names a workspace that is a folder on this computer.
///
/// `reportIfLocal` asks almost this question already, but answers by DOING something rather than by
/// returning - and a check that has to gate a branch needs the answer itself.
function isLocalWorkspaceFor(workspaces: readonly Workspace[], path: string): boolean {
  const split = splitQualified(path);
  if (split === null) return false;
  return workspaces.some((workspace) => workspace.id === split.workspaceId && workspace.ref.kind === "local");
}
```

Add `splitQualified` to the domain import if it is not already there, and use whatever that file
calls its workspace type.

Then add the reason to `failureKey` at `:254`, in the switch:

```ts
    case "media-not-local":
      return "errors.mediaNotLocal";
```

and add the string to `apps/app/src/locales/en.json` in the `errors` block:

```json
    "mediaNotLocal": "Video and audio play from a folder on this computer, not from a repository.",
```

(If Step 1 of Task 8 already placed `mediaNotLocal` under `editor`, remove it from there - it
belongs with the other failure reasons.)

- [ ] **Step 5: Pick the right element in `EditorPanel`**

In `apps/app/src/components/EditorPanel.tsx`: import `MediaPlayer` beside `ImageViewer`, import
`type MediaSource` from `@trypthos/domain`, and change the prop at `:52`:

```ts
  /// What is shown rather than edited, and how. Null for a document.
  media?: MediaSource | null;
```

Every `media === null` and `media !== null` test at `:275`, `:360`, `:370` and `:430` keeps working
unchanged. Replace the render branch at `:380`:

```tsx
        ) : media !== null ? (
          media.kind === "image" ? (
            // A picture scrolls within the panel at its own size rather than being scaled to fit,
            // because a screenshot shrunk to a panel is a screenshot you cannot read.
            <ImageViewer source={media.source} name={activePath ?? ""} zoom={zoom} onZoom={stepZoom} />
          ) : (
            // `key` matters: without it React reuses one media element across two tabs, and the
            // previous file's playback state arrives in the next one.
            <MediaPlayer
              key={activePath}
              source={media.source}
              kind={media.kind}
              name={activePath ?? ""}
            />
          )
        ) : isEditable(mode) ? (
```

- [ ] **Step 6: Keep recordings out of chat's reach**

In `apps/app/src/components/WorkspacePanel.tsx`, add `isMediaName` to the domain import and extend
the condition at `:206`:

```tsx
    onAddToChat !== undefined &&
    menu?.file != null &&
    menu.openable &&
    !isImageName(menu.file) &&
    // A recording has no text to send, for the same reason a picture has none.
    !isMediaName(menu.file)
```

`App.tsx` needs no change: `scopeSource` already treats any document with `media` set as nothing
open, and `media` is now an object rather than a string, which is still non-null.

- [ ] **Step 7: Run everything**

```bash
npx vitest run --root apps/app
npx vitest run --root packages/domain
npm run typecheck
npm run lint
```

Expected: PASS. Any existing test that passed `media="data:..."` as a string needs updating to
`media={{ source: "data:...", kind: "image" }}`; that is the whole blast radius of the widening.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/openDocuments.ts packages/domain/src/index.ts apps/app/src
git commit -m "Open a recording into the player"
```

---

## Task 10: Proving it in a real window

**Files:**
- Modify: `apps/app/src/components/EditorPanel.browser.test.tsx`
- Scratch only (never committed): a fixture generator and a Playwright Electron driver

**Interfaces:** none. This task adds no production code.

The browser suite is the only place a rendering question can be answered, and the real Electron app
is the only place the protocol, seeking and fullscreen can be.

- [ ] **Step 1: Add the browser test**

Append to `apps/app/src/components/EditorPanel.browser.test.tsx`, matching its existing harness:

```tsx
it("renders a real media element with the attributes playback depends on", async () => {
  render(
    <Harness
      activePath="Notes/clip.mp4"
      media={{ source: "tp-media://workspace/Notes%2Fclip.mp4", kind: "video" }}
    />,
  );

  const element = await page.element("video");
  expect(element.getAttribute("preload")).toBe("metadata");
  expect(element.hasAttribute("controls")).toBe(true);
  expect(element.hasAttribute("autoplay")).toBe(false);
});
```

Use whatever element-locating helper that file already uses rather than inventing one.

- [ ] **Step 2: Run the browser suite**

```bash
npm run test:browser
```

Expected: PASS, with the count one higher than before and no new warnings.

- [ ] **Step 3: Build a real fixture, in the scratchpad**

There is no ffmpeg on this machine, and none is being added. Chromium can record what it can play,
so the fixture is generated by the engine that will play it. Write this to the scratchpad directory,
**not** into the repository:

```js
"use strict";
// Writes a real, decodable WebM into a throwaway folder, using the same engine that will play it.
// Never committed: a fixture that lives in the repo is a binary in every clone forever.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const OUT = process.argv[2];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadFile(path.join(__dirname, "blank.html"));

  const base64 = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        context.fillStyle = "hsl(" + (frame * 4 % 360) + ", 70%, 50%)";
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "#fff";
        context.font = "48px sans-serif";
        context.fillText("frame " + frame, 40, 200);
        frame += 1;
      };
      draw();
      const stream = canvas.captureStream(30);
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => {
        const buffer = await new Blob(chunks).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        resolve(btoa(binary));
      };
      const timer = setInterval(draw, 33);
      recorder.start();
      // Long enough that the scrub bar has somewhere to go.
      setTimeout(() => { clearInterval(timer); recorder.stop(); }, 12000);
    })
  `);

  await fs.writeFile(OUT, Buffer.from(base64, "base64"));
  console.log("wrote " + OUT);
  app.exit(0);
});
```

Run it with the repo's Electron, writing into an invented folder in the scratchpad:

```bash
./node_modules/.bin/electron <scratchpad>/makeclip/main.js <scratchpad>/demo-media/Ada/clip.webm
```

- [ ] **Step 4: Drive the real app against that folder**

Launch the app with Playwright's Electron driver, as previous visual checks in this repo have done,
open the invented folder, and confirm each of these by observation. Write the result of every line
down before moving on:

1. `clip.webm` appears in the tree.
2. Clicking it opens a tab with a video and a control bar, and nothing is playing.
3. Pressing play plays it.
4. Dragging the scrub bar to roughly the end jumps there and keeps playing. **This is the one that
   proves the protocol:** seeking is a Range request, and a handler that ignored them would play
   from the start and never move.
5. The fullscreen button fills the screen, and Escape comes back. Confirm this against the frameless
   window specifically - HTML fullscreen inside a frameless `BrowserWindow` is exactly the sort of
   thing that works everywhere except here.
6. Switching to another tab and back leaves the player working, with no console error.
7. Renaming the fixture to `clip.mkv` and opening it shows the "cannot play its video or audio
   coding" line rather than a black rectangle, because a WebM's VP8 in a Matroska wrapper is one of
   the combinations the engine refuses. This proves the error path with a real failure.
8. A `.mp3` placed in the folder opens into the audio layout with its name above the bar.

- [ ] **Step 5: Record what was NOT proved**

MP4, MOV, MKV and 3GP rest on the codec probe in the spec plus the error path, not on a real decode
on this machine. Say so in the PR body rather than leaving it implied.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/EditorPanel.browser.test.tsx
git commit -m "Assert the media element the browser actually renders"
```

---

## Task 11: The release

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`,
  `packages/domain/package.json`, `package-lock.json`
- Modify: `apps/app/src/lib/releaseNotes/current.ts`
- Modify: `apps/app/src/lib/appInfo.ts` (the About capability table)
- Modify: `README.md`, `docs/features.md`, `docs/Architecture.md`

- [ ] **Step 1: Bump the version everywhere**

`version.json` becomes `{ "version": "0.87.0" }`. A functional enhancement, so Minor +1 and Build
reset.

Then the five mirrors: the `version` field in the root `package.json`, `apps/app/package.json`,
`apps/desktop/package.json` and `packages/domain/package.json`; and in `package-lock.json` the
top-level `version` plus `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]` and
`packages["packages/domain"]`.

**Edit the lock file by hand. Do not regenerate it.** Match on the workspace `name` above each
`version`: a dependency can legitimately carry the string `0.86.1`, and a find-and-replace would
rewrite it. There are exactly five edits in that file. Count them, and stop at five.

- [ ] **Step 2: Verify the mirrors**

```bash
npx vitest run --root apps/app versionMirrors
```

Expected: PASS. This test is the only thing standing between a hand-edited lock file and a shipped
mismatch.

- [ ] **Step 3: Add the release entry**

At the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`. Confirm the PR number before
writing it - it is usually the next number in the shared issue and PR sequence, but confirm rather
than assume.

```ts
  {
    version: "0.87.0",
    date: "<the date you write this, as YYYY-MM-DD>",
    pr: <the PR number>,
    headline: "Play video and audio from your folders",
    summary:
      "A folder of notes often has recordings in it, and until now Trypthos could not see them. Video and audio files now appear in the folder browser and open in the centre panel with the usual controls: play, a scrub bar you can drag, volume, playback speed, picture in picture and a fullscreen button. Nothing is loaded up front, so a long recording opens as quickly as a short one and dragging the scrub bar jumps straight there. The formats were chosen by testing what this app can actually decode rather than by listing what exists, so a file that appears in the tree is one it can play. Where a file turns out to use a coding it cannot handle, which happens most often with .mkv, it says so plainly instead of showing a black rectangle. Playback works for folders on this computer; a GitHub repository is not supported yet.",
    added: [
      "Video files open and play in the centre panel: mp4, m4v, mov, webm, mkv and 3gp.",
      "Audio files play too: mp3, m4a, aac, wav, flac, ogg, oga, opus and weba.",
      "Transport controls, playback speed, picture in picture and fullscreen, all reachable from the keyboard.",
      "Dragging the scrub bar seeks straight to that point, however large the file.",
    ],
    changed: [
      "The Images group in File types is now Pictures, video and audio, and the two new rows are switched on for you. Turn either off there if a folder of recordings should stay out of the tree.",
    ],
  },
```

No long dashes anywhere in that entry.

- [ ] **Step 4: Update the three inventories, in lockstep**

The About-box capability table in `apps/app/src/lib/appInfo.ts` gains one row, in the established
`| Feature | Description |` shape:

```
| Video and audio | Play recordings from a local folder, with transport controls and fullscreen. |
```

`README.md`'s Features table gains the matching row linking into `docs/features.md`, and
`docs/features.md` gains the matching prose bullet. Never one without the others.

- [ ] **Step 5: Update the architecture doc**

`docs/Architecture.md` genuinely changes here, because this adds a cross-process transport. Record:
the `tp-media://` scheme and why it is a protocol rather than IPC; that it honours `Range` and has
no size limit; that `openWorkspaces.js` now holds the shared registry and locator both the IPC
surface and the protocol use; and that `provider.locate` exists on the local backend only, which is
what makes playback local-only.

- [ ] **Step 6: Run everything**

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:browser
```

Expected: all green, no warnings.

- [ ] **Step 7: Commit, push and open the PR**

```bash
git add -A
git commit -m "Release 0.87.0"
git push -u origin spec/media-playback
```

The PR body covers: what it does; the measured format list and the two deliberate inclusions
(`.mov` declared as mp4, `.mkv` partly supported with a clear failure line); the transport and why
it is not a data URL; the settings migration and why it departs from the written rule; what was
proved by driving the real app and what was not; and the deployment surface line - **needs a
release**. No `Fixes #` line: this is a feature, not a fix.

---

## Self-review

**Spec coverage.** Every section of `docs/specs/media-playback.md` maps to a task: the format list
and the `.mov` and `.mkv` decisions to Task 1; the transport, its privileges, its authority
reasoning and the shared-registry extraction to Tasks 4, 5, 6 and 7; the surface, controls,
fullscreen, `preload`, `key` and the error line to Tasks 8 and 9; the migration to Task 2; the
reach-into-the-app table to Tasks 1, 8 and 9; the proving section to Tasks 3, 7 and 10; the release
checklist to Task 11. The spec's "what this version does not do" (playback position across tab
switches) is correctly absent from every task.

**Type consistency.** `MediaKind` is defined in Task 1 and consumed in Tasks 8 and 9 under that
name. `MediaSource` is defined in Task 9 and used by `EditorPanel` in the same task. `mediaTypeFor`,
`mediaKindFor`, `isMediaName`, `mediaUrl`, `mediaPathFromUrl`, `MEDIA_SCHEME`, `parseRange`,
`locateQualifiedPath`, `openWorkspaces`, `locateMedia`, `createMediaHandler` and
`MEDIA_SCHEME_PRIVILEGES` each keep one spelling throughout. `provider.locate` answers
`{ ok, path, size }` in Task 5 and is consumed in that shape in Task 7.

**Known soft spots**, flagged rather than hidden. Three tasks say "match whatever that file already
calls its harness" - Task 5's `withWorkspace`, Task 9's fake client, Task 10's element helper. Those
are real test files whose local conventions are not reproduced here; the implementer reads them
first. Everything else carries its code in full.
