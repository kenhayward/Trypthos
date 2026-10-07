# OneDrive PR 3: Write to OneDrive - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A file in a OneDrive folder opens for editing and saves back with one conditional request (`If-Match: <cTag>`), a stale save is a conflict the user is told about with their text kept, and the tree offers New File, New Folder and Rename there - all creates refusing a taken name rather than replacing it, the chat's create-file tool included - with no token, no Graph address and no content tag of the user's leaking into IPC answers or logs, and the saving indicator clearing only on Graph's acknowledgement. Version 0.104.0.

**Architecture:** The domain's `oneDrive.ts` gains the write half: the four write addresses (each segment encoded, `@microsoft.graph.conflictBehavior=fail` on a create), the folder-create body, a content-tag shape (`isOneDriveTag`) checked before a tag goes into `If-Match`, the 4 MB simple-upload limit, `oneDriveWriteFailure` (a write's refusals, which differ from a read's on 400 and 503), and `oneDrivePathKey` (the folded key the listing cache uses, because Graph is case-insensitive). The shell's `oneDriveApi.js` extends `send()` to PUT, POST and PATCH with a body and extra headers - keeping `redirect: "error"` and the 3xx guard on every token-carrying request, never routing a body through `fetchManual` - and gains `writeContent`, `createContent`, `createFolder` and `rename` under a write retry policy (401 and 429 repeated once, 503 and a timeout never). The provider keys its listing cache by the folded path, then gains `write` (save, or create when no revision is presented), `createDirectory` and `rename`, keeps a byte-order mark by content tag, drops each written folder's listing under its folded key (and refuses to keep a listing that a write overtook), and opens a file over 4 MB read-only. Nothing in IPC, the preload or packaging changes: `file:write`, `workspace:createDirectory` and `workspace:rename` are already gated on provider methods. The renderer's `canEditTree` admits `onedrive`, and `providerFailureKey` gains OneDrive's words for a refused save and a name taken on a create.

**Tech Stack:** TypeScript + zod 4 (domain), Electron CommonJS + `net.fetch` (shell), React 19 + react-i18next + Tailwind v4 (renderer), vitest (domain, renderer), `node --test` (shell).

**Spec:** `docs/specs/onedrive-workspace.md` - "What the spike established", "Decisions taken", "Architecture", "Error handling", "Testing" and "Delivery" item 3 are binding, with the "(ruled in PR 2: ...)" notes. Where a ruling below differs, the ruling says why, and Task 7 records it in the spec.

## Global Constraints

- TDD: every behaviour change starts with a failing test, run and seen to fail for the stated reason, then the minimal code. Test output stays pristine: no warnings and no stray `console.error` (the jsdom setup fails a test on one - opt in with `expectsConsoleError` from `apps/app/src/test-setup` only where a test provokes one on purpose). Shell modules take an injected `logger`; shell tests pass a collecting one, or capture `console.error` where a handler logs through it.
- **Tokens and pre-authenticated addresses never cross IPC, never reach a log, never appear in an error message.** That is the Microsoft access token, the refresh token, and any download address Graph's 302 names. Log lines carry a step name plus `error?.code ?? error?.name` only - never a URL (it holds a path, an id or a signature), a body, a file name, a path, a content tag or `error.message`.
- **Every token-carrying request through `fetch` passes `redirect: "error"`, writes included.** A request with a body never goes through `fetchManual`; only the `/content` GET does. Leak-guard tests assert the **exact** strings are absent (never a host-name substring - CodeQL flags that).
- **A content tag reaches an `If-Match` header only after `isOneDriveTag`.** It comes back from the renderer as the revision a save presents, so it is untrusted input: one that fails answers `bad-request` with no request. A tag Graph hands out that fails is never given to the editor (`read` answers `unknown`).
- **Ids** reach a Graph address only after `isOneDriveId`. **Paths** are workspace-relative, `/`-separated, and go through `createPathGuard` over `GUARD_ROOT = "/onedrive"` before any request; each segment is `encodeURIComponent`-ed by the domain's builders, and nothing in the shell builds a Graph address by hand.
- **Never let the editor pretend a save landed.** The renderer's `savingPaths` entry comes down only when `file:write` answers, and the revision it keeps is the content tag Graph answered the write with - never one asked for afterwards. A write that may have landed but was not confirmed (a 503, a deadline, an answer with no usable tag) is never resent; the next save's `If-Match` reports what happened.
- Failures cross IPC as results `{ ok: false, reason }`, never throws. Shell modules never throw outward.
- Failure reasons used: `not-found`, `permission-denied`, `offline`, `rate-limited`, `not-connected`, `not-configured`, `other-account`, `too-large`, `not-text`, `unsupported-encoding`, `unsatisfiable`, `conflict`, `bad-request`, `unknown`. `exists` comes out of the client (409 `nameAlreadyExists`) and is turned into `conflict` by the provider; it never reaches IPC. `expired` stays inside the provider, as in PR 2. Nothing answers `read-only` for OneDrive any more.
- Every user-facing string goes through `apps/app/src/locales/en.json`. **No em or en dashes** in user-facing text, release notes, README or features.md; use `-`.
- **Never put real user data in fixtures:** `ada@example.com`, drive ids `d0c0ffee` / `beefcafe`, item ids `ITEM!1`, `ROOT!0`, `SHARED!7`, invented tags (`ctag-1`), invented tokens and `https://download.invented.example/...` addresses.
- Version: **0.104.0** (functional enhancement: Minor +1, Build 0). `version.json` + root/app/desktop/domain `package.json` + exactly five `package-lock.json` entries (top-level `version`, `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]`) - match on the workspace `name`, never find-and-replace (a dependency can share the old version string).
- Line endings: committed files mix CRLF and LF and the editor tools rewrite to LF. Commit, then run the repair script from AGENTS.md (`.fix-eol.mjs`) against `origin/main` and re-stage with `git restore --staged --source=origin/main -- F && git add F` per file. `package-lock.json` is LF-pinned by `.gitattributes`.
- **Strict UTF-8 after every edit to `en.json` or a markdown file:** `node -e "for (const f of process.argv.slice(1)) new TextDecoder('utf-8', { fatal: true }).decode(require('fs').readFileSync(f))" apps/app/src/locales/en.json <each .md you touched>` must print nothing. (An earlier run corrupted UTF-8 by writing through a shell.)
- Writing files through a shell heredoc or a Python string mangles backslashes (`\\`, `\r\n`, `\b`): use the editor tools for every file in this plan - several hold escapes and Windows-style paths.
- **The shell loads the built domain.** `apps/desktop` requires `@trypthos/domain` from `packages/domain/dist`: run `npm run build --workspace @trypthos/domain` after any domain change and before shell tests (`npm test --workspace trypthos-desktop` does it in `pretest`). Every name a shell file destructures from the domain must be exported from `packages/domain/src/index.ts` (`domainExports.test.js` enforces it).
- Commands, from the repo root: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser`. One renderer file is `npm test --workspace trypthos-app -- <name>`, one domain file is `npm test --workspace @trypthos/domain -- <name>`, and one shell file is `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/<file>.test.js`.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (each commit step below passes it as a second `-m`). Push only in Task 7.

## Rulings recorded while planning

Taken before planning (binding):

- **Save** is one `PUT .../items/{root}:/{path}:/content` with `If-Match: <cTag>`; 412 is `conflict`. **The chat's create and New File** are `PUT ...:/content?@microsoft.graph.conflictBehavior=fail`; 409 is a taken name; `If-None-Match` is never sent (the spike saw it ignored, overwriting a file). **New Folder** is `POST .../children` failing on a taken name. **Rename** is `PATCH { name }`; 409 is a taken name, and a case-only rename is allowed (Graph allows it, and the request is the same).
- `canEditTree` includes `onedrive`, and the shell's per-file `readOnly` no longer marks every OneDrive file.
- A body over 4 MB is `too-large`.
- **`send()` keeps `redirect: "error"` and the 3xx guard on every token-carrying request**, writes included, with a test that every Bearer write has `redirect: "error"` and went through `fetch`. A body PUT never goes through `fetchManual`.
- **`expectedRevision` is shape-checked** with the domain's `isOneDriveTag` / `OneDriveTagSchema` before it goes into `If-Match`, and answers `bad-request` otherwise.
- **The write retry policy:** never repeat a write after a 503 or a deadline (a repeat of a write that landed would read as a taken name or a conflict); one repeat after a 429 honouring `Retry-After` (not processed); one repeat after a 401 with a forced token (not processed); a timed-out write answers `offline` and is never resent.
- **Listings are invalidated after every write, keyed canonically**; Save As into OneDrive stays out of scope (the handler refuses it before a dialog, since a OneDrive workspace has no `root`).

Added while planning (each with its reason and the cost if wrong):

- **Path casing: the listing cache is keyed by a folded path, `oneDrivePathKey(path) = path.toLowerCase()`; node ids are not canonicalised.** Canonicalising ids would need Graph's spelling of every segment, which is a listing walk per request; folding the cache key is pure and is exactly what invalidation needs - one folder reached by `Notes` and by `notes` is one cache entry, and a write through either spelling drops it. Node ids keep the request's casing, which Graph accepts. Cost if wrong: a pair of names OneDrive treats as one and `toLowerCase` does not (a locale-specific folding) is cached twice and can be up to 60 s stale - never a lost write, since every write is conditional on Graph's side.
- **`exists` stays inside the provider, which answers `conflict` for a taken name.** The provider contract already reads `conflict` as "the name is taken": `folderToolRunner.js`'s create tool ("already exists"), `useWorkspace.createEmptyFile`, the local backend (`EEXIST`, `write(path, content, null)` onto a file), Drive's `createDirectory` and the rename dialog's `rename.problems.taken`. A save's conflict and a create's conflict answer `{ ok: false, reason: "conflict", theirs: null }`; New Folder's and rename's answer `{ ok: false, reason: "conflict" }`. Cost if wrong: two helper functions in the provider.
- **There is no Overwrite to mirror.** Drive's conflict is a banner (`errors.driveConflict`) that keeps the user's text and tells them to copy it and reopen; nothing in the app overwrites past a conflict. OneDrive gets the same shape in its own words, `errors.oneDriveConflict`.
- **The chat's create goes through `provider.write(path, content, null)`** (`folderToolRunner.js`), not a provider `create`, and so does New File (`client.writeFile(path, "", null)`). So `write` with a null revision creates, as it does on disk and in Drive; there is no separate `create` member.
- **A file over 4 MB opens read-only** (the shell's `readOnly: true`, by the bytes read), and a save that grows past 4 MB is refused `too-large` with both sizes before any request. The spec says text files are "already capped below it by `MAX_TEXT_FILE_BYTES`"; they are not - that limit is 16 MB - so without this a 5 MB note would open editable and never save. Cost if wrong: one condition in `read`.
- **The write calls take bytes and are named for it:** `writeContent(driveId, itemId, path, bytes, cTag)`, `createContent(driveId, itemId, path, bytes)`, `createFolder(driveId, itemId, parentPath, name)`, `rename(driveId, itemId, path, name)` (the spec's `writeText` / `createText`). The provider encodes the text and decides the byte-order mark, as PR 2 ruled for reads (`download` answers bytes).
- **The byte-order mark is kept, keyed by content tag** (`boms`: tag -> had a mark). A tag names one version of one file, so it is exactly the bytes a save replaces - Drive keys by `<fileId>@<revision>` for the same reason. A created file has none.
- **`oneDriveWriteFailure(status, code)`** is a write's mapping: 400 is `bad-request` (Graph refused the request - a name it will not take - and did nothing), 503 is `unknown` (the write may have landed; during a save it reads "OneDrive did not confirm the save"), everything else is `oneDriveFailure`. A read's 400 stays `unknown` and its 503 `rate-limited`, as the spec's table says. Cost if wrong: two rows of a pure function.
- **A create lists its parent first (through the cache) and answers `not-found` when it is not there.** Graph's path PUT may create missing folders on the way; the local backend never does (`ENOENT`), and New File and the chat's create name an existing folder. Usually free (the folder was just listed to be shown). Cost if wrong: one request per create on a cold cache.
- **An upload is `Content-Type: application/octet-stream`**; Graph assigns the file's type from its extension (the spike saw `.md` come back `text/markdown`). The manual check confirms a saved `.md` keeps that type.
- **`conflictBehavior=fail` is in the query for a content PUT** (the form the spike proved) **and in the JSON body for the folder POST** (`oneDriveFolderBody`, Graph's documented form for creating a folder).
- **A save that lands drops that item's cached download address** (`locations.delete(item.id)`), so a media source never serves the bytes it replaced.
- **A rename drops the listing of its folder and of every folder below both the old and the new path**, by folded prefix. Nothing needs re-keying: listings are keyed by path and are simply asked again.
- **The OneDrive wording:** `errors.oneDriveConflict` (a save's conflict), `errors.oneDriveSaveUnknown` (a save's `unknown`), `errors.oneDriveTooLarge` (a save's `too-large`, naming OneDrive's limit - a read's `too-large` keeps the app's own words), `errors.oneDrivePermissionDenied` (a save, a create or a rename refused with 403 - a folder shared for viewing only; a read's 403 keeps the generic key). `exists` needs no key (ruling above); `unsatisfiable` needs none because it never reaches the window (`tp-media` answers it as an HTTP 416). `errors.oneDriveReadOnly` is removed: nothing answers `read-only` for OneDrive now.
- **A name taken on New File or New Folder reads `errors.nameTaken` for every provider**, and those two actions now word their failures for the provider they ran in (`fail(result, kind, "create")`). The shared `errors.conflict` says the file "changed on disk since you opened it", which was already wrong for a create in a local folder and in Drive. Cost if wrong: a "fixed" line in the release notes.
- **A OneDrive rename refused with 403 reads `errors.oneDrivePermissionDenied`**, not `rename.problems.denied` (whose "may be open in another program" is a local-disk explanation); its other failures are worded for OneDrive through `providerFailureKey`.
- **A save whose `If-Match` names a path that no longer exists** (renamed on the web since it was read) is unverified against Graph: 412 reads `conflict`, 404 reads `not-found`, and a 201 would mean the text was written to the path the tab shows. None loses the user's text. The manual check records which it is in the spec's spike table.
- **No IPC channel, preload member, `IPC_CHANNELS` entry or packaging rule changes**, so no contract test that pins them changes: the three channels already exist and are gated on the provider having the method. The PR 2 tests that pinned "a save answers `read-only`" are replaced in Tasks 4 and 5.
- **The picker's note changes** from "open read-only for now" to the 4 MB rule (`oneDrivePicker.readOnlyNote`).

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/oneDrive.ts` (+ new `oneDriveWrite.test.ts`) | `ONEDRIVE_UPLOAD_LIMIT_BYTES`, `isOneDriveTag`, `OneDriveTagSchema`, `oneDrivePathKey`, `oneDriveUploadUrl`, `oneDriveCreateUrl`, `oneDriveCreateFolderUrl`, `oneDriveRenameUrl`, `oneDriveFolderBody`, `oneDriveWriteFailure`. Pure. |
| `packages/domain/src/index.ts` | Re-exports. |
| `apps/desktop/src/oneDriveApi.js` (+ `oneDriveApi.test.js`) | `send()` for PUT/POST/PATCH; `writeContent`, `createContent`, `createFolder`, `rename`; the write retry policy. |
| `apps/desktop/src/oneDriveWorkspace.js` (+ `oneDriveWorkspace.test.js`, new `oneDriveWorkspaceWrite.test.js`) | Folded listing keys; `write`, `createDirectory`, `rename`; byte-order marks; read-only over 4 MB; invalidation. |
| `apps/desktop/test/oneDriveIpc.test.js` | The read-only pins replaced; writes through the real handlers and the real client; the leak guard over the writes. |
| `apps/app/src/lib/workspaceCapabilities.ts` (+ test) | `canEditTree` includes `onedrive`. |
| `apps/app/src/hooks/useWorkspace.ts` (+ test) | `providerFailureKey(kind, reason, "save" \| "create" \| null)`; New File / New Folder / Rename worded for their provider. |
| `apps/app/src/components/WorkspacePanel.test.tsx` | The OneDrive menu offers New File, New Folder and Rename. |
| `apps/app/src/components/OpenOneDriveDialog.test.tsx` | The picker's note. |
| `apps/app/src/locales/en.json` | `errors.nameTaken`, `errors.oneDriveConflict`, `errors.oneDriveSaveUnknown`, `errors.oneDriveTooLarge`, `errors.oneDrivePermissionDenied`; `errors.oneDriveReadOnly` removed; `oneDrivePicker.readOnlyNote` reworded. |
| Docs | `version.json` + mirrors, `releaseNotes/current.ts`, `appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`, the spec. |

---

### Task 1: Domain - the write half of `oneDrive.ts`

**Files:**
- Modify: `packages/domain/src/oneDrive.ts` (append)
- Create: `packages/domain/src/oneDriveWrite.test.ts`
- Modify: `packages/domain/src/index.ts` (the `./oneDrive` export block)

**Interfaces:**
- Consumes: `oneDriveItemUrl`, `oneDrivePathUrl`, `encodedPath` (private), `oneDriveFailure`, `OneDriveFailure` - all in `oneDrive.ts` already.
- Produces (all exported from `@trypthos/domain`):
  - `ONEDRIVE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024`
  - `isOneDriveTag(value: unknown): value is string`, `OneDriveTagSchema` (`z.string().regex(...)`)
  - `oneDrivePathKey(path: string): string`
  - `oneDriveUploadUrl(driveId: string, itemId: string, path: string): string` (throws on an empty, `.` or `..` segment, `""` included)
  - `oneDriveCreateUrl(driveId: string, itemId: string, path: string): string` (the same, plus `?@microsoft.graph.conflictBehavior=fail`)
  - `oneDriveCreateFolderUrl(driveId: string, itemId: string, parentPath: string): string` (`""` is the item itself)
  - `oneDriveRenameUrl(driveId: string, itemId: string, path: string): string` (throws on `""`)
  - `oneDriveFolderBody(name: string): { name: string; folder: Record<string, never>; "@microsoft.graph.conflictBehavior": "fail" }`
  - `type OneDriveWriteFailure = OneDriveFailure | "bad-request"`, `oneDriveWriteFailure(status: number, code: string | null): OneDriveWriteFailure`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/oneDriveWrite.test.ts
import { describe, expect, it } from "vitest";
import {
  GRAPH_API,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  OneDriveTagSchema,
  isOneDriveTag,
  oneDriveCreateFolderUrl,
  oneDriveCreateUrl,
  oneDriveFolderBody,
  oneDrivePathKey,
  oneDriveRenameUrl,
  oneDriveUploadUrl,
  oneDriveWriteFailure,
} from "./oneDrive";

const DRIVE = "d0c0ffee";

describe("the write addresses", () => {
  it("saves a file's content by its path, one encoded segment at a time", () => {
    expect(oneDriveUploadUrl(DRIVE, "root", "Notes/Plan B.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes/Plan%20B.md:/content`);
  });

  // `If-None-Match: *` was ignored in the spike and overwrote a file: this query is the only guard a
  // create has, so it is on every create address.
  it("creates a file by its path, asking Graph to fail on a name already in use", () => {
    expect(oneDriveCreateUrl(DRIVE, "ROOT!0", "Notes #1/a?.md")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/ROOT!0:/Notes%20%231/a%3F.md:/content?@microsoft.graph.conflictBehavior=fail`,
    );
  });

  it("makes a folder among a folder's children, the workspace root's own included", () => {
    expect(oneDriveCreateFolderUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root/children`);
    expect(oneDriveCreateFolderUrl(DRIVE, "root", "Notes")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes:/children`);
  });

  it("renames an item by its path", () => {
    expect(oneDriveRenameUrl(DRIVE, "root", "Notes/Plan.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/Notes/Plan.md:`);
  });

  // The workspace's own folder is never written, renamed or uploaded to; and a dot or empty segment
  // would be collapsed out of the address by the URL parser.
  it("refuses the root, and a path with an empty or dot segment, for a file or a rename", () => {
    for (const path of ["", ".", "..", "a/../b", "a//b", "a/"]) {
      expect(() => oneDriveUploadUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveCreateUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
      expect(() => oneDriveRenameUrl(DRIVE, "root", path)).toThrow("unsafe OneDrive path");
    }
    expect(() => oneDriveCreateFolderUrl(DRIVE, "root", "a//b")).toThrow("unsafe OneDrive path");
  });

  it("asks for a folder that fails on a name already in use", () => {
    expect(oneDriveFolderBody("Ideas")).toEqual({ name: "Ideas", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  });
});

describe("content tags", () => {
  it("accepts the tags Graph hands out", () => {
    for (const tag of ["ctag-1", '"c:{F2E8A0B1-1111-2222-3333-444455556666},2"', "ctag-ITEM!1", "x".repeat(256)]) {
      expect(isOneDriveTag(tag)).toBe(true);
      expect(OneDriveTagSchema.safeParse(tag).success).toBe(true);
    }
  });

  // It goes into an If-Match header. A line break would end the header and start another.
  it("refuses anything that could change the header it goes into, or is not a string", () => {
    for (const tag of ["", "a\r\nX-Injected: 1", "a\nb", "tab\tx", " ctag", "ctag ", "é", "x".repeat(257)]) {
      expect(isOneDriveTag(tag)).toBe(false);
      expect(OneDriveTagSchema.safeParse(tag).success).toBe(false);
    }
    for (const value of [null, undefined, 1, { id: "ctag-1" }]) expect(isOneDriveTag(value)).toBe(false);
  });
});

describe("the simple upload limit", () => {
  it("is four megabytes", () => {
    expect(ONEDRIVE_UPLOAD_LIMIT_BYTES).toBe(4_194_304);
  });
});

describe("oneDrivePathKey", () => {
  // OneDrive compares names without regard to case: one folder, however it is spelled, is one key.
  it("folds a path so two spellings of one folder are one key", () => {
    expect(oneDrivePathKey("Notes/Plan.md")).toBe(oneDrivePathKey("notes/PLAN.md"));
    expect(oneDrivePathKey("Ärger/X")).toBe(oneDrivePathKey("ärger/x"));
    expect(oneDrivePathKey("")).toBe("");
    expect(oneDrivePathKey("Notes")).not.toBe(oneDrivePathKey("Notes2"));
  });
});

// A write's refusals, which differ from a read's in two rows: Graph refusing the request outright
// did nothing, and a 503 may have come after the write landed.
describe("oneDriveWriteFailure", () => {
  it.each([
    [400, "invalidRequest", "bad-request"],
    [401, "InvalidAuthenticationToken", "not-connected"],
    [403, "accessDenied", "permission-denied"],
    [404, "itemNotFound", "not-found"],
    [409, "nameAlreadyExists", "exists"],
    [409, null, "conflict"],
    [412, null, "conflict"],
    [413, null, "too-large"],
    [429, "activityLimitReached", "rate-limited"],
    [503, null, "unknown"],
    [500, null, "offline"],
    [418, null, "unknown"],
  ])("%i %s is %s", (status, code, reason) => {
    expect(oneDriveWriteFailure(status, code)).toBe(reason);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @trypthos/domain -- oneDriveWrite`
Expected: FAIL - `oneDriveUploadUrl is not a function` (and the same for every new name), because none is exported from `./oneDrive` yet.

- [ ] **Step 3: Write the domain half**

Append to `packages/domain/src/oneDrive.ts`:

```ts
/// The most Graph takes in one simple upload. A larger file needs an upload session, which this app
/// does not make (spec, "Large uploads"): a OneDrive file larger than this opens read-only, and a save
/// that grows past it is refused before anything is sent. `MAX_TEXT_FILE_BYTES` (16 MB) is the read
/// limit and does not keep text below this one.
export const ONEDRIVE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

/// A content tag as it may go back to Graph in an `If-Match` header: printable ASCII, no leading or
/// trailing space, at most 256 characters. Graph's tags are quoted strings of that alphabet; one that
/// is not - a line break above all - would make the header something else. A tag comes back from the
/// renderer as the revision a save presents, so it is untrusted input, checked before it is sent.
const ONEDRIVE_TAG_PATTERN = /^[!-~](?:[ -~]{0,254}[!-~])?$/;

export function isOneDriveTag(value: unknown): value is string {
  return typeof value === "string" && ONEDRIVE_TAG_PATTERN.test(value);
}

export const OneDriveTagSchema = z.string().regex(ONEDRIVE_TAG_PATTERN);

/// The key a folder's listing is held under: its workspace path, folded. OneDrive compares names
/// without regard to case, so one folder reached by two spellings - the tree's, a wiki link's, the
/// chat's - is one folder, and a write through either spelling must drop the one listing.
/// `toLowerCase` rather than a locale's folding: a pair Graph treats as one name and this does not
/// costs at worst a listing up to a minute stale, never a lost write - every write is conditional on
/// Graph's side.
export function oneDrivePathKey(path: string): string {
  return path.toLowerCase();
}

/// A file's content, by its path below `itemId`, for a save (with `If-Match`). The workspace root is
/// never a file, so `""` throws like any other unaddressable path.
export function oneDriveUploadUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDriveItemUrl(driveId, itemId)}:/${encodedPath(path)}:/content`;
}

/// A new file's content. Graph refuses a name already in use - case-insensitively - with 409
/// `nameAlreadyExists` rather than replacing it. `If-None-Match: *` was ignored in the spike and
/// overwrote a file, so this query is the only guard a create has.
export function oneDriveCreateUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDriveUploadUrl(driveId, itemId, path)}?@microsoft.graph.conflictBehavior=fail`;
}

/// Where a new folder is made: among the children of the folder at `parentPath` ("" is `itemId`).
export function oneDriveCreateFolderUrl(driveId: string, itemId: string, parentPath: string): string {
  return `${oneDrivePathUrl(driveId, itemId, parentPath)}/children`;
}

/// An item by its path, for a rename. The workspace's own folder is never renamed, so `""` throws.
export function oneDriveRenameUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDriveItemUrl(driveId, itemId)}:/${encodedPath(path)}:`;
}

/// A new folder, failing on a name already in use. In the body, which is Graph's documented form for
/// creating a folder; a content PUT carries the same instruction in its query (`oneDriveCreateUrl`).
export function oneDriveFolderBody(name: string): {
  name: string;
  folder: Record<string, never>;
  "@microsoft.graph.conflictBehavior": "fail";
} {
  return { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" };
}

export type OneDriveWriteFailure = OneDriveFailure | "bad-request";

/// What a refusal of a WRITE means. Two rows differ from a read's (`oneDriveFailure`): a 400 is
/// `bad-request` - Graph refused the request, a name it will not take, and did nothing - and a 503 is
/// `unknown`, because unlike a 429 it does not promise the write was not processed. The client never
/// repeats a write on it; the next save's `If-Match` says what happened.
export function oneDriveWriteFailure(status: number, code: string | null): OneDriveWriteFailure {
  if (status === 400) return "bad-request";
  if (status === 503) return "unknown";
  return oneDriveFailure(status, code);
}
```

In `packages/domain/src/index.ts`, the `./oneDrive` block becomes:

```ts
export {
  GRAPH_API,
  MAX_RETRY_AFTER_MS,
  ONEDRIVE_MY_DRIVE_URL,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  OneDriveDriveSchema,
  OneDriveIdSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  OneDriveTagSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  isOneDriveTag,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveCreateFolderUrl,
  oneDriveCreateUrl,
  oneDriveEntriesOf,
  oneDriveFailure,
  oneDriveFolderBody,
  oneDriveFoldersOf,
  oneDriveItemUrl,
  oneDriveMetaUrl,
  oneDrivePathKey,
  oneDrivePathUrl,
  oneDriveRenameUrl,
  oneDriveSharedWithMeUrl,
  oneDriveUploadUrl,
  oneDriveWriteFailure,
  retryAfterMs,
  sameOneDriveId,
} from "./oneDrive";
export type { OneDriveEntry, OneDriveFailure, OneDriveFolder, OneDriveItem, OneDriveWriteFailure } from "./oneDrive";
```

- [ ] **Step 4: Run the domain suite**

Run: `npm test --workspace @trypthos/domain` and `npm run typecheck`
Expected: PASS, no warnings. `oneDrive.test.ts` is unchanged and still passes (`oneDriveFailure` is untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/oneDrive.ts packages/domain/src/oneDriveWrite.test.ts packages/domain/src/index.ts
git commit -m "Domain: OneDrive write addresses, content tags, upload limit and write failures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shell - `oneDriveApi.js` writes, with `send()` extended and the write retry policy

**Files:**
- Modify: `apps/desktop/src/oneDriveApi.js`
- Modify: `apps/desktop/test/oneDriveApi.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `ONEDRIVE_UPLOAD_LIMIT_BYTES`, `isOneDriveTag`, `oneDriveUploadUrl`, `oneDriveCreateUrl`, `oneDriveCreateFolderUrl`, `oneDriveRenameUrl`, `oneDriveFolderBody`, `oneDriveWriteFailure`; PR 2's `OneDriveItemSchema`, `graphErrorCode`, `oneDriveFailure`, `retryAfterMs`.
- Produces, on the object `createOneDriveApi({ accessToken, fetch, fetchManual, logger, timeoutMs, sleep })` returns (the reads are unchanged):
  - `writeContent(driveId, itemId, path, bytes: Uint8Array, cTag: string)` -> `{ ok: true, item }` | `{ ok: false, reason }` | `{ ok: false, reason: "too-large", sizeBytes, limitBytes }`
  - `createContent(driveId, itemId, path, bytes: Uint8Array)` -> the same shapes; a taken name is `{ ok: false, reason: "exists" }`
  - `createFolder(driveId, itemId, parentPath, name)` -> `{ ok: true, item }` | `{ ok: false, reason }`
  - `rename(driveId, itemId, path, name)` -> `{ ok: true, item }` | `{ ok: false, reason }`
  - `send(url, read, { manual = false, method = "GET", headers = {}, body, write = false })` (internal)

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/test/oneDriveApi.test.js` (it reuses `setup`, `json`, `redirect`, `PLAN`, `ARCHIVE`, `ACCESS` and `DRIVE` from the top of the file):

```js
// ---- The writes (PR 3) ----

const { ONEDRIVE_UPLOAD_LIMIT_BYTES } = require("@trypthos/domain");

const headerNames = (call) => Object.keys(call.init.headers).map((name) => name.toLowerCase());

test("a save is one PUT by path with If-Match, answering the item as Graph now has it", async () => {
  const { api, calls } = setup({ routes: [json(200, { ...PLAN, cTag: "ctag-2" })] });
  const bytes = Buffer.from("new text");
  const answer = await api.writeContent(DRIVE, "root", "Notes/Plan.md", bytes, "ctag-1");
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:/content");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["If-Match"], "ctag-1");
  assert.equal(calls[0].init.headers["Content-Type"], "application/octet-stream");
  assert.equal(calls[0].init.body, bytes);
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("a stale content tag is a conflict, asked once", async () => {
  const { api, calls } = setup({ routes: [json(412, { error: { code: "resourceModified" } })] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-old"), { ok: false, reason: "conflict" });
  assert.equal(calls.length, 1);
});

// The spike: `If-None-Match: *` was ignored and overwrote a file. A create fails on a taken name by
// the query, and carries neither conditional header.
test("a create PUTs by path asking Graph to fail on a taken name, with no If-None-Match and no If-Match", async () => {
  const { api, calls } = setup({ routes: [json(201, { ...PLAN, id: "ITEM!9", cTag: "ctag-new" })] });
  const answer = await api.createContent(DRIVE, "root", "Notes/New.md", Buffer.from("made"));
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-new");
  assert.equal(
    calls[0].url,
    "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/New.md:/content?@microsoft.graph.conflictBehavior=fail",
  );
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(headerNames(calls[0]).includes("if-none-match"), false);
  assert.equal(headerNames(calls[0]).includes("if-match"), false);
});

test("a name Graph says is taken is exists, asked once", async () => {
  const { api, calls } = setup({ routes: [json(409, { error: { code: "nameAlreadyExists" } })] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "plan.MD", Buffer.from("x")), { ok: false, reason: "exists" });
  assert.equal(calls.length, 1);
});

test("New Folder POSTs to the parent's children, asking Graph to fail on a taken name", async () => {
  const { api, calls } = setup({ routes: [json(201, ARCHIVE), json(201, ARCHIVE)] });
  assert.equal((await api.createFolder(DRIVE, "root", "", "Archive")).ok, true);
  assert.equal((await api.createFolder(DRIVE, "root", "Notes", "Archive")).ok, true);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root/children");
  assert.equal(calls[1].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children");
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), { name: "Archive", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  }
});

test("rename PATCHes the name alone, by path; a taken name is exists", async () => {
  const { api, calls } = setup({ routes: [json(200, { ...PLAN, name: "plan.md" }), json(409, { error: { code: "nameAlreadyExists" } })] });
  assert.equal((await api.rename(DRIVE, "root", "Notes/Plan.md", "plan.md")).ok, true);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:");
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "plan.md" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Notes/Plan.md", "Other.md"), { ok: false, reason: "exists" });
});

// The carry-over from PR 2's review: `send()` takes bodies now, and must not lose the redirect refusal
// on the way. Electron's net.fetch in `follow` mode hands the Authorization header to the redirect's
// target - and a body with it.
test("every write carries the token through fetch, refuses redirects, and never goes through the manual fetch", async () => {
  const { api, calls } = setup({ routes: [json(200, PLAN), json(201, PLAN), json(201, ARCHIVE), json(200, PLAN)] });
  await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1");
  await api.createContent(DRIVE, "root", "New.md", Buffer.from("x"));
  await api.createFolder(DRIVE, "root", "", "Archive");
  await api.rename(DRIVE, "root", "Plan.md", "plan.md");
  assert.deepEqual(calls.map((call) => call.init.method), ["PUT", "PUT", "POST", "PATCH"]);
  for (const call of calls) {
    assert.equal(call.via, "fetch", call.init.method);
    assert.equal(call.authorization, `Bearer ${ACCESS}`, call.init.method);
    assert.equal(call.init.redirect, "error", call.init.method);
  }
});

test("a redirect answering a write is unknown, and is not followed", async () => {
  const { api, calls } = setup({ routes: [redirect("https://elsewhere.invented.example/x")] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
});

// A 401 is refused before anything is processed, so the same request goes again - If-Match and all.
test("a write is repeated once after a 401, with a token refreshed for it", async () => {
  const { api, calls, tokenCalls } = setup({
    routes: [json(401, { error: { code: "InvalidAuthenticationToken" } }), json(200, PLAN)],
    tokens: [{ ok: true, token: "access-old" }, { ok: true, token: ACCESS }],
  });
  assert.equal((await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1")).ok, true);
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.equal(calls[1].authorization, `Bearer ${ACCESS}`);
  assert.equal(calls[1].init.headers["If-Match"], "ctag-1");
});

// A 429 with Retry-After says the request was not processed: one repeat is safe.
test("a write is repeated once after a 429, waiting what Retry-After asks, then rate-limited", async () => {
  const { api, calls, slept } = setup({
    routes: [json(429, {}, { "Retry-After": "3" }), json(201, PLAN), json(429, {}, { "Retry-After": "2" }), json(429, {})],
  });
  assert.equal((await api.createContent(DRIVE, "root", "New.md", Buffer.from("x"))).ok, true);
  assert.deepEqual(await api.createContent(DRIVE, "root", "Other.md", Buffer.from("x")), { ok: false, reason: "rate-limited" });
  assert.deepEqual(slept, [3_000, 2_000]);
  assert.equal(calls.length, 4);
});

// A 503 promises nothing about whether the write landed. Repeating a create that did would answer
// "exists"; repeating a save that did would answer "conflict" against its own write.
test("a write is never repeated after a 503: it may have landed", async () => {
  const { api, calls, slept } = setup({ routes: [json(503, {}, { "Retry-After": "1" }), json(503, {})] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "unknown" });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 2);
  assert.deepEqual(slept, []);
});

test("a write whose answer never arrives is offline, and is never sent again", async () => {
  const { api, calls, logs } = setup({ timeoutMs: 10, routes: [() => new Promise(() => {})] });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "offline" });
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ETIMEDOUT"]);
});

test("a body over four megabytes is too large with nothing sent, and a 413 names the sizes", async () => {
  const { api, calls } = setup({ routes: [json(413, {})] });
  const big = Buffer.alloc(ONEDRIVE_UPLOAD_LIMIT_BYTES + 1);
  const refused = { ok: false, reason: "too-large", sizeBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES };
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", big, "ctag-1"), refused);
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", big), refused);
  assert.equal(calls.length, 0);
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("abc")), {
    ok: false,
    reason: "too-large",
    sizeBytes: 3,
    limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES,
  });
});

// The carry-over from PR 2's review: the tag comes from the renderer, and goes into a header.
test("a content tag that is not one is bad-request, with nothing sent", async () => {
  const { api, calls } = setup();
  for (const tag of ["a\r\nX-Injected: 1", "", null, undefined, { id: "ctag-1" }]) {
    assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), tag), { ok: false, reason: "bad-request" }, String(tag));
  }
  assert.equal(calls.length, 0);
});

test("a write to an address that cannot be made is refused, with nothing sent", async () => {
  const { api, calls } = setup();
  for (const path of ["", "a/../b", "a//b", "."]) {
    assert.deepEqual(await api.writeContent(DRIVE, "root", path, Buffer.from("x"), "ctag-1"), { ok: false, reason: "not-found" }, path);
    assert.deepEqual(await api.createContent(DRIVE, "root", path, Buffer.from("x")), { ok: false, reason: "not-found" }, path);
    assert.deepEqual(await api.rename(DRIVE, "root", path, "x.md"), { ok: false, reason: "not-found" }, path);
  }
  assert.deepEqual(await api.createFolder(DRIVE, "root", "a//b", "x"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFolder(DRIVE, "root", "", ""), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Plan.md", ""), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.writeContent("../x", "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFolder(DRIVE, "a/b", "", "x"), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

test("Graph refusing a write: 403 permission-denied, 400 bad-request, 404 not-found, 500 offline", async () => {
  const { api } = setup({
    routes: [
      json(403, { error: { code: "accessDenied" } }),
      json(400, { error: { code: "invalidRequest" } }),
      json(404, { error: { code: "itemNotFound" } }),
      json(500, {}),
    ],
  });
  assert.deepEqual(await api.writeContent(DRIVE, "SHARED!7", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await api.createFolder(DRIVE, "root", "", "bad:name"), { ok: false, reason: "bad-request" });
  assert.deepEqual(await api.rename(DRIVE, "root", "Gone.md", "x.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createContent(DRIVE, "root", "New.md", Buffer.from("x")), { ok: false, reason: "offline" });
});

// The write landed; only what it made is not known. `offline` would invite a retry of a write that
// is already there.
test("an answer to a write in a shape this build does not know is unknown, logged without the address", async () => {
  const { api, logs } = setup({ routes: [json(200, { nope: true })] });
  assert.deepEqual(await api.writeContent(DRIVE, "root", "Plan.md", Buffer.from("x"), "ctag-1"), { ok: false, reason: "unknown" });
  assert.deepEqual(logs, ["OneDrive answered a write in a shape this build does not recognise."]);
});

test("no write logs the token, a path, a name, the content tag or an error's message", async () => {
  const fail = (url, init) => {
    throw Object.assign(new Error(`connect failed for ${url} ${init.headers["If-Match"] ?? ""} ${init.body ?? ""}`), { code: "ECONNRESET" });
  };
  const { api, logs } = setup({ routes: [fail, fail, fail, fail, json(200, { nope: true })] });
  await api.writeContent(DRIVE, "root", "Secret/Plan.md", Buffer.from("private words"), "ctag-secret");
  await api.createContent(DRIVE, "root", "Secret/New.md", Buffer.from("private words"));
  await api.createFolder(DRIVE, "root", "Secret", "Hidden");
  await api.rename(DRIVE, "root", "Secret/Plan.md", "Renamed.md");
  await api.rename(DRIVE, "root", "Secret/Plan.md", "Renamed.md");
  assert.equal(logs.length, 5);
  const text = logs.join(" ");
  for (const secret of [ACCESS, DRIVE, "Secret", "Hidden", "Renamed", "ctag-secret", "private words", "connect failed"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveApi.test.js`
Expected: the PR 2 tests pass; every new test FAILS with `TypeError: api.writeContent is not a function` (or `createContent`, `createFolder`, `rename`).

- [ ] **Step 3: Write the client's write side**

In `apps/desktop/src/oneDriveApi.js`, replace the `require("@trypthos/domain")` block with:

```js
const {
  ONEDRIVE_MY_DRIVE_URL,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  OneDriveDriveSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  isOneDriveTag,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveCreateFolderUrl,
  oneDriveCreateUrl,
  oneDriveFailure,
  oneDriveFolderBody,
  oneDriveMetaUrl,
  oneDriveRenameUrl,
  oneDriveSharedWithMeUrl,
  oneDriveUploadUrl,
  oneDriveWriteFailure,
  retryAfterMs,
} = require("@trypthos/domain");
```

Replace the first line of the module comment, `/// The calls to OneDrive (Microsoft Graph), read side, and nothing else. PR 3 adds the writes.`, with:

```js
/// The calls to OneDrive (Microsoft Graph), and nothing else: the reads, and four writes - a save, a
/// new file, a new folder and a rename.
```

Replace the whole of `send` (its comment included) with:

```js
  /// One Graph request with the token. At most one retry after a 401, with a token refreshed for it,
  /// and one after a rate limit, waiting what `Retry-After` asks up to ten seconds. `read(response)`
  /// makes the value of an answer below 400 - a 302 included, when `manual` sent the request through
  /// the fetch that never follows one. Answers `{ ok: true, value }` or a failure.
  ///
  /// Every other request refuses redirects up front (`redirect: "error"`), writes included. Measured
  /// with this repo's Electron: `net.fetch` in its default `follow` mode delivers the Authorization
  /// header to the redirect's target, and `"error"` rejects - answered here as offline - without
  /// contacting it. A 3xx check after the fact cannot protect the token; the one below is for a fetch
  /// that ignores the option. The manual fetch is told nothing about redirects: it never follows one,
  /// and nothing with a body is ever sent through it.
  ///
  /// `write` marks a request that changes OneDrive. Its refusals are read by `oneDriveWriteFailure`,
  /// and it is repeated only where Graph promises it was not processed: after a 401, and after a 429.
  /// A 503 maps to `unknown` and a deadline to `offline`, and neither is repeated - the write may have
  /// landed, and a second attempt would read as a taken name or a conflict against itself.
  async function send(url, read, { manual = false, method = "GET", headers = {}, body, write = false } = {}) {
    let token = await tokenFrom();
    if (!token.ok) return token;

    const request = manual ? fetchManual : fetch;
    let refreshed = false;
    let waited = false;
    for (;;) {
      const bearer = token.token;
      const got = await deadlined(async (signal) => {
        const response = await request(url, {
          method,
          signal,
          // The token last, so no caller's header can stand in for it.
          headers: { ...headers, Authorization: `Bearer ${bearer}` },
          ...(body === undefined ? {} : { body }),
          ...(manual ? {} : { redirect: "error" }),
        });
        if (!manual && response.status >= 300 && response.status < 400) return { response, value: null, redirected: true };
        if (response.status < 400) return { response, value: await read(response) };
        return { response, value: await response.json().catch(() => null) };
      });
      if (got === null) return failure("offline");
      if (got.redirected === true) {
        logger.error?.("OneDrive answered a Graph request with a redirect; it was not followed.");
        return failure("unknown");
      }
      const { response } = got;
      if (response.status < 400) return { ok: true, value: got.value };

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await tokenFrom({ force: true });
        if (!token.ok) return token;
        continue;
      }
      const code = graphErrorCode(got.value);
      const reason = write ? oneDriveWriteFailure(response.status, code) : oneDriveFailure(response.status, code);
      if (reason === "rate-limited" && !waited) {
        waited = true;
        await sleep(retryAfterMs(response.headers?.get("retry-after") ?? null));
        continue;
      }
      return failure(reason);
    }
  }
```

Insert after `rangeFrom` (before the `return`):

```js
  /// A write's answer: the item as Graph now has it. An answer in a shape this build cannot read is
  /// `unknown`, not `offline` - the write landed, and only what it made is not known.
  async function sendItem(url, init) {
    const got = await send(url, (response) => response.json(), { ...init, write: true });
    if (!got.ok) return got;
    const parsed = OneDriveItemSchema.safeParse(got.value);
    if (!parsed.success) {
      logger.error?.("OneDrive answered a write in a shape this build does not recognise.");
      return failure("unknown");
    }
    return { ok: true, item: parsed.data };
  }

  /// Graph's simple upload takes at most four megabytes; a larger body is refused before it is sent.
  function tooLarge(bytes) {
    return { ok: false, reason: "too-large", sizeBytes: bytes.length, limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES };
  }

  /// A 413 names no sizes; the ones this request had are given, so it reads like the refusal made
  /// before sending.
  function sized(answer, bytes) {
    return !answer.ok && answer.reason === "too-large" ? tooLarge(bytes) : answer;
  }

  /// The body type of an upload. Graph decides the file's own type from its name's extension.
  const OCTETS = { "Content-Type": "application/octet-stream" };
  const JSON_BODY = { "Content-Type": "application/json" };

  /// New content for the file at `path`, only if it is still at `cTag`: one conditional request, which
  /// Graph refuses with 412 (a conflict) when anyone has written the file since. The tag comes back
  /// from the renderer, so it is checked before it goes into a header.
  async function writeContent(driveId, itemId, path, bytes, cTag) {
    if (!ids(driveId, itemId)) return failure("not-found");
    if (!isOneDriveTag(cTag)) return failure("bad-request");
    if (bytes.length > ONEDRIVE_UPLOAD_LIMIT_BYTES) return tooLarge(bytes);
    const url = addressOf(() => oneDriveUploadUrl(driveId, itemId, path));
    if (url === null) return failure("not-found");
    const answer = await sendItem(url, { method: "PUT", headers: { ...OCTETS, "If-Match": cTag }, body: bytes });
    return sized(answer, bytes);
  }

  /// A new file at `path`, which Graph refuses with 409 `nameAlreadyExists` (`exists`) rather than
  /// replacing one already there. No `If-None-Match`: the spike saw Graph ignore it and overwrite.
  async function createContent(driveId, itemId, path, bytes) {
    if (!ids(driveId, itemId)) return failure("not-found");
    if (bytes.length > ONEDRIVE_UPLOAD_LIMIT_BYTES) return tooLarge(bytes);
    const url = addressOf(() => oneDriveCreateUrl(driveId, itemId, path));
    if (url === null) return failure("not-found");
    const answer = await sendItem(url, { method: "PUT", headers: OCTETS, body: bytes });
    return sized(answer, bytes);
  }

  /// A new folder called `name` in the folder at `parentPath` ("" is `itemId` itself), refused on a
  /// taken name.
  async function createFolder(driveId, itemId, parentPath, name) {
    if (!ids(driveId, itemId)) return failure("not-found");
    if (typeof name !== "string" || name === "") return failure("bad-request");
    const url = addressOf(() => oneDriveCreateFolderUrl(driveId, itemId, parentPath));
    if (url === null) return failure("not-found");
    return sendItem(url, { method: "POST", headers: JSON_BODY, body: JSON.stringify(oneDriveFolderBody(name)) });
  }

  /// A new name for the item at `path`, in the folder it is already in. A change of case alone is a
  /// rename like any other; a name another item has is refused (`exists`).
  async function rename(driveId, itemId, path, name) {
    if (!ids(driveId, itemId)) return failure("not-found");
    if (typeof name !== "string" || name === "") return failure("bad-request");
    const url = addressOf(() => oneDriveRenameUrl(driveId, itemId, path));
    if (url === null) return failure("not-found");
    return sendItem(url, { method: "PATCH", headers: JSON_BODY, body: JSON.stringify({ name }) });
  }
```

Replace the `return` line with:

```js
  return { drive, children, item, sharedWithMe, downloadLocation, download, rangeFrom, writeContent, createContent, createFolder, rename };
```

Note the order of checks in `writeContent`: ids, then the tag, then the size, then the address - the test "a write to an address that cannot be made" passes a valid tag, so an empty path reaches `addressOf` and answers `not-found`.

- [ ] **Step 4: Run the client tests and the shell suite**

Run: `node --test apps/desktop/test/oneDriveApi.test.js` then `npm test --workspace trypthos-desktop`
Expected: PASS, no stderr. The PR 2 test "every request carrying the token through fetch refuses redirects" still passes - the reads' requests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/oneDriveApi.js apps/desktop/test/oneDriveApi.test.js
git commit -m "Shell: OneDrive writes - save with If-Match, create failing on a taken name, folder, rename" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shell - one listing per folder, whatever the case it is asked in

The carry-over from PR 2's review, landed before any write: the provider's listing cache took each request's spelling as its key, so a write through one spelling would leave the listing cached under another standing.

**Files:**
- Modify: `apps/desktop/src/oneDriveWorkspace.js` (`entriesOf`, `listKnown`, the import, two comments)
- Modify: `apps/desktop/test/oneDriveWorkspace.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `oneDrivePathKey`.
- Produces: `listings` and `inFlight` keyed by `oneDrivePathKey(path)`; node ids still carry the request's spelling.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/test/oneDriveWorkspace.test.js`:

```js
// OneDrive answers a path in any case. The tree, a wiki link, a restored tab and the chat can each name
// one folder in a different case, so a folder is cached once, under its folded spelling: a write into
// it, through whichever spelling, can then never leave a stale listing standing under another.
test("keeps one listing per folder, whatever case it is asked for in", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.deepEqual(await provider.list("ARCHIVE"), { ok: true, nodes: [{ id: "ARCHIVE/Old.md", name: "Old.md", kind: "file" }] });
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
  const known = await provider.listKnown("archive");
  assert.equal(known.complete, true);
  assert.deepEqual(known.nodes, [{ id: "archive/Old.md", name: "Old.md", kind: "file" }]);
});

test("two walks of one folder in two spellings at once ask OneDrive once", async () => {
  const { provider, calls } = await open();
  await Promise.all([provider.list("Archive"), provider.list("archive")]);
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveWorkspace.test.js`
Expected: FAIL - `list("ARCHIVE")` asks the fake again (its tree has no `ARCHIVE` key, so it answers `{ ok: false, reason: "not-found" }`), and the second test counts 2 listings, not 1.

- [ ] **Step 3: Key the cache by the folded path**

In `apps/desktop/src/oneDriveWorkspace.js`, add `oneDrivePathKey` to the domain import (between `oneDriveEntriesOf` and `sameOneDriveId`).

Replace the two map comments and declarations:

```js
  /// Workspace path -> `{ at, generation, entries }` of that folder's last successful listing.
  const listings = new Map();
  /// Workspace path -> `{ generation, promise }` for the listing in flight, so concurrent walks of one
  /// folder ask Graph once.
  const inFlight = new Map();
```

with:

```js
  /// `oneDrivePathKey(path)` -> `{ at, generation, entries }` of that folder's last successful
  /// listing. Folded, because Graph is case-insensitive: one folder reached by two spellings is one
  /// entry, and a write through either drops it.
  const listings = new Map();
  /// `oneDrivePathKey(path)` -> `{ generation, promise }` for the listing in flight, so concurrent
  /// walks of one folder - by any spelling - ask Graph once.
  const inFlight = new Map();
```

Replace `entriesOf` with:

```js
  async function entriesOf(path) {
    const key = oneDrivePathKey(path);
    const cached = listings.get(key);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, entries: cached.entries };
    }
    const joined = inFlight.get(key);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.children(ref.driveId, ref.itemId, path);
        if (!listed.ok) return listed;
        const entries = oneDriveEntriesOf(listed.items);
        if (started === generation) listings.set(key, { at: now(), generation: started, entries });
        return { ok: true, entries };
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
    return pending.promise;
  }
```

In `listKnown`, replace `const known = listings.get(path);` with `const known = listings.get(oneDrivePathKey(path));`.

- [ ] **Step 4: Run the provider tests and the shell suite**

Run: `node --test apps/desktop/test/oneDriveWorkspace.test.js` then `npm test --workspace trypthos-desktop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/oneDriveWorkspace.js apps/desktop/test/oneDriveWorkspace.test.js
git commit -m "Shell: one OneDrive listing per folder, whatever the case it is asked in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shell - the provider writes: save, create, New Folder, rename

**Files:**
- Modify: `apps/desktop/src/oneDriveWorkspace.js` (whole file below)
- Create: `apps/desktop/test/oneDriveWorkspaceWrite.test.js`
- Modify: `apps/desktop/test/oneDriveWorkspace.test.js` (PR 2's read-only pins)
- Modify: `apps/desktop/test/oneDriveIpc.test.js` (PR 2's read-only pins; Task 5 adds the writes back to the leak guard)

**Interfaces:**
- Consumes: Task 2's `api.writeContent`, `api.createContent`, `api.createFolder`, `api.rename`; Task 1's `ONEDRIVE_UPLOAD_LIMIT_BYTES`, `isOneDriveTag`, `oneDrivePathKey`; the domain's `encodeTextFile`.
- Produces, on the provider `openOneDriveWorkspace({ ref, api, now, ttlMs })` answers:
  - `read(path)` -> `{ ok: true, content, revision: { id: cTag }, readOnly?: true }` (`readOnly` only above 4 MB)
  - `write(path, content, expected: { id } | null)` -> `{ ok: true, revision: { id: cTag } }` | `{ ok: false, reason: "conflict", theirs: null }` | `{ ok: false, reason, ... }`
  - `createDirectory(path)` -> `{ ok: true }` | `{ ok: false, reason }` (a taken name is `conflict`)
  - `rename(path, name)` -> `{ ok: true, path }` | `{ ok: false, reason }` (a taken name is `conflict`)

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/test/oneDriveWorkspaceWrite.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ONEDRIVE_UPLOAD_LIMIT_BYTES } = require("@trypthos/domain");
const { openOneDriveWorkspace } = require("../src/oneDriveWorkspace");

/// Writing to a OneDrive folder, over a fake OneDrive client that answers paths in any case, as Graph
/// does.
///
/// What is under test: a save presents the content tag it read and hands the editor the one OneDrive
/// answers, keeping a byte-order mark; a refused save is a conflict and nothing else is tried; a write
/// with no revision creates and never replaces, and never makes a folder on the way; a taken name is
/// the provider contract's `conflict`; every write drops the listing of the folder it wrote into under
/// its folded spelling, and a listing in flight across a write is not kept; the guard refuses before
/// any request; a file over the simple-upload limit opens read-only.

const MINE = "d0c0ffee";
const REF = { kind: "onedrive", driveId: MINE, itemId: "ROOT!0", name: "Notes" };
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function tree() {
  return {
    "": { id: "ROOT!0", name: "Notes", folder: {} },
    "Plan.md": { id: "ITEM!1", name: "Plan.md", size: 8, cTag: "ctag-1", file: {} },
    Archive: { id: "ITEM!2", name: "Archive", folder: {} },
    "Archive/Old.md": { id: "ITEM!3", name: "Old.md", size: 3, cTag: "ctag-3", file: {} },
  };
}

/// The key a path is held under, in the case it was first made in - Graph's own case-insensitivity. A
/// path nobody has is answered as it was asked.
function canonical(items, path) {
  if (path === "") return "";
  let at = "";
  for (const segment of path.split("/")) {
    const asked = at === "" ? segment : `${at}/${segment}`;
    at = Object.keys(items).find((key) => key.toLowerCase() === asked.toLowerCase()) ?? asked;
  }
  return at;
}

function childrenOf(items, path) {
  const prefix = path === "" ? "" : `${path}/`;
  return Object.entries(items)
    .filter(([key]) => key !== "" && key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([, item]) => ({ ...item }));
}

/// `answers` replaces what a write call answers; `gate(path)` is awaited by `children` AFTER it has
/// read the tree, so a test can hold a listing in flight while it is already out of date.
function fakeApi({ items = tree(), bytes = null, answers = {}, gate = null } = {}) {
  const content = bytes ?? { "ITEM!1": Buffer.concat([BOM, Buffer.from("hello")]), "ITEM!3": Buffer.from("old") };
  const calls = [];
  let made = 0;
  const api = {
    drive: async () => ({ ok: true, drive: { id: MINE } }),
    item: async (driveId, itemId, path) => {
      calls.push(["item", path]);
      const key = canonical(items, path);
      return items[key] === undefined ? { ok: false, reason: "not-found" } : { ok: true, item: { ...items[key] } };
    },
    children: async (driveId, itemId, path) => {
      calls.push(["children", path]);
      const key = canonical(items, path);
      const listed = items[key]?.folder === undefined ? { ok: false, reason: "not-found" } : { ok: true, items: childrenOf(items, key) };
      if (gate !== null) await gate(path);
      return listed;
    },
    download: async (driveId, itemId) => ({ ok: true, bytes: content[itemId] }),
    writeContent: async (driveId, itemId, path, body, cTag) => {
      calls.push(["writeContent", driveId, itemId, path, Buffer.from(body), cTag]);
      if (answers.writeContent !== undefined) return answers.writeContent;
      const key = canonical(items, path);
      if (items[key] === undefined || items[key].cTag !== cTag) return { ok: false, reason: "conflict" };
      made += 1;
      items[key] = { ...items[key], cTag: `ctag-saved-${made}`, size: body.length };
      return { ok: true, item: { ...items[key] } };
    },
    createContent: async (driveId, itemId, path, body) => {
      calls.push(["createContent", driveId, itemId, path, Buffer.from(body)]);
      if (answers.createContent !== undefined) return answers.createContent;
      const key = canonical(items, path);
      if (items[key] !== undefined) return { ok: false, reason: "exists" };
      made += 1;
      items[key] = { id: `NEW!${made}`, name: key.slice(key.lastIndexOf("/") + 1), size: body.length, cTag: `ctag-new-${made}`, file: {} };
      return { ok: true, item: { ...items[key] } };
    },
    createFolder: async (driveId, itemId, parentPath, name) => {
      calls.push(["createFolder", driveId, itemId, parentPath, name]);
      if (answers.createFolder !== undefined) return answers.createFolder;
      const parent = canonical(items, parentPath);
      const key = canonical(items, parent === "" ? name : `${parent}/${name}`);
      if (items[key] !== undefined) return { ok: false, reason: "exists" };
      made += 1;
      items[key] = { id: `DIR!${made}`, name, folder: {} };
      return { ok: true, item: { ...items[key] } };
    },
    rename: async (driveId, itemId, path, name) => {
      calls.push(["rename", driveId, itemId, path, name]);
      if (answers.rename !== undefined) return answers.rename;
      const from = canonical(items, path);
      if (items[from] === undefined) return { ok: false, reason: "not-found" };
      const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const to = parent === "" ? name : `${parent}/${name}`;
      const taken = canonical(items, to);
      if (items[taken] !== undefined && taken.toLowerCase() !== from.toLowerCase()) return { ok: false, reason: "exists" };
      for (const key of Object.keys(items)) {
        if (key !== from && !key.startsWith(`${from}/`)) continue;
        const item = items[key];
        delete items[key];
        items[to + key.slice(from.length)] = key === from ? { ...item, name } : item;
      }
      return { ok: true, item: { ...items[to] } };
    },
  };
  return { api, calls, items };
}

async function open(options = {}) {
  const fake = fakeApi(options);
  const opened = await openOneDriveWorkspace({ ref: REF, api: fake.api });
  assert.equal(opened.ok, true);
  return { provider: opened.provider, calls: fake.calls, items: fake.items };
}

const named = (calls, name) => calls.filter((call) => call[0] === name);

test("saves against the content tag it read, keeps a byte-order mark, and answers OneDrive's new tag", async () => {
  const { provider, calls } = await open();
  const read = await provider.read("Plan.md");
  assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" } });
  assert.deepEqual(await provider.write("Plan.md", "changed", read.revision), { ok: true, revision: { id: "ctag-saved-1" } });
  // The mark carries on to the next save, recorded against the tag the first save answered.
  assert.deepEqual(await provider.write("Plan.md", "again", { id: "ctag-saved-1" }), { ok: true, revision: { id: "ctag-saved-2" } });
  const saves = named(calls, "writeContent");
  assert.deepEqual(
    saves.map((call) => [call[1], call[2], call[3], call[5]]),
    [
      [MINE, "ROOT!0", "Plan.md", "ctag-1"],
      [MINE, "ROOT!0", "Plan.md", "ctag-saved-1"],
    ],
  );
  assert.deepEqual(saves[0][4], Buffer.concat([BOM, Buffer.from("changed")]));
  assert.deepEqual(saves[1][4], Buffer.concat([BOM, Buffer.from("again")]));
});

test("a save OneDrive refuses for a stale tag is a conflict naming no revision, and nothing else is tried", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.write("Plan.md", "mine", { id: "ctag-stale" }), { ok: false, reason: "conflict", theirs: null });
  assert.deepEqual(calls.slice(before).map((call) => call[0]), ["writeContent"]);
});

// The revision comes back from the renderer, and goes into a header.
test("a revision that is not a content tag is bad-request, with nothing asked", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const id of ["a\r\nX-Injected: 1", " ctag-1", "ctag\t1", "é"]) {
    assert.deepEqual(await provider.write("Plan.md", "x", { id }), { ok: false, reason: "bad-request" }, JSON.stringify(id));
  }
  assert.equal(calls.length, before);
});

// The content landed, but as what OneDrive will not say: there is nothing honest to hand the editor.
test("a write whose answer has no usable content tag landed as unknown", async () => {
  const landedWithout = { ok: true, item: { id: "ITEM!1", name: "Plan.md", file: {} } };
  const { provider } = await open({ answers: { writeContent: landedWithout, createContent: landedWithout } });
  assert.deepEqual(await provider.write("Plan.md", "x", { id: "ctag-1" }), { ok: false, reason: "unknown" });
  assert.deepEqual(await provider.write("New.md", "x", null), { ok: false, reason: "unknown" });
});

test("a refused save that is not a conflict is passed on as it came", async () => {
  for (const refusal of [
    { ok: false, reason: "offline" },
    { ok: false, reason: "unknown" },
    { ok: false, reason: "permission-denied" },
    { ok: false, reason: "too-large", sizeBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, limitBytes: ONEDRIVE_UPLOAD_LIMIT_BYTES },
  ]) {
    const { provider } = await open({ answers: { writeContent: refusal } });
    assert.deepEqual(await provider.write("Plan.md", "x", { id: "ctag-1" }), refusal, refusal.reason);
  }
});

test("a write with no revision creates the file, with no byte-order mark, and never replaces one", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Archive/New.md", "made", null), { ok: true, revision: { id: "ctag-new-1" } });
  assert.deepEqual(
    named(calls, "createContent").map((call) => [call[3], call[4].toString("utf8")]),
    [["Archive/New.md", "made"]],
  );
  // A name taken in another case is the same name to OneDrive.
  assert.deepEqual(await provider.write("Archive/new.MD", "again", null), { ok: false, reason: "conflict", theirs: null });
  assert.equal(named(calls, "writeContent").length, 0);
});

// Graph's path PUT may make the folders on the way; the app makes only what it was asked for.
test("a create into a folder that is not there is not-found, with nothing written", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.write("Missing/New.md", "x", null), { ok: false, reason: "not-found" });
  assert.equal(named(calls, "createContent").length, 0);
});

// The carry-over from PR 2's review: two spellings of one folder.
test("a write into a folder drops its listing, whichever spelling either was made under", async () => {
  const { provider, calls } = await open();
  await provider.list("Archive");
  assert.equal(named(calls, "children").length, 1);
  assert.equal((await provider.write("ARCHIVE/New.md", "x", null)).ok, true);
  const relisted = await provider.list("archive");
  assert.equal(named(calls, "children").length, 2);
  assert.deepEqual(relisted.nodes.map((node) => node.id), ["archive/New.md", "archive/Old.md"]);
});

test("a save drops the listing of the folder it saved into", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.write("Plan.md", "longer text", { id: "ctag-1" });
  await provider.list("");
  assert.equal(named(calls, "children").length, 2);
});

test("a listing in flight when a write lands in its folder is not kept", async () => {
  let holding = true;
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  const gate = async (path) => {
    if (path === "Archive" && holding) {
      holding = false;
      await held;
    }
  };
  const { provider, calls } = await open({ gate });
  const first = provider.list("Archive");
  assert.deepEqual(await provider.createDirectory("Archive/Ideas"), { ok: true });
  release();
  await first;
  const again = await provider.list("Archive");
  assert.equal(named(calls, "children").length, 2);
  assert.ok(again.nodes.some((node) => node.id === "Archive/Ideas"));
});

test("New Folder asks OneDrive for one folder in its parent, and a taken name is a conflict", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.createDirectory("Archive/Ideas"), { ok: true });
  assert.deepEqual(await provider.createDirectory("archive/IDEAS"), { ok: false, reason: "conflict" });
  assert.deepEqual(named(calls, "createFolder"), [
    ["createFolder", MINE, "ROOT!0", "Archive", "Ideas"],
    ["createFolder", MINE, "ROOT!0", "archive", "IDEAS"],
  ]);
});

test("renames in its folder and answers the new path; a change of case alone is asked like any other", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.rename("Plan.md", "plan.md"), { ok: true, path: "plan.md" });
  assert.deepEqual(await provider.rename("Archive/Old.md", "Older.md"), { ok: true, path: "Archive/Older.md" });
  assert.deepEqual(named(calls, "rename"), [
    ["rename", MINE, "ROOT!0", "Plan.md", "plan.md"],
    ["rename", MINE, "ROOT!0", "Archive/Old.md", "Older.md"],
  ]);
});

test("a rename onto a taken name is a conflict, and other refusals pass on", async () => {
  assert.deepEqual(await (await open({ answers: { rename: { ok: false, reason: "exists" } } })).provider.rename("Plan.md", "Archive"), {
    ok: false,
    reason: "conflict",
  });
  assert.deepEqual(await (await open({ answers: { rename: { ok: false, reason: "offline" } } })).provider.rename("Plan.md", "x.md"), {
    ok: false,
    reason: "offline",
  });
});

test("a rename drops the listing of its folder and of everything that was below it", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.list("Archive");
  assert.deepEqual(await provider.rename("Archive", "Kept"), { ok: true, path: "Kept" });
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
  assert.deepEqual(await provider.listKnown("archive"), { ok: true, nodes: [], complete: false });
  const root = await provider.list("");
  assert.ok(root.nodes.some((node) => node.id === "Kept"));
  assert.equal(named(calls, "children").length, 3);
});

test("refuses a rename that is not a name in the same folder, and the workspace's own folder, before any request", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const name of ["../x.md", "a/b.md", "a\\b.md", "..", "."]) {
    assert.deepEqual(await provider.rename("Plan.md", name), { ok: false, reason: "bad-request" }, name);
  }
  assert.deepEqual(await provider.rename("", "x"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.createDirectory(""), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await provider.write("", "x", null), { ok: false, reason: "permission-denied" });
  assert.equal(calls.length, before);
});

// The workspace boundary, for every write. Refused by the shared guard before any request is made.
test("refuses a write that leaves the workspace, before asking OneDrive anything", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const escape of ["../outside.md", "Archive/../../outside.md", "/etc/passwd", "C:/Windows/win.ini", "C:outside.md", "\\\\server\\share\\x.md"]) {
    for (const answer of [
      provider.write(escape, "x", null),
      provider.write(escape, "x", { id: "ctag-1" }),
      provider.createDirectory(escape),
      provider.rename(escape, "x.md"),
    ]) {
      assert.deepEqual(await answer, { ok: false, reason: "permission-denied" }, escape);
    }
  }
  assert.equal(calls.length, before);
});

// Graph's simple upload takes four megabytes; a file larger than that could be edited and never saved.
test("a file larger than OneDrive takes in one request opens read-only; one within it opens to be edited", async () => {
  const big = Buffer.alloc(ONEDRIVE_UPLOAD_LIMIT_BYTES + 1, 0x61);
  const items = { ...tree(), "big.md": { id: "ITEM!9", name: "big.md", size: big.length, cTag: "ctag-9", file: {} } };
  const { provider } = await open({ items, bytes: { "ITEM!9": big, "ITEM!3": Buffer.from("old") } });
  const read = await provider.read("big.md");
  assert.equal(read.ok, true);
  assert.equal(read.readOnly, true);
  assert.equal("readOnly" in (await provider.read("Archive/Old.md")), false);
});

test("a content tag that could not go back in a header is never handed to the editor", async () => {
  const items = { ...tree(), "odd.md": { id: "ITEM!8", name: "odd.md", size: 3, cTag: "ctag\r\nX", file: {} } };
  const { provider } = await open({ items, bytes: { "ITEM!8": Buffer.from("odd") } });
  assert.deepEqual(await provider.read("odd.md"), { ok: false, reason: "unknown" });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveWorkspaceWrite.test.js`
Expected: FAIL - `read` answers `readOnly: true`, `write` answers `{ ok: false, reason: "read-only" }`, and `provider.createDirectory is not a function` / `provider.rename is not a function`.

- [ ] **Step 3: Write the provider**

Replace `apps/desktop/src/oneDriveWorkspace.js` with:

```js
"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  ONEDRIVE_UPLOAD_LIMIT_BYTES,
  createPathGuard,
  decodeTextFile,
  encodeTextFile,
  isOneDriveTag,
  oneDriveEntriesOf,
  oneDrivePathKey,
  sameOneDriveId,
} = require("@trypthos/domain");

/// A OneDrive folder, as a workspace: browsed, read and written - saves, new files, new folders and
/// renames (docs/specs/onedrive-workspace.md).
///
/// OneDrive addresses an item by its path below another and refuses two names in one folder, so -
/// unlike Google Drive - there is no map from paths to ids, no duplicate-name suffix and no re-keying.
/// Every request names its item by the workspace root's id plus the workspace-relative path, after the
/// shared path guard has resolved that path over a root that exists nowhere (GitHub's `/repo`, Drive's
/// `/drive`): `..`, absolute, drive-qualified and UNC paths are refused here exactly as they are for a
/// folder on disk, before anything is asked of Graph.
///
/// A read asks for the item's content tag BEFORE its bytes, so the revision the editor holds is never
/// newer than what it read. A save is ONE conditional request - `If-Match` with that tag - so, unlike
/// Drive's check-write-confirm, there is no window in which another writer's change is overwritten:
/// Graph refuses a stale tag with 412 and the editor is told `conflict`. A create asks Graph to fail
/// on a name already in use, and never replaces. Media streams from the pre-authenticated address
/// Graph's 302 names, kept per file until it expires; neither it nor the token ever leaves the main
/// process.
///
/// Graph compares names without regard to case, so the listing cache is keyed by `oneDrivePathKey`:
/// one folder reached by two spellings is one entry, and a write through either drops it.

const GUARD_ROOT = "/onedrive";

/// How long a folder's listing is trusted, as Drive's: the filter, Find in Files and the chat's
/// outline all walk the tree through `list`.
const LISTING_TTL_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
}

/// Microsoft's own hosts for a OneDrive or SharePoint page, matched exactly or on a dot boundary, so
/// neither `evilsharepoint.com` nor `onedrive.live.com.evil.example` passes.
const WEB_HOSTS = ["onedrive.live.com", "1drv.ms"];
const WEB_HOST_SUFFIXES = [".sharepoint.com"];

/// Whether an item's `webUrl` may be handed to openExternal: https, no user or password in it, and a
/// Microsoft host. Graph's answer is untrusted input like any other.
function isOneDriveWebUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  return WEB_HOSTS.includes(host) || WEB_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

function parentOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function nameOf(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/// A listed entry as the tree receives it: its workspace path, its name and its kind - nothing of
/// OneDrive's crosses.
function treeNode(parent, entry) {
  return { id: parent === "" ? entry.name : `${parent}/${entry.name}`, name: entry.name, kind: entry.kind };
}

/// A refused save or create, in the provider contract's words. OneDrive's `exists` (409
/// `nameAlreadyExists`) is a name already taken, which every other provider calls a conflict - the
/// chat's create tool and New File read it so - and a conflict names no revision of theirs: asking for
/// one would be another request, and the editor keeps the user's text either way.
function writeRefusal(answer) {
  if (answer.reason === "exists" || answer.reason === "conflict") return { ok: false, reason: "conflict", theirs: null };
  return answer;
}

/// A refused New Folder or rename: a taken name is `conflict`, as on disk and in Drive - the rename
/// dialog reads it as "already called that".
function nameRefusal(answer) {
  return answer.reason === "exists" ? failure("conflict") : answer;
}

function createOneDriveProvider({ ref, api, now = Date.now, ttlMs = LISTING_TTL_MS }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });

  /// The workspace-relative form of a candidate path, "" for the root, or null when it escapes.
  function relativePath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// `oneDrivePathKey(path)` -> `{ at, generation, entries }` of that folder's last successful
  /// listing. Folded, because Graph is case-insensitive: one folder reached by two spellings is one
  /// entry, and a write through either drops it.
  const listings = new Map();
  /// `oneDrivePathKey(path)` -> `{ generation, promise }` for the listing in flight, so concurrent
  /// walks of one folder - by any spelling - ask Graph once.
  const inFlight = new Map();
  /// `oneDrivePathKey(path)` -> how many times the app has written into that folder. A listing that
  /// began before a write is not kept: what it brings back may predate the write.
  const writes = new Map();
  const writesTo = (key) => writes.get(key) ?? 0;
  /// Item id -> the pre-authenticated address its bytes were last fetched from.
  const locations = new Map();
  /// Content tag -> whether the bytes read or written at it began with a byte-order mark, so a save
  /// keeps a mark the editor never showed. A tag names one version of one file, so the record is about
  /// exactly the bytes a save replaces. Not cleared by `refresh()`: the editor still holds what it read.
  const boms = new Map();
  /// Bumped by `refresh()`. A listing begun under an older generation is never cached or joined.
  let generation = 0;

  async function entriesOf(path) {
    const key = oneDrivePathKey(path);
    const cached = listings.get(key);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, entries: cached.entries };
    }
    const joined = inFlight.get(key);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const startedWrites = writesTo(key);
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.children(ref.driveId, ref.itemId, path);
        if (!listed.ok) return listed;
        const entries = oneDriveEntriesOf(listed.items);
        if (started === generation && writesTo(key) === startedWrites) {
          listings.set(key, { at: now(), generation: started, entries });
        }
        return { ok: true, entries };
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
    return pending.promise;
  }

  /// A folder's entries as they are now: a listing that a Refresh overtook is asked for again, so a
  /// Refresh pressed mid-listing cannot be undone by it.
  async function currentEntriesOf(path) {
    for (;;) {
      const started = generation;
      const listed = await entriesOf(path);
      if (!listed.ok || generation === started) return listed;
    }
  }

  /// Drops what is known of a folder the app has just written into, so its next listing is asked of
  /// OneDrive: the cached listing, any listing in flight (which may predate the write and, through
  /// `writes`, is not kept when it lands), and - with `below` - every folder under it, for a rename
  /// that moved them all. Called after every write request, whatever it answered: one that failed
  /// as `offline` or `unknown` may have landed.
  function forget(path, { below = false } = {}) {
    const key = oneDrivePathKey(path);
    const hit = (other) => other === key || (below && other.startsWith(`${key}/`));
    const keys = new Set([key, ...[...listings.keys(), ...inFlight.keys()].filter(hit)]);
    for (const each of keys) {
      listings.delete(each);
      inFlight.delete(each);
      writes.set(each, writesTo(each) + 1);
    }
  }

  /// A file's metadata, asked for fresh by its path: a revision is never a cached one.
  async function fileAt(candidate) {
    const path = relativePath(candidate);
    if (path === null || path === "") return failure("permission-denied");
    const meta = await api.item(ref.driveId, ref.itemId, path);
    if (!meta.ok) return meta;
    if (meta.item.file === undefined || meta.item.folder !== undefined) return failure("not-found");
    return { ok: true, item: meta.item };
  }

  /// A file's bytes, refused by its size before anything is downloaded, and by what arrives after.
  async function bytesOf(item, limitBytes) {
    if (typeof item.size === "number" && item.size > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: item.size, limitBytes };
    }
    return api.download(ref.driveId, item.id, limitBytes);
  }

  /// A write that landed, as the editor receives it: the content tag Graph answered the write with,
  /// never one asked for afterwards - by then it could be a concurrent writer's, and the next save
  /// would overwrite them. A write whose answer has no usable tag landed as something nobody can
  /// name, which is `unknown`. The item's download address is dropped: it may serve the old bytes.
  function landed(item, bom) {
    if (!isOneDriveTag(item.cTag)) return failure("unknown");
    boms.set(item.cTag, bom);
    locations.delete(item.id);
    return { ok: true, revision: { id: item.cTag } };
  }

  /// A new file at a path nobody has. Its folder is listed first (through the cache, usually free):
  /// Graph's path PUT may make the folders on the way, and the app makes only what it was asked for.
  /// Graph refuses a name already in use, case-insensitively, rather than replacing it.
  async function create(path, content) {
    const parent = parentOf(path);
    const listed = await currentEntriesOf(parent);
    if (!listed.ok) return listed;
    const created = await api.createContent(ref.driveId, ref.itemId, path, encodeTextFile(content, { bom: false }));
    forget(parent);
    if (!created.ok) return writeRefusal(created);
    return landed(created.item, false);
  }

  return {
    id: ref.itemId,
    kind: "onedrive",

    async list(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const listed = await currentEntriesOf(path);
      if (!listed.ok) return listed;
      return { ok: true, nodes: listed.entries.map((entry) => treeNode(path, entry)) };
    },

    /// A folder as far as it is already known, with no request to Graph - as Drive's: the filter and
    /// Find in Files search through this, so a large OneDrive is never read all at once. `complete`
    /// is false for a folder nobody has opened since the last refresh or write into it.
    async listKnown(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const known = listings.get(oneDrivePathKey(path));
      if (known === undefined || known.generation !== generation) return { ok: true, nodes: [], complete: false };
      return { ok: true, nodes: known.entries.map((entry) => treeNode(path, entry)), complete: true };
    },

    /// The revision is the content tag, which a save presents with If-Match. A tag that could not go
    /// back in a header is nothing honest to hand the editor. A file larger than Graph's simple upload
    /// takes opens read-only: it could be edited, and never saved.
    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      if (!isOneDriveTag(found.item.cTag)) return failure("unknown");
      const fetched = await bytesOf(found.item, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      boms.set(found.item.cTag, decoded.bom);
      return {
        ok: true,
        content: decoded.content,
        revision: { id: found.item.cTag },
        ...(fetched.bytes.length > ONEDRIVE_UPLOAD_LIMIT_BYTES ? { readOnly: true } : {}),
      };
    },

    async readBytes(candidate, limitBytes) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      return bytesOf(found.item, limitBytes);
    },

    /// A file as a source of byte ranges, for the protocol that streams video and audio.
    ///
    /// The size and the item id come from the parent's listing, through the TTL'd cache, so the player's
    /// quick succession of ranges does not each start with a metadata call. Each range is fetched from
    /// the pre-authenticated address with no token; an address refused as expired is replaced once.
    async mediaSource(candidate) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      const listed = await currentEntriesOf(parentOf(path));
      if (!listed.ok) return listed;
      const wanted = nameOf(path).toLowerCase();
      const entry = listed.entries.find((known) => known.name.toLowerCase() === wanted);
      if (entry === undefined || entry.kind !== "file" || entry.sizeBytes === null) return failure("not-found");
      const { itemId, sizeBytes: size } = entry;

      async function locate(fresh) {
        const known = locations.get(itemId);
        if (!fresh && known !== undefined) return { ok: true, url: known };
        const got = await api.downloadLocation(ref.driveId, itemId);
        if (got.ok) locations.set(itemId, got.url);
        return got;
      }

      return {
        ok: true,
        size,
        /// `signal` is the window's request: when the player gives up on a range, the request stops too.
        open: async (start, end, signal) => {
          let where = await locate(false);
          if (!where.ok) return where;
          let ranged = await api.rangeFrom(where.url, start, end, { signal });
          if (!ranged.ok && ranged.reason === "expired") {
            locations.delete(itemId);
            // Nobody is left to read the answer: no new address is asked for, and the failure is the
            // one an abandoned range answers everywhere else.
            if (signal?.aborted) return failure("offline");
            where = await locate(true);
            if (!where.ok) return where;
            ranged = await api.rangeFrom(where.url, start, end, { signal });
          }
          // Refused twice in a row, straight after a new address was issued: not an expiry.
          if (!ranged.ok) return failure(ranged.reason === "expired" ? "permission-denied" : ranged.reason);
          // A 200 is the whole file: only a correct answer to a range that IS the whole file. For any
          // other, the protocol would label the full body a 206 of the wrong length. Checked here as
          // well as in the client, which only knows where the range starts.
          if (ranged.status === 200 && (start !== 0 || end !== size - 1)) {
            await ranged.body?.cancel().catch(() => {});
            return failure("offline");
          }
          return { ok: true, body: ranged.body };
        },
      };
    },

    /// A save, or - with no revision - a new file. `file:write`, New File and the chat's create-file
    /// tool all come here.
    ///
    /// A save is one conditional PUT: Graph writes only if the file is still at the tag the editor
    /// read, and refuses with 412 (`conflict`) otherwise, so another writer's change is never
    /// overwritten. The tag comes back from the renderer and is checked before it goes into a header.
    /// `options` (Save As's `overwrite`, GitHub's commit message) means nothing here: Save As never
    /// reaches a provider without a folder on disk.
    async write(candidate, content, expected) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      if (expected === null) return create(path, content);
      if (!isOneDriveTag(expected?.id)) return failure("bad-request");

      const bom = boms.get(expected.id) === true;
      const written = await api.writeContent(ref.driveId, ref.itemId, path, encodeTextFile(content, { bom }), expected.id);
      forget(parentOf(path));
      if (!written.ok) return writeRefusal(written);
      return landed(written.item, bom);
    },

    /// One new folder, in a folder that is already there. Graph refuses a name already in use.
    async createDirectory(candidate) {
      const path = relativePath(candidate);
      if (path === null || path === "") return failure("permission-denied");
      const parent = parentOf(path);
      const created = await api.createFolder(ref.driveId, ref.itemId, parent, nameOf(path));
      forget(parent);
      return created.ok ? { ok: true } : nameRefusal(created);
    },

    /// A new name for a file or folder, in the folder it is already in; answers its new
    /// workspace-relative path. A change of case alone is a rename like any other. What was listed
    /// below the old path and the new one is dropped and asked again: nothing is re-keyed.
    async rename(candidate, name) {
      const path = relativePath(candidate);
      // The workspace's own folder is what was opened; renaming it would pull the root out from under
      // every open path, exactly as on disk.
      if (path === null || path === "") return failure("permission-denied");
      const parent = parentOf(path);
      const target = relativePath(parent === "" ? name : `${parent}/${name}`);
      // A NAME, never a destination: whatever the guard reads as anything but one more segment of
      // this folder is refused.
      if (target === null || target === "" || parentOf(target) !== parent || nameOf(target) !== name) {
        return failure("bad-request");
      }
      const renamed = await api.rename(ref.driveId, ref.itemId, path, name);
      forget(parent);
      forget(path, { below: true });
      forget(target, { below: true });
      return renamed.ok ? { ok: true, path: target } : nameRefusal(renamed);
    },

    /// Where an entry lives on the web, for Open in OneDrive: the item's own `webUrl`, and only an
    /// https one at a Microsoft host. It stays in the main process: the shell opens it, the renderer
    /// never sees it.
    async webAddress(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const meta = await api.item(ref.driveId, ref.itemId, path);
      if (!meta.ok) return meta;
      const url = meta.item.webUrl;
      return isOneDriveWebUrl(url) ? { ok: true, url } : failure("not-found");
    },

    async refresh() {
      generation += 1;
      listings.clear();
      locations.clear();
      return { ok: true, truncated: false };
    },
  };
}

/// Opens a OneDrive folder: it must exist and be a folder. Answers its CURRENT name - the one in the
/// reference is what it was called when it was chosen - except for My files, which Graph calls `root`.
///
/// An own-drive reference is checked against the connected account's drive first: a folder remembered
/// under one Microsoft account is never shown under another (`other-account`). A folder shared with the
/// user lives in someone else's drive by design, so it is not checked that way.
async function openOneDriveWorkspace({ ref, api, now, ttlMs }) {
  if (ref.shared !== true) {
    const mine = await api.drive();
    if (!mine.ok) return mine;
    if (!sameOneDriveId(mine.drive.id, ref.driveId)) return failure("other-account");
  }
  const root = await api.item(ref.driveId, ref.itemId, "");
  if (!root.ok) return root;
  if (root.item.folder === undefined) return failure("not-found");
  return {
    ok: true,
    name: ref.itemId === "root" ? ref.name : root.item.name,
    provider: createOneDriveProvider({ ref, api, now, ttlMs }),
  };
}

module.exports = { openOneDriveWorkspace, GUARD_ROOT };
```

- [ ] **Step 4: Replace PR 2's read-only pins**

In `apps/desktop/test/oneDriveWorkspace.test.js`:
- In the module comment, replace `once when it has expired; nothing is ever written; and an own-drive folder is never opened under` with `once when it has expired; and an own-drive folder is never opened under`. (Writes are in `oneDriveWorkspaceWrite.test.js`.)
- Replace the test

```js
test("reads a file read-only, its revision the content tag asked for before the bytes", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "ctag-1" }, readOnly: true });
```

with

```js
test("reads a file to be edited, its revision the content tag asked for before the bytes", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "ctag-1" } });
```

(the rest of that test is unchanged).
- Delete the whole test `writes nothing: a save in this release answers read-only, asking OneDrive nothing`.

In `apps/desktop/test/oneDriveIpc.test.js`:
- Rename `opens a OneDrive folder by reference and reads it read-only, like any other workspace` to `opens a OneDrive folder by reference and reads it, like any other workspace`, and in it replace `assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" }, readOnly: true });` with `assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" } });`.
- Delete the whole test `a save into a OneDrive folder answers read-only in this release` (Task 5's refused-write tests cover `file:write` through the real client).
- In the leak guard `no OneDrive channel answers with a token or a pre-authenticated download address`, delete these four lines (Task 5 puts the writes back, against a scripted Graph that answers them):

```js
        assert.deepEqual(
          await ask("file:write", { path: `${id}/Plan.md`, content: "x", expectedRevision: { id: "ctag-ITEM!1" }, message: null }),
          { ok: false, reason: "read-only" },
        );
```

- [ ] **Step 5: Run the provider tests and the shell suite**

Run: `node --test apps/desktop/test/oneDriveWorkspaceWrite.test.js apps/desktop/test/oneDriveWorkspace.test.js` then `npm test --workspace trypthos-desktop`
Expected: PASS, no stderr. `folderToolRunner.test.js` is unaffected (its provider is a fake).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/oneDriveWorkspace.js apps/desktop/test/oneDriveWorkspaceWrite.test.js apps/desktop/test/oneDriveWorkspace.test.js apps/desktop/test/oneDriveIpc.test.js
git commit -m "Shell: OneDrive saves, creates, makes folders and renames, keyed by the folded path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shell - writes through the real handlers, and the leak guard over them

No production code changes here: `file:write`, `workspace:createDirectory` and `workspace:rename` already reach the provider through `guarded(...)` and gate on its methods, and no channel, preload member or packaging rule is added. This task pins the end-to-end contract over the REAL client and the REAL account, and extends PR 2's leak guard to the writes.

**Files:**
- Modify: `apps/desktop/test/oneDriveIpc.test.js`

**Interfaces:**
- Consumes: `registerIpcHandlers`, `createMicrosoftAuth`, `createOneDriveApi` and the provider from Tasks 2 and 4; the test file's own `withHandlers`, `scriptedGraph`, `ACCESS`, `REFRESH`, `ROTATED`, `PRESIGNED`.
- Produces: tests only.

- [ ] **Step 1: Write the tests**

In `scriptedGraph`, replace the line

```js
    seen.push({ url, authorization: init.headers?.Authorization ?? null, via: init.via, redirect: init.redirect });
```

with

```js
    const method = init.method ?? "GET";
    seen.push({
      url,
      method,
      authorization: init.headers?.Authorization ?? null,
      ifMatch: init.headers?.["If-Match"] ?? null,
      headerNames: Object.keys(init.headers ?? {}).map((name) => name.toLowerCase()),
      via: init.via,
      redirect: init.redirect,
    });
    // The writes, answered as Graph does: the item as it now is, with its new content tag. Before the
    // `/content` branch below, which is the GET's 302.
    if (method === "PUT" && url.includes("conflictBehavior=fail")) return json(file("ITEM!6", "New.md", { cTag: "ctag-new" }));
    if (method === "PUT") return json(file("ITEM!1", "Plan.md", { cTag: "ctag-saved" }));
    if (method === "POST") return json({ id: "ITEM!7", name: "Ideas", folder: {} });
    if (method === "PATCH") return json(file("ITEM!1", "Plan 2.md"));
```

In the leak guard test, where Task 4 removed the `file:write` assertion (between the `workspace:reveal` assertion and the first `onedrive:folders` one), insert:

```js
        // The writes: a save against the read's tag, a new file, a new folder and a rename.
        assert.deepEqual(
          await ask("file:write", { path: `${id}/Plan.md`, content: "x", expectedRevision: { id: "ctag-ITEM!1" }, message: null }),
          { ok: true, revision: { id: "ctag-saved" } },
        );
        assert.deepEqual(await ask("file:write", { path: `${id}/New.md`, content: "", expectedRevision: null, message: null }), {
          ok: true,
          revision: { id: "ctag-new" },
        });
        assert.deepEqual(await ask("workspace:createDirectory", { path: `${id}/Ideas` }), { ok: true });
        assert.deepEqual(await ask("workspace:rename", { path: `${id}/Plan.md`, name: "Plan 2.md" }), { ok: true, path: `${id}/Plan 2.md` });
```

In the assertions after `withHandlers`, replace

```js
  const content = seen.filter((request) => request.url.endsWith("/content"));
```

with

```js
  const content = seen.filter((request) => request.method === "GET" && request.url.endsWith("/content"));
```

and append, after the closing loop over `bearing`:

```js
  // The writes went out as Graph needs them and never anywhere else: through the fetch that refuses
  // redirects, with the token; a save with the tag it read, and a create with neither conditional
  // header (the spike: `If-None-Match: *` is ignored and overwrites).
  const writes = seen.filter((request) => request.method !== "GET");
  assert.deepEqual(writes.map((request) => request.method), ["PUT", "PUT", "POST", "PATCH"]);
  for (const request of writes) {
    assert.equal(request.via, "fetch", "a write went through the fetch that reads redirects");
    assert.equal(request.redirect, "error", "a write would follow a redirect");
    assert.equal(request.authorization, `Bearer ${ACCESS}`);
  }
  assert.equal(writes[0].ifMatch, "ctag-ITEM!1");
  assert.ok(writes[1].url.endsWith(":/New.md:/content?@microsoft.graph.conflictBehavior=fail"));
  assert.equal(writes[1].headerNames.includes("if-match"), false);
  assert.equal(writes[1].headerNames.includes("if-none-match"), false);
```

Append to the end of the file:

```js
/// Graph for one folder, through the REAL client, whose every write is refused with `refusal`: what a
/// save, a new file, a new folder and a rename reach the window as. `seen` records each method.
function refusingGraph(seen, refusal) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const plan = { id: "ITEM!1", name: "Plan.md", size: 7, cTag: "ctag-1", file: {} };
  return async (url, init = {}) => {
    const method = init.method ?? "GET";
    seen.push(method);
    if (method !== "GET") return json(refusal.status, refusal.code === null ? {} : { error: { code: refusal.code } });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/drive?")) return json(200, { id: "d0c0ffee", driveType: "personal" });
    if (url.includes("/children?")) return json(200, { value: [plan] });
    return json(200, { id: "ROOT!0", name: "Notes", folder: {} });
  };
}

/// Opens a OneDrive folder through the real handlers over `refusingGraph`, runs `body`, and answers the
/// methods of every write that reached Graph. Each caller opens its own item id: the registry of open
/// workspaces is module-level.
async function refusedWrites(itemId, refusal, body) {
  const seen = [];
  await withHandlers(
    async ({ ipcMain }) => {
      await ipcMain.invoke("onedrive:connect");
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId, name: "Notes" } });
      assert.equal(opened.ok, true);
      await body(ipcMain, opened.workspace.id);
    },
    {
      createOneDrive: (accessToken) => {
        const graph = refusingGraph(seen, refusal);
        return createOneDriveApi({ accessToken, fetch: graph, fetchManual: graph, logger: { error: () => {}, info: () => {} } });
      },
    },
  );
  return seen.filter((method) => method !== "GET");
}

test("a save OneDrive refuses as stale is a conflict at the window, asked once", async () => {
  const writes = await refusedWrites("ROOT!20", { status: 412, code: null }, async (ipcMain, id) => {
    assert.deepEqual(
      await ipcMain.invoke("file:write", { path: `${id}/Plan.md`, content: "mine", expectedRevision: { id: "ctag-1" }, message: null }),
      { ok: false, reason: "conflict", theirs: null },
    );
  });
  assert.deepEqual(writes, ["PUT"]);
});

test("a name OneDrive says is taken is a conflict for New File, New Folder and Rename, each asked once", async () => {
  const writes = await refusedWrites("ROOT!21", { status: 409, code: "nameAlreadyExists" }, async (ipcMain, id) => {
    assert.deepEqual(
      await ipcMain.invoke("file:write", { path: `${id}/plan.MD`, content: "", expectedRevision: null, message: null }),
      { ok: false, reason: "conflict", theirs: null },
    );
    assert.deepEqual(await ipcMain.invoke("workspace:createDirectory", { path: `${id}/Ideas` }), { ok: false, reason: "conflict" });
    assert.deepEqual(await ipcMain.invoke("workspace:rename", { path: `${id}/Plan.md`, name: "Old.md" }), { ok: false, reason: "conflict" });
  });
  assert.deepEqual(writes, ["PUT", "POST", "PATCH"]);
});

// A folder shared with the user to view only.
test("a save into a folder OneDrive will not let the user write is permission denied", async () => {
  const writes = await refusedWrites("ROOT!22", { status: 403, code: "accessDenied" }, async (ipcMain, id) => {
    assert.deepEqual(
      await ipcMain.invoke("file:write", { path: `${id}/Plan.md`, content: "mine", expectedRevision: { id: "ctag-1" }, message: null }),
      { ok: false, reason: "permission-denied" },
    );
  });
  assert.deepEqual(writes, ["PUT"]);
});

// A 503 does not promise the write was not processed; sending it again could conflict with itself.
test("a save answered 503 is unknown and is not sent again", async () => {
  const writes = await refusedWrites("ROOT!23", { status: 503, code: null }, async (ipcMain, id) => {
    assert.deepEqual(
      await ipcMain.invoke("file:write", { path: `${id}/Plan.md`, content: "mine", expectedRevision: { id: "ctag-1" }, message: null }),
      { ok: false, reason: "unknown" },
    );
  });
  assert.deepEqual(writes, ["PUT"]);
});

test("a save presenting a revision that is not a content tag is refused at the window, with nothing sent", async () => {
  const writes = await refusedWrites("ROOT!24", { status: 500, code: null }, async (ipcMain, id) => {
    assert.deepEqual(
      await ipcMain.invoke("file:write", { path: `${id}/Plan.md`, content: "x", expectedRevision: { id: "a\r\nX-Injected: 1" }, message: null }),
      { ok: false, reason: "bad-request" },
    );
  });
  assert.deepEqual(writes, []);
});
```

- [ ] **Step 2: Run them**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveIpc.test.js`
Expected: PASS, no stderr.

- [ ] **Step 3: Prove the guard can fail**

Temporarily change `...(manual ? {} : { redirect: "error" }),` in `send` (`apps/desktop/src/oneDriveApi.js`) to `...(manual || method !== "GET" ? {} : { redirect: "error" }),`, run `node --test apps/desktop/test/oneDriveIpc.test.js` and see the leak guard fail with `a write would follow a redirect`; then temporarily add `"If-None-Match": "*"` to `OCTETS` and see it fail on `if-none-match`. Restore both (`git diff apps/desktop/src` must be empty), and run the file again: PASS.

- [ ] **Step 4: Run the shell suite**

Run: `npm test --workspace trypthos-desktop`
Expected: PASS. `githubIpc.test.js` and `googleIpc.test.js`, which walk every handler with an empty payload, are unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/test/oneDriveIpc.test.js
git commit -m "Shell: OneDrive writes through the real handlers, and the leak guard over them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer - edit the OneDrive tree, and OneDrive's words for a refused write

**Files:**
- Modify: `apps/app/src/lib/workspaceCapabilities.ts`, `apps/app/src/lib/workspaceCapabilities.test.ts`
- Modify: `apps/app/src/hooks/useWorkspace.ts`, `apps/app/src/hooks/useWorkspace.test.ts`
- Modify: `apps/app/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/app/src/components/OpenOneDriveDialog.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: the shell's answers from Tasks 4-5: `{ ok: false, reason: "conflict", theirs: null }`, `unknown`, `too-large` with sizes, `permission-denied`, `offline`.
- Produces:
  - `canEditTree(ref)` is true for `onedrive`.
  - `providerFailureKey(kind: ProviderKind | null, reason: string, during: "save" | "create" | null = null): string | null`
  - `fail(result, kind, during: "save" | "create" | null)` inside `useWorkspace`.
  - Keys: `errors.nameTaken`, `errors.oneDriveConflict`, `errors.oneDriveSaveUnknown`, `errors.oneDriveTooLarge`, `errors.oneDrivePermissionDenied`; `errors.oneDriveReadOnly` removed.

- [ ] **Step 1: Write the failing tests**

`apps/app/src/lib/workspaceCapabilities.test.ts` - replace the first test with:

```ts
  it("edits the tree of a folder on disk, a Drive folder and a OneDrive folder, and not a repository", () => {
    expect(canEditTree({ kind: "local" })).toBe(true);
    expect(canEditTree({ kind: "google-drive" })).toBe(true);
    expect(canEditTree({ kind: "onedrive" })).toBe(true);
    expect(canEditTree({ kind: "github" })).toBe(false);
  });
```

and delete the comment line above it (`// OneDrive gains New File, New Folder and rename with its writes, in PR 3.`).

`apps/app/src/components/WorkspacePanel.test.tsx` - inside `describe("in a OneDrive workspace", ...)`, replace the two tests (`offers Open in OneDrive and Refresh on the workspace row, and nothing that writes` with its comment, and `shows a file in OneDrive through the same handler as Reveal, and offers no rename`) with:

```tsx
    // Editable since 0.104.0: the same menu as a Drive folder, with OneDrive's words for showing an entry.
    it("offers the workspace row new file, new folder and Open in OneDrive, but not rename", async () => {
      panel({ workspaces: [PLANS], folders, selectedFolder: "Plans" });
      await rightClick(screen.getByRole("button", { name: /^Plans$/ }));

      expect(items()).toEqual(["New File ...", "New Folder ...", "Open in OneDrive", "Refresh"]);
    });

    it("offers a folder rename and Open in OneDrive", async () => {
      panel({ workspaces: [PLANS], folders, selectedFolder: "Plans" });
      await rightClick(screen.getByRole("button", { name: /^ideas$/ }));

      expect(items()).toEqual(["New File ...", "New Folder ...", "Rename ...", "Open in OneDrive", "Refresh"]);
    });

    it("shows a file in OneDrive through the same handler as Reveal, and offers its rename", async () => {
      const onRevealEntry = vi.fn();
      panel({ workspaces: [PLANS], folders, onRevealEntry });
      const user = await rightClick(screen.getByRole("button", { name: /plan\.md/ }));

      expect(items()).toContain("Rename ...");
      expect(items()).not.toContain("Open in Google Drive");
      await user.click(screen.getByRole("menuitem", { name: "Open in OneDrive" }));

      expect(onRevealEntry).toHaveBeenCalledWith("Plans/plan.md");
    });

    it("renames the entry right-clicked", async () => {
      const onRename = vi.fn();
      panel({ workspaces: [PLANS], folders, onRename });
      const user = await rightClick(screen.getByRole("button", { name: /plan\.md/ }));

      await user.click(screen.getByRole("menuitem", { name: "Rename ..." }));

      expect(onRename).toHaveBeenCalledWith("Plans/plan.md");
    });
```

`apps/app/src/components/OpenOneDriveDialog.test.tsx` - replace the test `says OneDrive opens read-only in this release, and cancels` with:

```tsx
  it("says how large a file OneDrive saves, and cancels", async () => {
    const onCancel = vi.fn();
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={onCancel} onOpen={() => {}} />);

    expect(await screen.findByText("Files in OneDrive can be edited and saved, up to 4 MB each. A larger file opens read-only.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
```

`apps/app/src/hooks/useWorkspace.test.ts` - in `describe("providerFailureKey", ...)`, replace the test `words a OneDrive workspace's failures for Microsoft` (with its comment) with:

```ts
  // A OneDrive failure names Microsoft, and its own refusals say what to do about them. This is where
  // PR 1's stand-alone `oneDriveFailureKey` now lives.
  it("words a OneDrive workspace's failures for Microsoft", () => {
    expect(providerFailureKey("onedrive", "offline")).toBe("errors.oneDriveOffline");
    expect(providerFailureKey("onedrive", "rate-limited")).toBe("errors.oneDriveRateLimited");
    expect(providerFailureKey("onedrive", "not-connected")).toBe("errors.oneDriveNotConnected");
    expect(providerFailureKey("onedrive", "scope-denied")).toBe("errors.oneDriveScopeDenied");
    expect(providerFailureKey("onedrive", "timed-out")).toBe("errors.oneDriveTimedOut");
    expect(providerFailureKey("onedrive", "not-configured")).toBe("errors.oneDriveNotConfigured");
    expect(providerFailureKey("onedrive", "other-account")).toBe("errors.oneDriveOtherAccount");
    // A read's 403 keeps the generic words: "shared for viewing only" would be wrong about a read.
    expect(providerFailureKey("onedrive", "permission-denied")).toBe(failureKey("permission-denied"));
    expect(providerFailureKey("onedrive", "unknown")).toBe("errors.unknown");
    expect(providerFailureKey("onedrive", "cancelled")).toBeNull();
  });

  // A save, a create or a rename in OneDrive says what OneDrive did, and never that a file changed on disk.
  it("words a OneDrive write's refusals for OneDrive", () => {
    expect(providerFailureKey("onedrive", "conflict", "save")).toBe("errors.oneDriveConflict");
    expect(providerFailureKey("onedrive", "unknown", "save")).toBe("errors.oneDriveSaveUnknown");
    expect(providerFailureKey("onedrive", "too-large", "save")).toBe("errors.oneDriveTooLarge");
    expect(providerFailureKey("onedrive", "permission-denied", "save")).toBe("errors.oneDrivePermissionDenied");
    expect(providerFailureKey("onedrive", "permission-denied", "create")).toBe("errors.oneDrivePermissionDenied");
    // A read's too-large is the app's own limit, not OneDrive's.
    expect(providerFailureKey("onedrive", "too-large")).toBe("errors.tooLarge");
    // Nothing in OneDrive answers read-only any more; the shared key stands for whatever might.
    expect(providerFailureKey("onedrive", "read-only")).toBe(failureKey("read-only"));
  });

  it("says a name taken on a create as a name, for every provider", () => {
    for (const kind of [null, "local", "google-drive", "onedrive"] as const) {
      expect(providerFailureKey(kind, "conflict", "create")).toBe("errors.nameTaken");
    }
    expect(providerFailureKey("google-drive", "conflict", "save")).toBe("errors.driveConflict");
    expect(providerFailureKey("local", "conflict", "save")).toBe("errors.conflict");
  });
```

Append to the end of `apps/app/src/hooks/useWorkspace.test.ts`:

```ts
/// A OneDrive folder, editable since 0.104.0: the same save, conflict and tree-editing flows as any
/// other folder, worded for OneDrive where the shared words would be wrong.
describe("a OneDrive workspace, written to", () => {
  const oneDriveRef = { kind: "onedrive" as const, driveId: "d0c0ffee", itemId: "ITEM!3", name: "Plans" };
  const readPlan = async (): Promise<ReadResult> => ({ ok: true, content: "# One\n", revision: { id: "ctag-1" } });

  async function openPlan(client: WorkspaceClient) {
    const hook = renderHook(() => useWorkspace(client));
    await act(async () => {
      await hook.result.current.actions.openRef(oneDriveRef);
    });
    await act(async () => {
      await hook.result.current.actions.openPath("Plans/plan.md");
    });
    act(() => {
      hook.result.current.actions.edit("# Mine\n");
    });
    return hook.result;
  }

  // Never let the editor pretend a save landed: the spinner and the dirty mark stay until OneDrive answers.
  it("saves against the content tag the read answered, and holds the path until OneDrive acknowledges", async () => {
    const settle: ((value: WriteResult) => void)[] = [];
    const tags: (string | null)[] = [];
    const { client } = fakeClient({
      readFile: readPlan,
      writeFile: (_path, _content, revision) => {
        tags.push(revision?.id ?? null);
        return new Promise<WriteResult>((resolve) => settle.push(resolve));
      },
    });
    const result = await openPlan(client);
    expect(result.current.state.readOnly).toBe(false);

    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saving = result.current.actions.save();
    });
    expect(result.current.state.savingPaths).toEqual(["Plans/plan.md"]);
    expect(result.current.state.dirty).toBe(true);

    await act(async () => {
      settle[0]?.({ ok: true, revision: { id: "ctag-2" } });
      await saving;
    });
    expect(tags).toEqual(["ctag-1"]);
    expect(result.current.state.savingPaths).toEqual([]);
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.file?.revision.id).toBe("ctag-2");
  });

  it.each([
    ["a conflict", { ok: false, reason: "conflict", theirs: null }, "errors.oneDriveConflict"],
    ["an unconfirmed save", { ok: false, reason: "unknown" }, "errors.oneDriveSaveUnknown"],
    ["a view-only folder", { ok: false, reason: "permission-denied" }, "errors.oneDrivePermissionDenied"],
    ["no connection", { ok: false, reason: "offline" }, "errors.oneDriveOffline"],
  ])("keeps the edit and words %s for OneDrive", async (_label, refusal, key) => {
    const { client } = fakeClient({ readFile: readPlan, writeFile: async () => refusal as WriteResult });
    const result = await openPlan(client);
    await act(async () => {
      await result.current.actions.save();
    });

    expect(result.current.state.errorKey).toBe(key);
    expect(result.current.state.content).toBe("# Mine\n");
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.file?.revision.id).toBe("ctag-1");
  });

  it("says a save too large for OneDrive's one request in OneDrive's words, with both sizes", async () => {
    const { client } = fakeClient({
      readFile: readPlan,
      writeFile: async () => ({ ok: false, reason: "too-large", sizeBytes: 5 * 1024 * 1024, limitBytes: 4 * 1024 * 1024 }) as WriteResult,
    });
    const result = await openPlan(client);
    await act(async () => {
      await result.current.actions.save();
    });

    expect(result.current.state.errorKey).toBe("errors.oneDriveTooLarge");
    expect(result.current.state.errorParams).toEqual({ size: "5 MB", limit: "4 MB" });
  });

  it("makes a new file and a new folder in a OneDrive folder, and renames with the open tab following", async () => {
    const created: string[] = [];
    const { client, writes } = fakeClient({
      createDirectory: async (path) => {
        created.push(path);
        return { ok: true as const };
      },
      renameEntry: async (_path, name) => ({ ok: true as const, path: `Plans/${name}` }),
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.openRef(oneDriveRef);
    });
    await act(async () => {
      await result.current.actions.createEmptyFile("Plans", "plan.md");
    });
    await act(async () => {
      await result.current.actions.createDirectory("Plans", "ideas");
    });
    let problem: string | null = "not called";
    await act(async () => {
      problem = await result.current.actions.renameEntry("Plans/plan.md", "Plan.md");
    });

    expect(writes).toEqual([{ path: "Plans/plan.md", content: "", revision: null, message: null }]);
    expect(created).toEqual(["Plans/ideas"]);
    expect(problem).toBeNull();
    // A change of case alone, which OneDrive allows: the tab follows it.
    expect(result.current.state.file?.path).toBe("Plans/Plan.md");
    expect(result.current.state.errorKey).toBeNull();
  });

  it.each([
    ["a folder on disk", null],
    ["a OneDrive folder", oneDriveRef],
  ])("says a name already taken in %s as a name, not as a changed file", async (_label, ref) => {
    const { client } = fakeClient({
      writeFile: async () => ({ ok: false, reason: "conflict", theirs: null }) as WriteResult,
      createDirectory: async () => ({ ok: false as const, reason: "conflict" }),
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      if (ref === null) await result.current.actions.open();
      else await result.current.actions.openRef(ref);
    });
    const folder = ref === null ? "ws" : "Plans";

    await act(async () => {
      await result.current.actions.createEmptyFile(folder, "plan.md");
    });
    expect(result.current.state.errorKey).toBe("errors.nameTaken");
    await act(async () => {
      await result.current.actions.createDirectory(folder, "ideas");
    });
    expect(result.current.state.errorKey).toBe("errors.nameTaken");
  });

  it("words a New File or New Folder that could not reach OneDrive for Microsoft", async () => {
    const { client } = fakeClient({
      writeFile: async () => ({ ok: false, reason: "offline" }) as WriteResult,
      createDirectory: async () => ({ ok: false as const, reason: "offline" }),
    });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.openRef(oneDriveRef);
    });

    await act(async () => {
      await result.current.actions.createEmptyFile("Plans", "plan.md");
    });
    expect(result.current.state.errorKey).toBe("errors.oneDriveOffline");
    await act(async () => {
      await result.current.actions.createDirectory("Plans", "ideas");
    });
    expect(result.current.state.errorKey).toBe("errors.oneDriveOffline");
  });

  it("words a refused OneDrive rename for OneDrive, and a taken name as the dialog does", async () => {
    const answers: { ok: false; reason: string }[] = [
      { ok: false, reason: "permission-denied" },
      { ok: false, reason: "offline" },
      { ok: false, reason: "conflict" },
    ];
    const { client } = fakeClient({ renameEntry: async () => answers.shift() ?? { ok: false as const, reason: "unknown" } });
    const { result } = renderHook(() => useWorkspace(client));
    await act(async () => {
      await result.current.actions.openRef(oneDriveRef);
    });

    const problems: (string | null)[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        problems.push(await result.current.actions.renameEntry("Plans/plan.md", "b.md"));
      });
    }
    expect(problems).toEqual(["errors.oneDrivePermissionDenied", "errors.oneDriveOffline", "rename.problems.taken"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace trypthos-app -- workspaceCapabilities WorkspacePanel OpenOneDriveDialog useWorkspace`
Expected: FAIL - `canEditTree({ kind: "onedrive" })` is false (and the OneDrive menu lacks New File, New Folder and Rename); the picker's note is the old text; `providerFailureKey(..., "save")` answers `errors.unknown` / `errors.tooLarge` / `errors.permissionDenied` for OneDrive, and a create's conflict answers `errors.conflict`; the New File / rename tests answer `errors.unsupported` (the hook refuses before calling the client).

- [ ] **Step 3: Implement**

`apps/app/src/lib/workspaceCapabilities.ts` - replace `canEditTree` and its comment with:

```ts
/// Whether the tree can be edited from the browser: a new file, a new folder, a rename.
///
/// A folder on disk, a Drive folder and a OneDrive folder all have a mutable place a name can be
/// given; a GitHub repository has none, because a save there is a commit. The shell is still the one
/// that refuses - this only decides what the menu offers.
export function canEditTree(ref: Pick<WorkspaceRef, "kind">): boolean {
  return ref.kind === "local" || ref.kind === "google-drive" || ref.kind === "onedrive";
}
```

`apps/app/src/hooks/useWorkspace.ts` - replace `providerFailureKey` and its comment with:

```ts
/// `failureKey`, worded for the provider the failure came from.
///
/// The shared keys for offline, rate-limited and not-connected name GitHub, which is the wrong
/// provider for a Google Drive or OneDrive folder, or for either account. Everything else is provider-neutral.
/// Null `kind` is a failure with no workspace to name.
///
/// `during` says what was being attempted where the same reason means different things. A cloud
/// "unknown" on a save is specific - the service did not confirm the save - and must not be the
/// wording for a read or a sign-in that failed for an unknown reason. A `conflict` on a create is a
/// name already taken, never a file that changed since it was opened.
export function providerFailureKey(
  kind: ProviderKind | null,
  reason: string,
  during: "save" | "create" | null = null,
): string | null {
  if (during === "create" && reason === "conflict") return "errors.nameTaken";
  if (kind === "google-drive") {
    switch (reason) {
      case "unknown":
        if (during === "save") return "errors.driveSaveUnknown";
        break;
      case "other-account":
        return "errors.driveOtherAccount";
      // The shared key is generic; Drive's says the file changed there and the text is still here.
      case "conflict":
        return "errors.driveConflict";
      case "offline":
        return "errors.googleOffline";
      case "rate-limited":
        return "errors.googleRateLimited";
      case "not-connected":
        return "errors.googleNotConnected";
      case "read-only":
        return "errors.driveReadOnly";
    }
  }
  // OneDrive's own words: the shared keys for offline, rate-limited and not-connected name GitHub, the
  // sign-in's scope-denied, timed-out and not-configured name Google, and the shared conflict says a
  // file changed on disk.
  if (kind === "onedrive") {
    switch (reason) {
      case "unknown":
        if (during === "save") return "errors.oneDriveSaveUnknown";
        break;
      // Only a save's too-large is OneDrive's one-request limit; a read's is the app's own.
      case "too-large":
        if (during === "save") return "errors.oneDriveTooLarge";
        break;
      // A write refused by a folder shared for viewing only. A read's 403 keeps the generic words.
      case "permission-denied":
        if (during !== null) return "errors.oneDrivePermissionDenied";
        break;
      case "conflict":
        return "errors.oneDriveConflict";
      case "other-account":
        return "errors.oneDriveOtherAccount";
      case "offline":
        return "errors.oneDriveOffline";
      case "rate-limited":
        return "errors.oneDriveRateLimited";
      case "not-connected":
        return "errors.oneDriveNotConnected";
      case "scope-denied":
        return "errors.oneDriveScopeDenied";
      case "timed-out":
        return "errors.oneDriveTimedOut";
      case "not-configured":
        return "errors.oneDriveNotConfigured";
    }
  }
  return failureKey(reason);
}
```

In `fail`, replace `during: "save" | null = null,` with `during: "save" | "create" | null = null,`.

In `createEmptyFile`, replace

```ts
      const result = await client.writeFile(path, "", null);
      if (!result.ok) {
        fail(result);
        return;
      }
```

with

```ts
      const result = await client.writeFile(path, "", null);
      if (!result.ok) {
        // Worded for the provider, and as a create: a conflict here is a name already taken.
        fail(result, workspace.ref.kind, "create");
        return;
      }
```

In `createDirectory`, replace

```ts
      const result = await client.createDirectory(path);
      if (!result.ok) {
        fail(result);
        return;
      }
```

with

```ts
      const result = await client.createDirectory(path);
      if (!result.ok) {
        fail(result, workspace.ref.kind, "create");
        return;
      }
```

In `renameEntry`, replace

```ts
      if (!result.ok) {
        if (result.reason === "conflict") return "rename.problems.taken";
        if (result.reason === "permission-denied") return "rename.problems.denied";
        return failureKey(result.reason) ?? "errors.unknown";
      }
```

with

```ts
      if (!result.ok) {
        const kind = kindOf(stateRef.current.workspaces, path);
        if (result.reason === "conflict") return "rename.problems.taken";
        // On disk, a file another program holds open refuses a rename as a permission problem, which
        // the dialog's words cover. In OneDrive it is a folder shared for viewing only.
        if (result.reason === "permission-denied") {
          return kind === "onedrive" ? "errors.oneDrivePermissionDenied" : "rename.problems.denied";
        }
        return providerFailureKey(kind, result.reason) ?? "errors.unknown";
      }
```

`apps/app/src/locales/en.json` (editor tool, then the strict-UTF-8 check):
- After `    "conflict": "This file changed on disk since you opened it. Your edits are still here - save to a new name, or reopen the file to discard them.",` add the line `    "nameTaken": "Something in this folder is already called that. Choose another name.",`
- Replace `    "oneDriveReadOnly": "OneDrive folders open read-only in this release, so this file cannot be saved there yet.",` with:

```json
    "oneDriveConflict": "This file was changed in OneDrive since you opened it, so Trypthos did not overwrite it. Your text is still here - copy it somewhere, then reopen the file to see OneDrive's version.",
    "oneDriveSaveUnknown": "OneDrive did not confirm the save. Reopen the file to see what OneDrive has before saving again.",
    "oneDriveTooLarge": "OneDrive takes a file of up to {{limit}} from Trypthos, and this one is now {{size}}, so it was not saved. Your text is still here.",
    "oneDrivePermissionDenied": "OneDrive did not allow that change. If this folder was shared with you, it may be shared for viewing only.",
```

- In `oneDrivePicker`, replace `    "readOnlyNote": "OneDrive folders open read-only for now. Saving to OneDrive follows in the next release."` with `    "readOnlyNote": "Files in OneDrive can be edited and saved, up to 4 MB each. A larger file opens read-only."`

- [ ] **Step 4: Run them, and the guards**

Run: `npm test --workspace trypthos-app -- workspaceCapabilities WorkspacePanel OpenOneDriveDialog useWorkspace i18nKeys dashes cloudFolderSources` then `npm test --workspace trypthos-app` and `npm run typecheck`
Expected: PASS, no warnings. The i18n guard accepts the new `errors.*` keys (a dynamic prefix) and the dash guard the new strings. Strict-UTF-8 check on `en.json`: prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/workspaceCapabilities.ts apps/app/src/lib/workspaceCapabilities.test.ts apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/components/OpenOneDriveDialog.test.tsx apps/app/src/locales/en.json
git commit -m "Renderer: New File, New Folder and Rename in OneDrive, and OneDrive's words for a refused write" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, version and release notes (the controller does the manual check, line endings, push and PR)

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json` (five entries) -> `0.104.0`
- Modify: `apps/app/src/lib/releaseNotes/current.ts` (new `RECENT[0]`)
- Modify: `apps/app/src/lib/appInfo.ts` (the OneDrive row; no new third party - Graph is already in the disclaimers)
- Modify: `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`
- Modify: `docs/specs/onedrive-workspace.md` (status line, the PR 3 rulings, the manual check's finding)

- [ ] **Step 1: Find the PR number**

Run: `gh pr list --state all --limit 1 --json number -q '.[0].number'` and `gh issue list --state all --limit 1 --json number -q '.[0].number'`; the PR will be the larger of the two plus one. Use it as `pr` below and confirm it after `gh pr create`.

- [ ] **Step 2: Bump the version in lockstep**

Edit each file by hand to `0.104.0`. In `package-lock.json` change only the top-level `version` and the four `packages` entries whose `name` is `trypthos`, `trypthos-app`, `trypthos-desktop` and `@trypthos/domain` - count exactly five changes. Run `npm test --workspace trypthos-app -- versionMirrors releases` - it fails until Step 3 lands (`RECENT[0]` must equal `version.json`), then passes.

- [ ] **Step 3: Write the release entry**

At the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`:

```ts
  {
    version: "0.104.0",
    date: "<today, YYYY-MM-DD>",
    pr: <number from Step 1>,
    headline: "Save to OneDrive",
    summary:
      "Files in a OneDrive folder now open for editing and save back to OneDrive. A save goes through only if the file in OneDrive is still the version you opened: if someone changed it there meanwhile, Trypthos says so and keeps your text rather than overwriting theirs, and the saving indicator clears only once OneDrive has confirmed the save. Right-click in a OneDrive folder to make a new file or folder, or to rename a file or folder - a change of case alone included; a name already taken in that folder is refused, never replaced, and an open file's tab follows its rename. Chat can create new files in a OneDrive folder the same way, and never replaces one that is there. OneDrive takes a file of up to 4 MB in one request, so a larger file opens read-only. Making a file or folder whose name is already taken now says so in those words, in any folder.",
    added: [
      "Save files in OneDrive folders, refused rather than overwriting when the file changed in OneDrive since you opened it.",
      "New File, New Folder and Rename in OneDrive folders, and chat's create-file tool there.",
    ],
    changed: [
      "A file or folder that could not be made or renamed in a cloud folder now names the service it is on.",
      "OneDrive files over 4 MB open read-only, since OneDrive takes a file of up to 4 MB in one request.",
    ],
    fixed: [
      "Making a file or folder under a name already taken said the file had changed on disk; it now says the name is taken.",
    ],
  },
```

- [ ] **Step 4: Update the inventories in lockstep**

- `apps/app/src/lib/appInfo.ts` and `README.md` Features, the OneDrive row (identical text in both): replace `Files open read-only for now; pictures are shown, video and audio play, and Open in OneDrive shows an entry on onedrive.live.com. Saving to OneDrive follows in the next release. |` with `Edit and save files there - a save is refused rather than overwriting a change made in OneDrive since you opened the file - make files and folders, and rename them; files over 4 MB open read-only. Pictures are shown, video and audio play, and Open in OneDrive shows an entry on onedrive.live.com. |`
- `README.md` Workspace browser row: replace `In builds with OneDrive support, a OneDrive button opens a OneDrive folder the same way, read-only for now (it offers to connect a Microsoft account if none is).` with `In builds with OneDrive support, a OneDrive button opens a OneDrive folder the same way (it offers to connect a Microsoft account if none is), where right-click makes a file or folder or renames one.` In "Not built yet", replace `saving to OneDrive, Dropbox folders` with `Dropbox folders`. In the roadmap's Cloud providers item, replace `OneDrive folders open read-only. Still to come: saving to OneDrive, and Dropbox.` with `OneDrive folders open and save, with new files and folders and rename. Still to come: Dropbox.`
- `docs/features.md`, `## OneDrive`, second paragraph: replace `Files open read-only for now - saving, New File, New Folder and rename follow in the next release.` with:

```markdown
Files open for editing and save back to OneDrive: a save goes through only if the file is still the version you opened, and if someone changed it in OneDrive meanwhile Trypthos says so and keeps your text rather than overwriting theirs. The saving indicator on a tab clears only once OneDrive has confirmed the save. Right-click a folder to make a new file or folder there, or an entry to rename it - a change of case alone included; a name already taken in that folder is refused, never replaced, and an open file's tab follows its rename. Chat's create-file tool works here too, and never replaces a file. OneDrive takes a file of up to 4 MB in one request, so a larger file opens read-only.
```

- `docs/Architecture.md`:
  - The Order line: replace `OneDrive (**sign-in and read-only folders built**)` with `OneDrive (**sign-in, folders, saving, new files and folders, rename and Open in OneDrive built**)`.
  - Rename `### OneDrive (sign-in and read-only folders)` to `### OneDrive (sign-in, folders and saving)`, and replace `as of 0.103.0 OneDrive folders open read-only; saving is not built yet.` with `as of 0.103.0 OneDrive folders open, and as of 0.104.0 they save, with New File, New Folder and rename.`
  - In the `oneDriveWorkspace.js` bullet, replace `` `read` answers `readOnly: true` with revision `{ id: cTag }`; `write` answers `read-only` (the next release replaces it), and there is no `createDirectory` or `rename` yet. `` with `` `read` answers revision `{ id: cTag }`, and `readOnly: true` only for a file over 4 MB (Graph's simple-upload limit). The listing cache is keyed by `oneDrivePathKey` (the folded path), so one folder reached by two spellings is one entry. ``
  - In the reveal paragraph, replace `so a Drive workspace takes them through the same handlers` with `so Drive and OneDrive workspaces take them through the same handlers`.
  - Append after the `**Leak guard.**` bullet of the OneDrive section:

```markdown
- **The write half of `oneDrive.ts`.** `oneDriveUploadUrl` (a save, by path), `oneDriveCreateUrl` (the same with `?@microsoft.graph.conflictBehavior=fail`), `oneDriveCreateFolderUrl` (the parent's `children`) with `oneDriveFolderBody` (the same instruction in the body), `oneDriveRenameUrl`; all refuse `""`, `.` and `..` segments, so the workspace's own folder is never written or renamed. `isOneDriveTag` / `OneDriveTagSchema` (printable ASCII, at most 256) is checked before a content tag goes into `If-Match`. `ONEDRIVE_UPLOAD_LIMIT_BYTES` is 4 MB. `oneDriveWriteFailure` is a write's mapping: 400 `bad-request`, 503 `unknown` (it may have landed), otherwise `oneDriveFailure`.
- **`oneDriveApi.js` writes over the same `send()`.** `writeContent` (PUT with `If-Match`; 412 `conflict`), `createContent` (PUT failing on a taken name; 409 `nameAlreadyExists` is `exists`; never `If-None-Match`, which the spike saw ignored), `createFolder` (POST) and `rename` (PATCH `{ name }`). Every one passes `redirect: "error"` through `net.fetch` with the token last in its headers, and none goes through `fetchManual`. A body over 4 MB is `too-large` with both sizes before anything is sent. **A write is repeated only where Graph promises it was not processed:** once after a 401 with a forced token, once after a 429 honouring `Retry-After`; never after a 503 or a deadline, because a repeat of a write that landed would read as a taken name or a conflict against itself. An answer in an unknown shape is `unknown`, not `offline`.
- **The provider writes.** `write(path, content, expected)` is a save when `expected` names a content tag (checked; `bad-request` otherwise) and a create when it is null - which is how New File and the chat's create tool reach it; a create lists its parent first so Graph's path PUT never makes a folder on the way. `createDirectory` and `rename` (a name in the same folder only, by the guard; the root refused). A taken name (`exists`) and a stale save both answer `conflict` - the provider contract's word, which the chat tool, New File and the rename dialog read - with `theirs: null` from `write`. The revision handed back is the tag Graph answered the write with, never asked for afterwards; a byte-order mark is kept per content tag; a landed save drops that item's download address. **Every write drops the listing of the folder it wrote into** (and, for a rename, of everything below the old and the new path) under the folded key, whatever it answered, and bumps a per-folder write count so a listing that was in flight across the write is not kept.
- **Leak guard over the writes.** `oneDriveIpc.test.js` drives a save, a new file, a new folder and a rename through the real handlers and the real client inside the PR 2 walk, and asserts each went through `fetch` with `redirect: "error"` and the token, the save with `If-Match` and the create with neither conditional header. Refused writes (412, 409, 403, 503, a malformed tag) are pinned at the window too.
```

- `CLAUDE.md`: in the status line replace `and Google Drive folders open, save and play media, and OneDrive folders open read-only;` with `and Google Drive and OneDrive folders open, save and play media;`; in "Cloud providers" replace `**OneDrive** (read-only shipped, saving in progress)` with `**OneDrive** (shipped)`.
- `docs/specs/onedrive-workspace.md`:
  - Status line: `**Status: PR 3 delivered (0.104.0).** It is the design the work is measured against, agreed before the first line of it.`
  - The "Large uploads" row's reason becomes: `Graph's simple upload limit; upload sessions are not needed. (Ruled in PR 3: `MAX_TEXT_FILE_BYTES` is 16 MB, not below this limit, so a OneDrive file over 4 MB opens read-only and a save that grows past it is refused before anything is sent.)`
  - The Architecture "Writes:" line becomes: `  - Writes: `writeText(..., cTag)`, `createText(...)`, `createFolder(...)`, `rename(..., newName)` (ruled in PR 3: `writeContent(driveId, itemId, path, bytes, cTag)`, `createContent(driveId, itemId, path, bytes)`, `createFolder(driveId, itemId, parentPath, name)`, `rename(driveId, itemId, path, name)` - they take bytes, and the provider keeps the byte-order mark; a write is repeated after a 401 or a 429 only, never after a 503 or a deadline).`
  - Replace `dropped for a folder on any write into it.` with `dropped for a folder on any write into it (ruled in PR 3: keyed by the folded path, `oneDrivePathKey`, because Graph is case-insensitive; a listing in flight across a write is not kept).`
  - Error table: the 409 row becomes `| 409 `nameAlreadyExists` | `exists` (ruled in PR 3: inside the provider, which answers `conflict` - the provider contract's word for a taken name) |`; after the 429/503 row add `| 400 or 503 answering a write | `bad-request` / `unknown`, never repeated (ruled in PR 3: a 503 does not promise the write was not processed) |`.
  - Spike table: add a row from Step 6's finding: `| `If-Match` on a path renamed away since the read (PR 3 manual check) | <what Graph answered: 412, 404 or 201> |`.

Run the strict-UTF-8 check on `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md` and the spec.

- [ ] **Step 5: Full verification**

Run, from the repo root: `npm run lint && npm run typecheck && npm run build && npm test && npm run test:browser`
Expected: all pass, and no stderr lines in any suite (search the output for `stderr`, `Error`, `Warning`). The dash guard covers the release entry and the new catalogue strings.

- [ ] **Step 6: The manual check (controller)**

Set `TRYPTHOS_ONEDRIVE_CLIENT` to the `.secrets/onedrive-client.json` path, `npm run app`, and with a connected personal account, in a test folder only:
1. Open a markdown file in a OneDrive folder; it is editable. Edit and save: the tab's spinner shows until OneDrive answers, then clears; on onedrive.live.com the file has the new text and is still `text/markdown`. Save again: it goes through (the new tag was kept).
2. **Conflict:** edit the file on onedrive.live.com, then save in Trypthos: the banner reads "This file was changed in OneDrive since you opened it ..." and the text is still in the editor. Nothing changed on the web.
3. **The byte-order mark:** a file saved with a UTF-8 mark (made locally with one and uploaded) keeps it after a save (download and inspect its first three bytes).
4. Right-click a folder: New File (opens empty), New Folder, Rename a file and a folder, and a case-only rename (`plan.md` -> `Plan.md`); an open tab follows the rename. New File and Rename onto a name already taken (in another case too) say the name is taken.
5. The chat's create-file tool makes a file in the OneDrive folder, and refuses one that is there.
6. **A missing path under `If-Match`:** open a file, rename it on onedrive.live.com, save in Trypthos. Record what Graph answered (412 conflict, 404 not-found, or a new file created at the old name) in the spec's spike table (Step 4's row).
7. A markdown file over 4 MB opens read-only.
8. If a folder shared for viewing only is available (from a second account), a save into it says OneDrive did not allow the change.
9. Google Drive and local folders still save, create and rename as before; a name taken on New File in a local folder now says the name is taken.

Update the spec row from item 6 and run the strict-UTF-8 check on it.

- [ ] **Step 7: Commit, repair line endings, push, open the PR**

```bash
git add -A
git commit -m "Docs and release notes: 0.104.0, save to OneDrive" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
node .fix-eol.mjs origin/main
for f in $(git diff --name-only origin/main HEAD); do [ "$f" = package-lock.json ] && continue; git restore --staged --source=origin/main -- "$f"; git add "$f"; done
git commit -m "Restore main's line endings on every line this branch did not change" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git diff --stat origin/main HEAD   # only real changes
git checkout -- package-lock.json  # the repair touched the LF-pinned lock in the worktree only
rm .fix-eol.mjs
git push -u origin claude/onedrive-pr3
gh pr create --base main --title "OneDrive, part 3: save, New File, New Folder and rename" --body-file <body>
```

The PR body states: what was built; the rulings above; the manual check's findings (item 6 above in particular); the PR 2 review carry-overs closed here (path casing keyed by the folded path with the two-spellings test; `send()` extended with every Bearer write pinned to `redirect: "error"`; `expectedRevision` shape-checked before `If-Match`; the write retry policy; OneDrive wording for a refused write); **Deployment surface: needs a release (new installer).** It ends with the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review against the spec

**Coverage of Delivery item 3 and the PR 3 parts of the spec:**
- Save with `If-Match: <cTag>`, 412 -> `conflict` driving the existing banner, the text kept -> Task 1 (`oneDriveUploadUrl`), Task 2 (`writeContent`), Task 4 (`write`), Task 5 (through `file:write`), Task 6 (`errors.oneDriveConflict`). The spec's "Revision is cTag" -> PR 2's read, kept; Task 4 hands back the tag the write answered.
- Chat create and New File: `PUT ...:/content?@microsoft.graph.conflictBehavior=fail`, 409 -> taken name, never `If-None-Match` -> Tasks 1, 2 (headers asserted absent), 4 (`write(path, content, null)`), 5 (the leak walk asserts neither conditional header).
- New Folder (POST children failing on a taken name) -> Tasks 1 (`oneDriveCreateFolderUrl`, `oneDriveFolderBody`), 2, 4, 5, 6.
- Rename (PATCH name; 409 a taken name; case-only allowed) -> Tasks 1, 2, 4 (case-only test), 5, 6 (the tab follows through the provider-neutral `movePaths`).
- `canEditTree` includes onedrive; the shell's `readOnly` no longer marks every file -> Tasks 4 and 6.
- A file over 4 MB is `too-large` -> Task 1 (the limit), Task 2 (before sending; a 413 sized), Task 4 (read-only above it), Task 6 (`errors.oneDriveTooLarge`).
- The spec's Testing for `oneDriveApi`: `If-Match` on every save, `conflictBehavior=fail` on every create with `If-None-Match` absent, 401 retry, `Retry-After` cap -> Task 2. Provider: save maps 412 to `conflict`, rename and create map 409 to the taken-name result, the guard before any request -> Task 4. Leak guards over the writes, exact strings -> Tasks 2 and 5.
- Error table rows for writes: 403 -> `permission-denied` (Tasks 2, 5, 6 with OneDrive wording), 409, 412, 413, 429, 503, network/deadline -> `offline` (Task 2).
- The listing cache "dropped for a folder on any write into it" -> Task 4, keyed canonically per Task 3.
- Carry-overs from PR 2's review: path casing (ruled: folded keys; the two-spellings test) -> Tasks 1, 3, 4; `send()` for PUT/PATCH/POST keeping `redirect: "error"` and the 3xx guard, with the every-Bearer-write test -> Task 2, and over the real client in Task 5; `expectedRevision` validated with the domain schema, `bad-request` otherwise -> Tasks 1, 2, 4, 5; the retry policy (no repeat after 503 or a timeout, one after 429, one after 401 with a forced token, a timed-out write `offline` and never resent) -> Tasks 1 (`oneDriveWriteFailure`) and 2; OneDrive wording for conflict, exists, unsatisfiable, too-large, and 403 as permission-denied -> Task 6 (`exists` and `unsatisfiable` need no key, by ruling).
- Also carried: uploads through `net.fetch` with `redirect: "error"`, never `fetchManual` -> Tasks 2 and 5; the saving indicator clears only on acknowledgement -> Task 6's `savingPaths` test; listing invalidation after each write, keyed canonically -> Task 4; open tabs follow a rename -> Task 6; leak-guard extension -> Task 5; Save As into OneDrive out of scope -> unchanged (`file:saveAs` refuses a workspace with no `root` before any dialog).
- Docs and the 0.104.0 release -> Task 7.
- Not covered, deliberately: upload sessions, delta refresh, Save As into OneDrive, publisher verification (the spec's Out of scope); Graph's answer to `If-Match` on a path that no longer exists is unverified and is a manual-check item that only records the finding.

**Placeholder scan:** the only angle-bracketed values left are the release date and PR number (Task 7 Steps 1 and 3), the manual check's finding for the spike table (Task 7 Step 6), and the PR body file - all filled at run time, as in PR 2's plan. Every task carries its test code and its implementation code; no step says "similar to", "TBD" or "add error handling".

**Type and name consistency:** domain names - `ONEDRIVE_UPLOAD_LIMIT_BYTES`, `isOneDriveTag`, `OneDriveTagSchema`, `oneDrivePathKey`, `oneDriveUploadUrl`, `oneDriveCreateUrl`, `oneDriveCreateFolderUrl`, `oneDriveRenameUrl`, `oneDriveFolderBody`, `oneDriveWriteFailure`, `OneDriveWriteFailure` - are exported from the barrel in Task 1 and destructured with exactly those names in Tasks 2-4 (`domainExports.test.js` checks the shell's). The client's `writeContent(driveId, itemId, path, bytes, cTag)`, `createContent(driveId, itemId, path, bytes)`, `createFolder(driveId, itemId, parentPath, name)` and `rename(driveId, itemId, path, name)` are called with those arities by Task 4's provider and its fake, and answer `{ ok: true, item }` everywhere the provider reads `.item.cTag` / `.item.id`. The provider's `write(path, content, expected)`, `createDirectory(path)` and `rename(path, name)` match the existing IPC handlers' calls (`provider.write(request.path, request.content, request.expectedRevision, {...})`, `provider.createDirectory(request.path)`, `provider.rename(request.path, request.name)`) and `folderToolRunner.js`'s `provider.write(args.path, args.content, null)`. Failure reasons match: `conflict` (with `theirs: null` from `write`) is what `folderToolRunner.create`, `useWorkspace.createEmptyFile` / `renameEntry` and `providerFailureKey` read; `exists` and `expired` never leave the shell. Renderer: `providerFailureKey(kind, reason, during: "save" | "create" | null)` and `fail(result, kind, during)` share the one union; the keys `errors.nameTaken`, `errors.oneDriveConflict`, `errors.oneDriveSaveUnknown`, `errors.oneDriveTooLarge`, `errors.oneDrivePermissionDenied` are spelled identically in `useWorkspace.ts`, its tests and `en.json`, and `errors.oneDriveReadOnly` is removed from both the code and the catalogue.
