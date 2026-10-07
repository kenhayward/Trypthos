# OneDrive PR 2: Browse OneDrive folders (read-only) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user with a connected personal Microsoft account can open My files, any folder in it, or a folder someone shared with them as a read-only workspace: browse its tree, read markdown and text, see embedded pictures, play and seek video and audio, Open in OneDrive, refresh it, and have it come back at the next launch - with no token and no pre-authenticated download address ever crossing IPC or reaching a log. Version 0.103.0.

**Architecture:** Pure OneDrive pieces (ids, Graph addresses with per-segment path encoding, response schemas, `oneDriveFailure`, how a listing becomes tree entries and picker folders) in `packages/domain/src/oneDrive.ts`. The shell gains a hand-rolled Graph client over `net.fetch` (`oneDriveApi.js`, token from PR 1's `microsoftAuth.accessToken`) whose downloads ask Graph for the 302 `Location` without following it and fetch that address with no token, and a provider (`oneDriveWorkspace.js`) that addresses everything by path below the workspace root after the shared path guard over `/onedrive`, with a short listing cache and no id map. A new `onedrive` workspace kind joins `WorkspaceRef` (settings v25), the provider registry (with the other-account check for an own-drive ref) and the renderer's marks. `onedrive:folders` feeds a picker that is Drive's dialog generalised over a folder source. A save answers `read-only`, as Drive's PR 2 did.

**Tech Stack:** TypeScript + zod 4 (domain), Electron CommonJS + `net.fetch` (shell), React 19 + react-i18next + Tailwind v4 (renderer), vitest (domain, renderer), `node --test` (shell).

**Spec:** `docs/specs/onedrive-workspace.md` - "What the spike established", "Decisions taken", "Architecture", "Error handling", "Testing", "Delivery" item 2 and "Open questions" are binding. Where a ruling below differs, the ruling says why.

## Global Constraints

- TDD: every behaviour change starts with a failing test, run and seen to fail for the stated reason, then the minimal code. Test output stays pristine: no warnings and no stray `console.error` (the jsdom setup fails a test on one - opt in with `expectsConsoleError` from `apps/app/src/test-setup` only where a test provokes one on purpose). Shell modules take an injected `logger`; shell tests pass a collecting one, or capture `console.error` where a handler logs through it.
- **Tokens and pre-authenticated addresses never cross IPC, never reach a log, never appear in an error message.** That is the Microsoft access token, the refresh token, and any download address Graph's 302 names. Log lines carry a step name plus `error?.code ?? error?.name` only - never a URL (it holds a path, an id or a signature), a body, a file name, a path or `error.message`.
- Leak-guard tests assert the **exact** strings are absent (never a host-name substring - CodeQL flags that).
- **Ids** reach a Graph address only after `isOneDriveId` / `OneDriveIdSchema` (`^[A-Za-z0-9!._-]{1,256}$`). In the shell an id that fails answers `not-found` with no request; at an IPC boundary the schema refuses it as `bad-request`.
- **Paths** are workspace-relative, `/`-separated, and go through `createPathGuard` over `GUARD_ROOT = "/onedrive"` before any request. Each segment is `encodeURIComponent`-ed by the domain's builders; nothing in the shell builds a Graph address by hand.
- Failures cross IPC as results `{ ok: false, reason }`, never throws. Shell modules never throw outward.
- Failure reasons used: `not-found`, `permission-denied`, `offline`, `rate-limited`, `not-connected`, `not-configured`, `other-account`, `too-large`, `not-text`, `unsupported-encoding`, `unsatisfiable`, `read-only`, `bad-request`, `unknown`. `exists` and `conflict` come out of the domain mapping for PR 3. `expired` is internal to the shell (the client tells the provider a pre-authenticated address was refused) and never leaves the provider.
- Workspace kind string: `"onedrive"`. Settings `SETTINGS_VERSION` 24 -> 25.
- Every user-facing string goes through `apps/app/src/locales/en.json`, read with literal `t("...")` keys or listed by a `...Keys()` function the i18n guard reads. **No em or en dashes** in user-facing text, release notes, README or features.md; use `-`.
- Colours come from tokens in `apps/app/src/index.css` - never a hex in a component. A new token is defined in all three theme blocks and listed in `theme.browser.test.tsx`.
- **Never put real user data in fixtures:** `ada@example.com`, drive ids `d0c0ffee` / `beefcafe`, item ids `ITEM!1`, `SHARED!7`, invented tokens and `https://download.invented.example/...` addresses.
- Version: **0.103.0** (functional enhancement: Minor +1, Build 0). `version.json` + root/app/desktop/domain `package.json` + exactly five `package-lock.json` entries (top-level `version`, `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]`) - match on the workspace `name`, never find-and-replace (a dependency can share the old version string).
- Line endings: committed files mix CRLF and LF and the editor tools rewrite to LF. Commit, then run the repair script against `origin/main` and re-stage with `git restore --staged --source=origin/main -- F && git add F` per file (see AGENTS.md). `package-lock.json` is LF-pinned by `.gitattributes`.
- **Strict UTF-8 after every edit to `en.json` or a markdown file:** `node -e "for (const f of process.argv.slice(1)) new TextDecoder('utf-8', { fatal: true }).decode(require('fs').readFileSync(f))" apps/app/src/locales/en.json <each .md you touched>` must print nothing. (An earlier run corrupted UTF-8 by writing through a shell.)
- Writing files through a shell heredoc or a Python string mangles backslashes (`\\`, `\b`, `\u0000`): use the editor tools for every file in this plan - several hold regex escapes and UNC paths.
- **The shell loads the built domain.** `apps/desktop` requires `@trypthos/domain` from `packages/domain/dist`: run `npm run build --workspace @trypthos/domain` after any domain change and before shell tests (`npm test --workspace trypthos-desktop` does it in `pretest`). Every name a shell file destructures from the domain must be exported from `packages/domain/src/index.ts` (`domainExports.test.js` enforces it).
- Commands, from the repo root: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser`. There is no vitest shim at the root of this worktree, so one renderer file is `npm test --workspace trypthos-app -- <name>`, one domain file is `npm test --workspace @trypthos/domain -- <name>`, one browser-suite file is `npm run test:browser --workspace trypthos-app -- <name>`, and one shell file is `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/<file>.test.js`.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (each commit step below passes it as a second `-m`). Push only in Task 8.

## Rulings recorded while planning

Taken before planning (binding):

- **The OneDrive mark is a simple generic cloud glyph** in OneDrive blue, drawn in the app's outline style with its own colour token (`--tp-onedrive`) - not Microsoft's logo artwork.
- **The picker's places are "My files" and "Shared with me".** `sharedWithMe` failing or returning nothing shows that place's empty state, never a dialog error (spec, Open questions). The shell answers a failed `sharedWithMe` as `{ ok: true, folders: [] }` and logs the step.
- **A shared folder is listed at `/drives/{driveId}/items/{itemId}`** from the shared item's `remoteItem`. Its `driveId` is someone else's, and the other-account check applies only to own-drive refs.
- **Path addressing:** `/drives/{driveId}/items/{rootItemId}:/{encoded path}:` with each segment `encodeURIComponent`-ed; the workspace root itself is addressed by its item id. `createPathGuard` over `/onedrive` runs before any request.
- **Listing cache:** a short TTL (60 s, as Drive's `LISTING_TTL_MS`), with no id map, no duplicate-name suffix and no rekeying - OneDrive forbids duplicate names and is addressed by path.
- **Ranged reads:** 206 with a `Content-Range` matching the request, or 200 only for a whole-file range (the client accepts a 200 only from offset 0; the provider accepts it only when the range ends at the last byte). The deadline covers headers only, and the window's abort signal is threaded through. An expired pre-authenticated address (401/403) fetches a new location once.

Added while planning (each with its reason and the cost if wrong):

- **Read-only is the shell's per-file `readOnly: true` on every OneDrive read, and `write` answers `read-only`.** Drive's PR 2 opened files read-only by a renderer kind check; since then the shell's per-file `readOnly` (Google Docs) exists and the renderer honours it, so nothing in the renderer needs a OneDrive branch for it. `write` must still exist, because `file:write` and the chat's create-file tool call it unconditionally. Cost if wrong: one line in `read` in PR 3.
- **The ref carries `shared: true` for a folder shared with the user** (`{ kind, driveId, itemId, shared?, name }`). A `driveId` alone cannot tell a shared folder (someone else's drive, by design) from an own-drive folder remembered under another account; without the flag the second reads as `not-found` rather than `other-account`. Not part of `workspaceRefKey`. Cost if wrong: an optional field that stays in settings v25 files.
- **Drive ids are compared case-insensitively in the other-account check only** (`sameOneDriveId`); `workspaceRefKey` stays unfolded as the spec says. Graph does not promise one spelling of a personal drive id across endpoints, and a false `other-account` would lock a user out of their own folder. Cost if wrong: none - hex ids that differ only in case are the same drive.
- **Domain names are prefixed** (`oneDriveItemUrl`, `oneDrivePathUrl`, `oneDriveChildrenUrl`, `oneDriveContentUrl`, `oneDriveSharedWithMeUrl`), because `childrenUrl`, `createUrl`, `fileUrl` and `sharedWithMeUrl` are already Drive's in the domain barrel. `createUrl` and the other write builders arrive with the writes in PR 3.
- **The spec's `readText(..., limitBytes)` is `download(driveId, itemId, limitBytes)` answering bytes.** Pictures read through the same call, and decoding (and the byte-order mark) stays in the provider with `decodeTextFile`, as Drive's does. A text read also goes through the 302 location fetched without the token, rather than letting `net.fetch` follow Graph's redirect with the `Authorization` header on it.
- **My files is the `root` alias on the connected drive's real id** (`{ driveId: <mine>, itemId: "root", name: "My files" }`), named by the name it was chosen under because Graph calls the root item `root`. The picker learns the drive id from the `my-files` answer (`{ ok, driveId, folders }`).
- **The OneDrive header button is shown when the build has OneDrive (`configured`), not only when connected.** Google's button is always shown and its picker carries a connect control; OneDrive's picker carries the same one. The spec's "shown only when configured and connected - as Google's is" holds for `configured` only. Cost if wrong: one condition in `App.tsx`.
- **The picker's "tabs" are top-level rows**, as Drive's My Drive and Shared with me rows are; no tab strip is introduced.
- **One OneDrive mark for every OneDrive workspace row** (no `driveVariant` equivalent). Picker folder rows reuse `DriveGlyph`'s generic folder, shared-folder and shared-with-me outlines.
- **The label is `OneDrive / <name>`** (the spec wrote `OneDrive: <name>`), matching `Google Drive / <name>` in `workspaceRefLabel`.
- **The spec's `busy` is the app's existing `rate-limited` reason.** A 409 is `exists` only for `nameAlreadyExists`, any other 409 is `conflict` (PR 3 uses both).
- **A `remoteItem` in a listing (a shared folder added to My files) is hidden from the tree but offered in the picker** as a shared folder in its owner's drive: the tree is addressed by path, and a path cannot cross into another drive.
- **A pre-authenticated address refused twice in a row is `permission-denied`.**
- **The "searched only where you have opened them" line becomes provider-neutral** (`workspace.searchPartialCloud`, "Cloud folders are searched only where you have opened them."), because the OneDrive provider has `listKnown` too and a OneDrive filter would otherwise be told about Google Drive.
- **`downloadLocation` uses `redirect: "manual"`.** If Electron's `net.fetch` turns out to hide the `Location` of a manual redirect, the manual check in Task 8 catches it; the fallback (the item's `@microsoft.graph.downloadUrl` from a plain item GET) is recorded in the spec then, not built speculatively.
- **Graph's 403 at `/me` is `permission-denied`** in `microsoftAuthErrorFor` (PR 1 review); every other 4xx Microsoft does not name stays `unknown`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/oneDrive.ts` (new, + test) | Ids, Graph addresses, schemas, `oneDriveFailure`, `retryAfterMs`, `contentRangeMatches`, `oneDriveEntriesOf`, `oneDriveFoldersOf`. Pure. |
| `packages/domain/src/microsoftAuth.ts` (+ test) | Graph 403 at `/me` is `permission-denied`. |
| `packages/domain/src/workspaceRef.ts` (+ test) | The `onedrive` kind; `PROVIDER_KINDS`. |
| `packages/domain/src/settings.ts` (+ test) | Version 25. |
| `packages/domain/src/ipc.ts` (+ test) | `OneDriveFoldersRequest`; `onedrive:folders` in `IPC_CHANNELS`. |
| `packages/domain/src/index.ts` | Re-exports. |
| `apps/desktop/src/oneDriveApi.js` (new, + test) | Graph reads: `drive`, `children`, `item`, `sharedWithMe`, `downloadLocation`, `download`, `rangeFrom`. |
| `apps/desktop/src/oneDriveWorkspace.js` (new, + test) | The provider and `openOneDriveWorkspace`. |
| `apps/desktop/src/providers.js` (+ test) | The `onedrive` opener. |
| `apps/desktop/src/ipcHandlers.js` | `createOneDrive` dependency, `providerDeps.oneDrive`, `onedrive:folders`. |
| `apps/desktop/src/preload.js` (+ `preloadBridge.test.js`) | `listOneDriveFolders`. |
| `apps/desktop/src/main.js` | Builds the OneDrive client factory. |
| `apps/desktop/test/microsoftAuth.test.js` | The cancelled sign-in's generation bump, pinned (PR 1 review). |
| `apps/desktop/test/oneDriveIpc.test.js` | Workspace and folder channels; the token and address leak guard over the real client. |
| `apps/app/src/index.css`, `lib/theme.browser.test.tsx` | `--tp-onedrive` in every theme block. |
| `apps/app/src/components/SourceGlyph.tsx` | The OneDrive mark and colour. |
| `apps/app/src/components/WorkspaceHome.tsx` (+ test) | The kind line for a OneDrive folder. |
| `apps/app/src/hooks/useWorkspace.ts` (+ test) | `providerFailureKey("onedrive", ...)`. |
| `apps/app/src/lib/cloudAccounts.ts` (+ test) | `oneDriveFailureKey` folded into `providerFailureKey`. |
| `apps/app/src/lib/workspaceCapabilities.ts` (+ new test) | `opensInBrowser` includes `onedrive`; `canEditTree` does not yet. |
| `apps/app/src/lib/cloudFolders.ts` (new) | The folder-source types the shared picker is driven by. |
| `apps/app/src/components/OpenCloudFolderDialog.tsx` (new) | The shared folder picker. |
| `apps/app/src/components/cloudFolderSources.tsx` (new, + test) | `googleDriveFolderSource`, `oneDriveFolderSource`, `cloudFolderKeys`. |
| `apps/app/src/components/OpenDriveDialog.tsx` | A thin wrapper over the shared picker; its tests are unchanged. |
| `apps/app/src/components/OpenOneDriveDialog.tsx` (new, + test) | OneDrive's picker. |
| `apps/app/src/lib/workspaceClient.ts` | `OneDriveLocation`, `OneDriveFoldersResult`, `listOneDriveFolders`. |
| `apps/app/src/components/WorkspacePanel.tsx` (+ test) | OneDrive header button and source-menu entry; Open in OneDrive; neutral partial-search line. |
| `apps/app/src/components/FindDialog.tsx` (+ test) | Neutral partial-search line. |
| `apps/app/src/App.tsx` (+ test) | Whether OneDrive is configured; the OneDrive picker. |
| `apps/app/src/lib/i18nKeys.test.ts` | Reads `cloudFolderKeys()`. |
| `apps/app/src/locales/en.json` | `home.kindOneDrive`, `workspace.openOneDrive`, `workspace.openInOneDrive`, `workspace.searchPartialCloud`, `errors.oneDriveOtherAccount`, `errors.oneDriveReadOnly`, `cloud.loadingFolders` / `noFolders` / `openThisFolder`, `oneDrivePicker.*`. |
| Docs | `version.json` + mirrors, `releaseNotes/current.ts`, `appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`, the spec. |

---

### Task 1: Domain - `oneDrive.ts`, and Graph's 403 at `/me`

**Files:**
- Create: `packages/domain/src/oneDrive.ts`
- Create: `packages/domain/src/oneDrive.test.ts`
- Modify: `packages/domain/src/index.ts` (a block after the `./googleDrive` block)
- Modify: `packages/domain/src/microsoftAuth.ts`, `packages/domain/src/microsoftAuth.test.ts` (PR 1 review: 403)
- Modify: `docs/specs/onedrive-workspace.md` (the error table - PR 1 review)

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@trypthos/domain`):
  - `GRAPH_API = "https://graph.microsoft.com/v1.0"`, `ONEDRIVE_MY_DRIVE_URL`, `MAX_RETRY_AFTER_MS = 10_000`
  - `isOneDriveId(value: string): boolean`, `OneDriveIdSchema`, `sameOneDriveId(one: string, other: string): boolean`
  - `OneDriveItemSchema` / `type OneDriveItem`, `OneDrivePageSchema` (`{ value: OneDriveItem[]; "@odata.nextLink"?: string }`), `OneDriveDriveSchema` (`{ id: string; driveType?: string }`), `graphErrorCode(body: unknown): string | null`
  - `oneDriveItemUrl(driveId, itemId)`, `oneDrivePathUrl(driveId, itemId, path)`, `oneDriveMetaUrl(driveId, itemId, path)`, `oneDriveChildrenUrl(driveId, itemId, path)`, `oneDriveContentUrl(driveId, itemId)`, `oneDriveSharedWithMeUrl()` - all `string`
  - `isGraphUrl(value: string): boolean`, `isHttpsUrl(value: string): boolean`
  - `type OneDriveFailure = "not-connected" | "permission-denied" | "not-found" | "exists" | "conflict" | "too-large" | "rate-limited" | "offline" | "unknown"`, `oneDriveFailure(status: number, code: string | null): OneDriveFailure`
  - `retryAfterMs(header: string | null): number`, `contentRangeMatches(header: string | null, start: number, end: number): boolean`
  - `interface OneDriveEntry { name; kind: "file" | "directory"; itemId; cTag: string | null; sizeBytes: number | null }`, `oneDriveEntriesOf(items: readonly OneDriveItem[]): OneDriveEntry[]`
  - `interface OneDriveFolder { driveId; itemId; name; shared: boolean }`, `oneDriveFoldersOf(items: readonly OneDriveItem[], driveId: string | null): OneDriveFolder[]`
  - `microsoftAuthErrorFor(403, anything)` now answers `"permission-denied"`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/oneDrive.test.ts
import { describe, expect, it } from "vitest";
import {
  GRAPH_API,
  MAX_RETRY_AFTER_MS,
  ONEDRIVE_MY_DRIVE_URL,
  OneDriveDriveSchema,
  OneDriveIdSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveEntriesOf,
  oneDriveFailure,
  oneDriveFoldersOf,
  oneDriveItemUrl,
  oneDriveMetaUrl,
  oneDrivePathUrl,
  oneDriveSharedWithMeUrl,
  retryAfterMs,
  sameOneDriveId,
} from "./oneDrive";

const DRIVE = "d0c0ffee";
const SELECT = "$select=id,name,size,folder,file,eTag,cTag,webUrl,parentReference,remoteItem";

describe("OneDrive ids", () => {
  it("accepts a personal drive id, an item id and the root alias", () => {
    for (const id of [DRIVE, "D0C0FFEE!101", "root", "ITEM!1"]) {
      expect(isOneDriveId(id)).toBe(true);
      expect(OneDriveIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("refuses anything that could change an address", () => {
    for (const id of ["", "../x", "a/b", "a?b", "a#b", "a b", "a%2Fb", "x".repeat(257)]) {
      expect(isOneDriveId(id)).toBe(false);
      expect(OneDriveIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("compares drive ids without regard to case", () => {
    expect(sameOneDriveId("d0c0ffee", "D0C0FFEE")).toBe(true);
    expect(sameOneDriveId("d0c0ffee", "beefcafe")).toBe(false);
  });
});

describe("Graph addresses", () => {
  it("names an item by id, and by a path below it, one encoded segment at a time", () => {
    expect(oneDriveItemUrl(DRIVE, "root")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root`);
    expect(oneDrivePathUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root`);
    // A `#`, `?` or `%` in a name must not end the path or start a query; a space and a non-ASCII
    // letter are encoded too. The `/` between segments is the one character left as it is.
    expect(oneDrivePathUrl(DRIVE, "ITEM!3", "Notes #1/50% done?/naïve plan.md")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/ITEM!3:/Notes%20%231/50%25%20done%3F/na%C3%AFve%20plan.md:`,
    );
  });

  it("asks for an item's fields, a folder's children a page at a time, and a file's content", () => {
    expect(oneDriveMetaUrl(DRIVE, "root", "a.md")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root:/a.md:?${SELECT}`);
    expect(oneDriveMetaUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root?${SELECT}`);
    expect(oneDriveChildrenUrl(DRIVE, "root", "")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/root/children?$top=200&${SELECT}`);
    expect(oneDriveChildrenUrl(DRIVE, "root", "Notes")).toBe(
      `${GRAPH_API}/drives/d0c0ffee/items/root:/Notes:/children?$top=200&${SELECT}`,
    );
    expect(oneDriveContentUrl(DRIVE, "ITEM!1")).toBe(`${GRAPH_API}/drives/d0c0ffee/items/ITEM!1/content`);
  });

  it("asks for the connected drive and for what is shared with the user", () => {
    expect(ONEDRIVE_MY_DRIVE_URL).toBe("https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType");
    expect(oneDriveSharedWithMeUrl()).toBe("https://graph.microsoft.com/v1.0/me/drive/sharedWithMe");
  });

  // A next page's address comes from Graph's answer, and the token goes with it.
  it("knows a Graph address from anywhere else", () => {
    expect(isGraphUrl(`${GRAPH_API}/drives/d0c0ffee/items/root/children?$skiptoken=p2`)).toBe(true);
    expect(isGraphUrl("http://graph.microsoft.com/v1.0/me")).toBe(false);
    expect(isGraphUrl("https://graph.microsoft.com.example/v1.0/me")).toBe(false);
    expect(isGraphUrl("https://graph.microsoft.com/beta/me")).toBe(false);
    expect(isGraphUrl("not a url")).toBe(false);
  });

  it("opens only https addresses", () => {
    expect(isHttpsUrl("https://onedrive.live.com/?id=ITEM!1")).toBe(true);
    expect(isHttpsUrl("http://onedrive.live.com/")).toBe(false);
    expect(isHttpsUrl("file:///C:/x")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
  });
});

describe("what Graph answers", () => {
  // The spike's shapes: a file with both tags, a folder with no cTag, and a shared folder in the
  // user's own drive, which is a remote item pointing into somebody else's.
  const FILE = {
    id: "ITEM!1",
    name: "Plan.md",
    size: 5,
    eTag: "e1",
    cTag: "c1",
    webUrl: "https://onedrive.live.com/?id=ITEM!1",
    file: { mimeType: "text/markdown" },
    parentReference: { driveId: DRIVE },
    "@microsoft.graph.downloadUrl": "https://download.invented.example/x",
  };
  const FOLDER = { id: "ITEM!2", name: "Archive", eTag: "e2", folder: { childCount: 3 } };
  const REMOTE = {
    id: "LINK!9",
    name: "Joint",
    remoteItem: { id: "SHARED!7", folder: { childCount: 1 }, parentReference: { driveId: "beefcafe" } },
  };

  it("accepts a file, a folder and a remote item, dropping what it did not ask for", () => {
    const file = OneDriveItemSchema.parse(FILE);
    expect(file.cTag).toBe("c1");
    expect("@microsoft.graph.downloadUrl" in file).toBe(false);
    expect(OneDriveItemSchema.parse(FOLDER).cTag).toBeUndefined();
    expect(OneDriveItemSchema.parse(REMOTE).remoteItem?.parentReference?.driveId).toBe("beefcafe");
  });

  it("refuses an item without an id or a name, or with a size that is not a number", () => {
    expect(OneDriveItemSchema.safeParse({ name: "a" }).success).toBe(false);
    expect(OneDriveItemSchema.safeParse({ id: "a" }).success).toBe(false);
    expect(OneDriveItemSchema.safeParse({ ...FILE, size: "5" }).success).toBe(false);
  });

  it("reads a page and its next link, and refuses a page without a value", () => {
    const page = OneDrivePageSchema.parse({ value: [FILE], "@odata.nextLink": `${GRAPH_API}/x?$skiptoken=2` });
    expect(page.value).toHaveLength(1);
    expect(page["@odata.nextLink"]).toBe(`${GRAPH_API}/x?$skiptoken=2`);
    expect(OneDrivePageSchema.safeParse({}).success).toBe(false);
  });

  it("reads the connected drive", () => {
    expect(OneDriveDriveSchema.parse({ id: DRIVE, driveType: "personal", owner: {} })).toEqual({ id: DRIVE, driveType: "personal" });
    expect(OneDriveDriveSchema.safeParse({ driveType: "personal" }).success).toBe(false);
  });

  it("reads Graph's error code, or nothing", () => {
    expect(graphErrorCode({ error: { code: "itemNotFound", message: "x" } })).toBe("itemNotFound");
    expect(graphErrorCode({ error: "invalid_grant" })).toBeNull();
    expect(graphErrorCode(null)).toBeNull();
  });
});

// The spec's error table, row by row.
describe("oneDriveFailure", () => {
  it.each([
    [401, "InvalidAuthenticationToken", "not-connected"],
    [403, "accessDenied", "permission-denied"],
    [404, "itemNotFound", "not-found"],
    [409, "nameAlreadyExists", "exists"],
    [409, null, "conflict"],
    [412, null, "conflict"],
    [413, null, "too-large"],
    [429, "activityLimitReached", "rate-limited"],
    [503, null, "rate-limited"],
    [400, "invalidRequest", "unknown"],
    [500, null, "offline"],
    [502, null, "offline"],
  ])("%i %s is %s", (status, code, reason) => {
    expect(oneDriveFailure(status, code)).toBe(reason);
  });
});

describe("retryAfterMs", () => {
  it.each([
    ["5", 5_000],
    ["60", 10_000],
    [null, 1_000],
    ["Wed, 21 Oct 2026 07:28:00 GMT", 1_000],
    ["-1", 1_000],
  ])("Retry-After %s waits %i ms", (header, ms) => {
    expect(retryAfterMs(header)).toBe(ms);
  });

  it("never waits more than ten seconds", () => {
    expect(MAX_RETRY_AFTER_MS).toBe(10_000);
  });
});

describe("contentRangeMatches", () => {
  it("accepts exactly the range that was asked for", () => {
    expect(contentRangeMatches("bytes 5-9/20", 5, 9)).toBe(true);
    expect(contentRangeMatches("bytes 5-9/*", 5, 9)).toBe(true);
  });

  it("refuses another range, a missing header and nonsense", () => {
    expect(contentRangeMatches("bytes 0-4/20", 5, 9)).toBe(false);
    expect(contentRangeMatches("bytes 5-10/20", 5, 9)).toBe(false);
    expect(contentRangeMatches(null, 5, 9)).toBe(false);
    expect(contentRangeMatches("5-9", 5, 9)).toBe(false);
  });
});

describe("oneDriveEntriesOf", () => {
  const items = OneDrivePageSchema.parse({
    value: [
      { id: "ITEM!1", name: "plan.md", size: 5, cTag: "c1", file: {} },
      { id: "ITEM!2", name: "Archive", folder: {} },
      { id: "ITEM!3", name: "Zeta.md", file: {} },
      { id: "ITEM!4", name: "alpha", folder: {} },
      { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
      { id: "NB!1", name: "Notebook" },
      { id: "BAD!1", name: "a\\b", file: {} },
    ],
  }).value;

  it("lists folders first, then files, by name whatever the case", () => {
    expect(oneDriveEntriesOf(items).map((entry) => entry.name)).toEqual(["alpha", "Archive", "plan.md", "Zeta.md"]);
  });

  // A remote item lives in another drive, and a path cannot cross into one; a notebook is neither a
  // file nor a folder; a name holding a separator would read as two path segments.
  it("leaves out remote items, notebooks and names a path cannot carry", () => {
    const names = oneDriveEntriesOf(items).map((entry) => entry.name);
    expect(names).not.toContain("Joint");
    expect(names).not.toContain("Notebook");
    expect(names).not.toContain("a\\b");
  });

  it("carries the id, the content tag and the size, or null where Graph sent none", () => {
    expect(oneDriveEntriesOf(items).find((entry) => entry.name === "plan.md")).toEqual({
      name: "plan.md",
      kind: "file",
      itemId: "ITEM!1",
      cTag: "c1",
      sizeBytes: 5,
    });
    expect(oneDriveEntriesOf(items).find((entry) => entry.name === "Zeta.md")).toEqual({
      name: "Zeta.md",
      kind: "file",
      itemId: "ITEM!3",
      cTag: null,
      sizeBytes: null,
    });
  });
});

describe("oneDriveFoldersOf", () => {
  const items = OneDrivePageSchema.parse({
    value: [
      { id: "ITEM!2", name: "Projects", folder: {} },
      { id: "ITEM!1", name: "Plan.md", file: {} },
      { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
      { id: "LINK!8", name: "notes.md", remoteItem: { id: "SHARED!6", parentReference: { driveId: "beefcafe" } } },
      { id: "LINK!7", name: "Nowhere", remoteItem: { id: "SHARED!5", folder: {} } },
    ],
  }).value;

  it("answers a drive's folders and the shared folders in it, by name", () => {
    expect(oneDriveFoldersOf(items, DRIVE)).toEqual([
      { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
      { driveId: DRIVE, itemId: "ITEM!2", name: "Projects", shared: false },
    ]);
  });

  // Shared with me has no drive of its own: only remote folders, each in the drive it lives in.
  it("answers only shared folders when there is no drive", () => {
    expect(oneDriveFoldersOf(items, null)).toEqual([{ driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true }]);
  });
});
```

In `packages/domain/src/microsoftAuth.test.ts`, replace the `it.each` table of `describe("microsoftAuthErrorFor")` with:

```ts
  it.each([
    [400, { error: "invalid_grant" }, "not-connected"],
    [400, { error: "interaction_required" }, "not-connected"],
    [400, { error: "invalid_client" }, "not-configured"],
    [400, { error: "unauthorized_client" }, "not-configured"],
    [401, { error: "invalid_client" }, "not-configured"],
    [401, {}, "permission-denied"],
    // Graph refusing the account lookup is a refusal, as Graph's 403 is everywhere else (PR 1 review).
    [403, {}, "permission-denied"],
    [403, { error: { code: "accessDenied", message: "x" } }, "permission-denied"],
    [429, {}, "rate-limited"],
    [500, {}, "offline"],
    [503, "not json", "offline"],
    // Microsoft answered, so the connection is fine: a refusal it did not name is not "offline".
    [400, { error: "invalid_request" }, "unknown"],
    [400, "not json", "unknown"],
    [404, { error: { code: "itemNotFound" } }, "unknown"],
  ])("%i %j is %s", (status, body, reason) => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @trypthos/domain -- oneDrive microsoftAuth`
Expected: FAIL - `oneDrive.test.ts` cannot resolve `./oneDrive`; in `microsoftAuth.test.ts` the two `403` rows expect `permission-denied` and receive `unknown`.

- [ ] **Step 3: Write the module**

```ts
// packages/domain/src/oneDrive.ts
import { z } from "zod";

/// Reading OneDrive, the pure half: personal accounts, through Microsoft Graph.
///
/// The shell owns the requests, the token and the pre-authenticated download addresses; this owns
/// every Graph address the shell asks, every shape it accepts, what a refusal means, and what a
/// folder's listing shows in the tree and in the picker. See docs/specs/onedrive-workspace.md.

export const GRAPH_API = "https://graph.microsoft.com/v1.0";

/// The fields every item request asks for. `remoteItem` is how a folder shared with the user shows,
/// in Shared with me and in their own drive alike; its id and drive are the real ones.
const ITEM_FIELDS = "id,name,size,folder,file,eTag,cTag,webUrl,parentReference,remoteItem";
/// One page of a listing. Further pages are followed through `@odata.nextLink`.
const PAGE_SIZE = 200;

export const ONEDRIVE_MY_DRIVE_URL = `${GRAPH_API}/me/drive?$select=id,driveType`;

/// Every drive and item id this app sends back to Graph is this alphabet: a personal drive id is hex,
/// an item id is `<drive>!<number>`, and the root has the alias `root`. An id that is not is refused
/// before it reaches an address - from settings, from the renderer, from anywhere.
const ONEDRIVE_ID_PATTERN = /^[A-Za-z0-9!._-]{1,256}$/;

export function isOneDriveId(value: string): boolean {
  return ONEDRIVE_ID_PATTERN.test(value);
}

export const OneDriveIdSchema = z.string().regex(ONEDRIVE_ID_PATTERN);

/// Whether two drive ids name the same drive. Case-insensitive: Graph does not promise one spelling
/// of a personal drive id across endpoints, and a false "another account" would lock the user out of
/// their own folder. Used for the account check only - a workspace's key is not folded.
export function sameOneDriveId(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

/// A facet Graph sends as an object whose contents this app does not read: its presence is the fact.
const FacetSchema = z.object({});
const ParentSchema = z.object({ driveId: z.string().optional() });

export const OneDriveItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /// Bytes. A folder has one too - the sum of what is in it.
  size: z.number().int().nonnegative().optional(),
  eTag: z.string().optional(),
  /// Changes on a content write and not on a rename: the revision. The root has none.
  cTag: z.string().optional(),
  webUrl: z.string().optional(),
  folder: FacetSchema.optional(),
  file: z.object({ mimeType: z.string().optional() }).optional(),
  parentReference: ParentSchema.optional(),
  /// Present when the item stands for one in another drive: a folder shared with the user.
  remoteItem: z
    .object({
      id: z.string().min(1),
      folder: FacetSchema.optional(),
      parentReference: ParentSchema.optional(),
    })
    .optional(),
});

export type OneDriveItem = z.infer<typeof OneDriveItemSchema>;

export const OneDrivePageSchema = z.object({
  value: z.array(OneDriveItemSchema),
  "@odata.nextLink": z.string().optional(),
});

export const OneDriveDriveSchema = z.object({ id: z.string().min(1), driveType: z.string().optional() });

const GraphErrorSchema = z.object({ error: z.object({ code: z.string() }) });

/// The code in Graph's error body, or null when there is no body Graph would have written.
export function graphErrorCode(body: unknown): string | null {
  const parsed = GraphErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}

/// A workspace path as Graph's path syntax takes it: every segment encoded on its own, so a `#`, `?`
/// or `%` in a name can neither end the path nor start a query, and joined by the `/` it was split on.
function encodedPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/// An item by its id. The ids are encoded too, though `isOneDriveId` has already kept them to an
/// alphabet that needs none - the address does not rely on every caller having checked.
export function oneDriveItemUrl(driveId: string, itemId: string): string {
  return `${GRAPH_API}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
}

/// An item by its path below another item: the workspace's own root is `path` "", addressed by id.
export function oneDrivePathUrl(driveId: string, itemId: string, path: string): string {
  const item = oneDriveItemUrl(driveId, itemId);
  return path === "" ? item : `${item}:/${encodedPath(path)}:`;
}

export function oneDriveMetaUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDrivePathUrl(driveId, itemId, path)}?$select=${ITEM_FIELDS}`;
}

export function oneDriveChildrenUrl(driveId: string, itemId: string, path: string): string {
  return `${oneDrivePathUrl(driveId, itemId, path)}/children?$top=${PAGE_SIZE}&$select=${ITEM_FIELDS}`;
}

/// A file's content. Graph answers 302 to a pre-authenticated address; the shell asks without
/// following it, so the token never travels to another host.
export function oneDriveContentUrl(driveId: string, itemId: string): string {
  return `${oneDriveItemUrl(driveId, itemId)}/content`;
}

export function oneDriveSharedWithMeUrl(): string {
  return `${GRAPH_API}/me/drive/sharedWithMe`;
}

/// Whether an address is Graph's own: https, Graph's host exactly, the v1.0 API. A next page's
/// address comes from Graph's answer, and the token goes with it.
export function isGraphUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "graph.microsoft.com" && url.pathname.startsWith("/v1.0/");
  } catch {
    return false;
  }
}

/// Whether an address is https - what a download address or a web page must be before the shell
/// fetches it or hands it to the browser.
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type OneDriveFailure =
  | "not-connected"
  | "permission-denied"
  | "not-found"
  | "exists"
  | "conflict"
  | "too-large"
  | "rate-limited"
  | "offline"
  | "unknown";

/// What a refusal from Graph means to the user: the spec's error table, one mapping shared by the
/// client and the provider. A 4xx Graph does not name is `unknown` - Graph answered, so "check your
/// connection" would send the user to the wrong place - and only a 5xx reads as `offline`.
export function oneDriveFailure(status: number, code: string | null): OneDriveFailure {
  if (status === 401) return "not-connected";
  if (status === 403) return "permission-denied";
  if (status === 404) return "not-found";
  if (status === 409) return code === "nameAlreadyExists" ? "exists" : "conflict";
  if (status === 412) return "conflict";
  if (status === 413) return "too-large";
  if (status === 429 || status === 503) return "rate-limited";
  if (status >= 400 && status < 500) return "unknown";
  return "offline";
}

export const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

/// How long to wait before the one retry after a 429 or 503: what `Retry-After` asks in seconds, never
/// more than ten, and a second when it asks in a form this does not read (a date, or nothing).
export function retryAfterMs(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!/^\d+$/.test(value)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}

/// Whether a 206's `Content-Range` is exactly the inclusive range asked for. Anything else would be
/// played as the wrong part of the file.
export function contentRangeMatches(header: string | null, start: number, end: number): boolean {
  if (header === null) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header.trim());
  return match !== null && Number(match[1]) === start && Number(match[2]) === end;
}

export interface OneDriveEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly itemId: string;
  readonly cTag: string | null;
  readonly sizeBytes: number | null;
}

/// A name a path can carry as one segment. OneDrive forbids most of these already; the check is here
/// so the tree never depends on that.
function usableName(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- a control character cannot be part of a path segment.
  return name !== "" && name !== "." && name !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(name);
}

function compare(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/// **The one function that decides what a folder's listing shows in the tree.**
///
/// Files and folders only - a notebook is neither - and never a remote item, which lives in another
/// drive that a path below this one cannot reach. Folders first, then names, case-insensitively.
/// OneDrive refuses two names in one folder that differ only in case, so no suffix is ever needed.
export function oneDriveEntriesOf(items: readonly OneDriveItem[]): OneDriveEntry[] {
  return items
    .filter(
      (item) => item.remoteItem === undefined && (item.folder !== undefined || item.file !== undefined) && usableName(item.name),
    )
    .map(
      (item): OneDriveEntry => ({
        name: item.name,
        kind: item.folder !== undefined ? "directory" : "file",
        itemId: item.id,
        cTag: item.cTag ?? null,
        sizeBytes: item.size ?? null,
      }),
    )
    .sort((one, other) =>
      one.kind === other.kind
        ? compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name)
        : one.kind === "directory"
          ? -1
          : 1,
    );
}

export interface OneDriveFolder {
  readonly driveId: string;
  readonly itemId: string;
  readonly name: string;
  readonly shared: boolean;
}

/// The folders in a listing, for the picker: a drive's own folders (when `driveId` names the drive
/// listed), and every shared folder, addressed in the drive it really lives in. Shared with me has no
/// drive of its own, so it is listed with `driveId` null. Ids that could not be sent back are dropped.
export function oneDriveFoldersOf(items: readonly OneDriveItem[], driveId: string | null): OneDriveFolder[] {
  const folders: OneDriveFolder[] = [];
  for (const item of items) {
    const remote = item.remoteItem;
    if (remote !== undefined) {
      const owner = remote.parentReference?.driveId;
      if (remote.folder !== undefined && owner !== undefined && isOneDriveId(owner) && isOneDriveId(remote.id)) {
        folders.push({ driveId: owner, itemId: remote.id, name: item.name, shared: true });
      }
      continue;
    }
    if (item.folder !== undefined && driveId !== null && isOneDriveId(item.id)) {
      folders.push({ driveId, itemId: item.id, name: item.name, shared: false });
    }
  }
  return folders.sort((one, other) => compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name));
}
```

In `packages/domain/src/index.ts`, after the `./googleDrive` block (`export type { DriveEntry, DriveFailure, DriveFile } from "./googleDrive";`):

```ts
export {
  GRAPH_API,
  MAX_RETRY_AFTER_MS,
  ONEDRIVE_MY_DRIVE_URL,
  OneDriveDriveSchema,
  OneDriveIdSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveEntriesOf,
  oneDriveFailure,
  oneDriveFoldersOf,
  oneDriveItemUrl,
  oneDriveMetaUrl,
  oneDrivePathUrl,
  oneDriveSharedWithMeUrl,
  retryAfterMs,
  sameOneDriveId,
} from "./oneDrive";
export type { OneDriveEntry, OneDriveFailure, OneDriveFolder, OneDriveItem } from "./oneDrive";
```

In `packages/domain/src/microsoftAuth.ts`, replace the comment and the two status lines of `microsoftAuthErrorFor`:

```ts
/// What a refusal from the token endpoint or `/me` means to the user.
///
/// A 403 is `permission-denied`, as Graph's 403 is for a file (PR 1 review). Any other 4xx it does
/// not name is `unknown`, not `offline`: Microsoft answered, so telling the user to check their
/// connection would send them to the wrong place. A 5xx still reads as `offline`.
export function microsoftAuthErrorFor(status: number, body: unknown): MicrosoftAuthFailure {
  const parsed = MicrosoftErrorBodySchema.safeParse(body);
  if (parsed.success) {
    if (parsed.data.error === "invalid_grant" || parsed.data.error === "interaction_required") return "not-connected";
    if (parsed.data.error === "invalid_client" || parsed.data.error === "unauthorized_client") return "not-configured";
  }
  if (status === 401 || status === 403) return "permission-denied";
  if (status === 429) return "rate-limited";
  if (status >= 400 && status < 500) return "unknown";
  return "offline";
}
```

- [ ] **Step 4: Note the review finding in the spec's error table**

In `docs/specs/onedrive-workspace.md`, "Error handling", replace the row
`| 403 \`accessDenied\` | \`permission-denied\` (e.g. saving into a view-only shared folder) |`
with these two rows (keep the rest of the table as it is):

```markdown
| 403, any code - on a file, a folder, or the account lookup at `/me` | `permission-denied` (e.g. saving into a view-only shared folder) |
| Any other 4xx Graph or the token endpoint does not name, `/me` included | `unknown` - Microsoft answered, so never `offline` (PR 1 review) |
```

Then run the strict-UTF-8 check from the Global Constraints on `docs/specs/onedrive-workspace.md`.

- [ ] **Step 5: Run the domain suite**

Run: `npm test --workspace @trypthos/domain`
Expected: PASS, no stderr. Then `npm run typecheck` - PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/oneDrive.ts packages/domain/src/oneDrive.test.ts packages/domain/src/index.ts packages/domain/src/microsoftAuth.ts packages/domain/src/microsoftAuth.test.ts docs/specs/onedrive-workspace.md
git commit -m "Domain: OneDrive addresses, shapes and failures; Graph's 403 at /me is permission-denied" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shell - `oneDriveApi.js`, the Graph reads (and the cancelled sign-in's generation bump, pinned)

**Files:**
- Modify: `apps/desktop/test/microsoftAuth.test.js` (PR 1 review - one test, appended)
- Create: `apps/desktop/src/oneDriveApi.js`
- Create: `apps/desktop/test/oneDriveApi.test.js`

**Interfaces:**
- Consumes: Task 1's `ONEDRIVE_MY_DRIVE_URL`, `OneDriveDriveSchema`, `OneDriveItemSchema`, `OneDrivePageSchema`, `contentRangeMatches`, `graphErrorCode`, `isGraphUrl`, `isHttpsUrl`, `isOneDriveId`, `oneDriveChildrenUrl`, `oneDriveContentUrl`, `oneDriveFailure`, `oneDriveMetaUrl`, `oneDriveSharedWithMeUrl`, `retryAfterMs`. PR 1's `accessToken({ force })` -> `{ ok: true, token } | { ok: false, reason }`.
- Produces:

```js
createOneDriveApi({ accessToken, fetch, logger, timeoutMs = 30_000, sleep }) => {
  drive(): Promise<{ ok: true, drive: { id, driveType? } } | Failure>,
  children(driveId, itemId, path): Promise<{ ok: true, items: OneDriveItem[] } | Failure>,
  item(driveId, itemId, path): Promise<{ ok: true, item: OneDriveItem } | Failure>,
  sharedWithMe(): Promise<{ ok: true, items: OneDriveItem[] } | Failure>,
  downloadLocation(driveId, itemId): Promise<{ ok: true, url } | Failure>,
  download(driveId, itemId, limitBytes): Promise<{ ok: true, bytes: Buffer } | { ok: false, reason: "too-large", sizeBytes, limitBytes } | Failure>,
  rangeFrom(url, start, end, { signal }?): Promise<{ ok: true, status: 200 | 206, body } | { ok: false, reason: "expired" | "unsatisfiable" | ... }>,
}
```

- [ ] **Step 1: Pin the cancelled sign-in's generation bump (PR 1 review)**

Append to `apps/desktop/test/microsoftAuth.test.js` (it uses the file's own `gatedAccounts`, `twoAccountMicrosoft`, `harness` and `tick`):

```js
// PR 1 review: the cancelled sign-in's own generation bump, pinned on its own. The refresh starts
// while the sign-in's SAVE is held, so its read is queued behind the save and reads the token the
// cancelled sign-in stored; the DELETE is held too, so the refresh's rotation is ready to save the
// moment the delete lands. Only the bump before that delete stops the save. The step after this one
// removes the bump and watches this fail.
test("a refresh that read a cancelled sign-in's token cannot store its rotation after the delete", async () => {
  const accounts = gatedAccounts();
  const save = accounts.hold("set");
  const removal = accounts.hold("delete");
  const h = harness({ accounts, microsoft: twoAccountMicrosoft() });

  const connecting = h.instance.connect();
  await save.reached;
  const refreshing = h.instance.accessToken(); // queued behind the save: it will read Grace's token
  h.instance.cancelConnect();
  save.release();
  await removal.reached;
  for (let i = 0; i < 10; i += 1) await tick();
  removal.release();

  assert.deepEqual(await connecting, { ok: false, reason: "cancelled" });
  await refreshing;
  for (let i = 0; i < 10; i += 1) await tick();
  assert.equal(accounts.tokens.has("onedrive"), false);
});
```

- [ ] **Step 2: Watch it fail without the bump, then put the bump back**

In `apps/desktop/src/microsoftAuth.js`, inside `connect()`, in the block that begins `if (mine.reason !== undefined) {` after the save, comment out the one line `generation += 1;` inside its `safelyExclusive("delete", ...)` callback.
Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/microsoftAuth.test.js`
Expected: FAIL - only the new test: `accounts.tokens.has("onedrive")` is `true` (the rotated `refresh-grace-2` was stored after the delete).
Restore the line exactly as it was, run the same command, expected: PASS.

- [ ] **Step 3: Commit the review item on its own**

```bash
git add apps/desktop/test/microsoftAuth.test.js
git commit -m "microsoftAuth: pin the cancelled sign-in's generation bump with its own test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing client tests**

```js
// apps/desktop/test/oneDriveApi.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOneDriveApi } = require("../src/oneDriveApi");

/// The OneDrive reads against a fake fetch. What is under test is the request: the token on every
/// Graph request and never on a pre-authenticated address, the one retry after a 401 and the one
/// after a 429 or 503, the paging, the schema check, the ranged-read rule, and that nothing throws
/// or logs an address, an id or a token.

const ACCESS = "access-invented-onedrive-api";
const DRIVE = "d0c0ffee";
const PRESIGNED = "https://download.invented.example/presigned-onedrive-api";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const redirect = (location = PRESIGNED) => new Response(null, { status: 302, headers: { Location: location } });

const PLAN = { id: "ITEM!1", name: "Plan.md", size: 5, eTag: "etag-1", cTag: "ctag-1", file: { mimeType: "text/markdown" } };
const ARCHIVE = { id: "ITEM!2", name: "Archive", folder: { childCount: 1 } };

function setup({ routes = [], tokens = [{ ok: true, token: ACCESS }], timeoutMs } = {}) {
  const calls = [];
  const tokenCalls = [];
  const logs = [];
  const slept = [];
  let tokenIndex = 0;
  const api = createOneDriveApi({
    timeoutMs,
    accessToken: async (options = {}) => {
      tokenCalls.push(options);
      const next = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return next;
    },
    fetch: async (url, init) => {
      calls.push({ url, init, authorization: init.headers?.Authorization ?? null });
      const route = routes.shift();
      if (route === undefined) throw new Error(`no route for call ${calls.length}`);
      return typeof route === "function" ? route(url, init) : route;
    },
    logger: { error: (line) => logs.push(String(line)), info: (line) => logs.push(String(line)) },
    sleep: async (ms) => void slept.push(ms),
  });
  return { api, calls, tokenCalls, logs, slept };
}

test("asks which drive is the connected account's, with the token", async () => {
  const { api, calls } = setup({ routes: [json(200, { id: DRIVE, driveType: "personal" })] });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE, driveType: "personal" } });
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType");
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("reads one item by its path below the workspace root", async () => {
  const { api, calls } = setup({ routes: [json(200, PLAN)] });
  const answer = await api.item(DRIVE, "root", "Notes/Plan.md");
  assert.equal(answer.ok, true);
  assert.equal(answer.item.cTag, "ctag-1");
  assert.ok(calls[0].url.startsWith("https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes/Plan.md:?$select="));
});

test("lists a folder by path, following every page Graph names on Graph", async () => {
  const next = "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children?$skiptoken=p2";
  const { api, calls } = setup({ routes: [json(200, { value: [PLAN], "@odata.nextLink": next }), json(200, { value: [ARCHIVE] })] });
  const listed = await api.children(DRIVE, "root", "Notes");
  assert.deepEqual(listed.items.map((item) => item.id), ["ITEM!1", "ITEM!2"]);
  assert.ok(calls[0].url.startsWith("https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/root:/Notes:/children?$top=200&"));
  assert.equal(calls[1].url, next);
  assert.ok(calls.every((call) => call.authorization === `Bearer ${ACCESS}`));
});

// The next page's address comes from the answer, and the token would go with it.
test("refuses a next page that is not on Graph, and sends it nothing", async () => {
  const { api, calls, logs } = setup({ routes: [json(200, { value: [PLAN], "@odata.nextLink": "https://elsewhere.example/steal" })] });
  assert.deepEqual(await api.children(DRIVE, "root", ""), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 1);
  assert.equal(logs.join(" ").includes("elsewhere"), false);
});

test("lists what is shared with the user, across pages", async () => {
  const shared = (n) => ({ id: `S!${n}`, name: `Shared ${n}`, remoteItem: { id: `SHARED!${n}`, folder: {}, parentReference: { driveId: "beefcafe" } } });
  const { api, calls } = setup({
    routes: [
      json(200, { value: [shared(1)], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$skiptoken=2" }),
      json(200, { value: [shared(2)] }),
    ],
  });
  const answer = await api.sharedWithMe();
  assert.deepEqual(answer.items.map((item) => item.remoteItem.id), ["SHARED!1", "SHARED!2"]);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/me/drive/sharedWithMe");
});

test("refuses an id that is not a OneDrive id, without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.children("../x", "root", ""), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.item(DRIVE, "a/b", ""), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.downloadLocation(DRIVE, "a?b"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.download(DRIVE, "a#b", 10), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

test("an expired token is refreshed once and the request repeated", async () => {
  const { api, calls, tokenCalls } = setup({
    routes: [json(401, { error: { code: "InvalidAuthenticationToken" } }), json(200, { id: DRIVE })],
    tokens: [{ ok: true, token: "access-old" }, { ok: true, token: ACCESS }],
  });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE } });
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.equal(calls[1].authorization, `Bearer ${ACCESS}`);
});

test("a second 401 is not connected, and no third request is made", async () => {
  const { api, calls } = setup({ routes: [json(401, {}), json(401, {})] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 2);
});

test("no token is not connected, with no request", async () => {
  const { api, calls } = setup({ tokens: [{ ok: false, reason: "not-connected" }] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
});

test("a rate limit waits what Retry-After asks, at most ten seconds, then retries once", async () => {
  const { api, slept } = setup({
    routes: [json(429, { error: { code: "activityLimitReached" } }, { "Retry-After": "60" }), json(200, { id: DRIVE })],
  });
  assert.deepEqual(await api.drive(), { ok: true, drive: { id: DRIVE } });
  assert.deepEqual(slept, [10_000]);
});

test("a 503 that does not clear is rate-limited after one wait", async () => {
  const { api, slept, calls } = setup({ routes: [json(503, {}, { "Retry-After": "2" }), json(503, {})] });
  assert.deepEqual(await api.drive(), { ok: false, reason: "rate-limited" });
  assert.deepEqual(slept, [2_000]);
  assert.equal(calls.length, 2);
});

test("Graph's refusals are named through oneDriveFailure", async () => {
  const { api } = setup({
    routes: [json(403, { error: { code: "accessDenied" } }), json(404, { error: { code: "itemNotFound" } }), json(400, { error: { code: "invalidRequest" } })],
  });
  assert.deepEqual(await api.item(DRIVE, "root", "Plan.md"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(await api.item(DRIVE, "root", "Gone.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.children(DRIVE, "root", "x"), { ok: false, reason: "unknown" });
});

test("an answer in a shape this build does not know is offline, logged without the address", async () => {
  const { api, logs } = setup({ routes: [json(200, { value: "nope" })] });
  assert.deepEqual(await api.children(DRIVE, "root", "Notes"), { ok: false, reason: "offline" });
  assert.deepEqual(logs, ["OneDrive answered in a shape this build does not recognise."]);
});

test("an unreachable Graph is offline, logged by its code alone", async () => {
  const { api, logs } = setup({
    routes: [(url) => { throw Object.assign(new Error(`connect failed for ${url}`), { code: "ECONNRESET" }); }],
  });
  assert.deepEqual(await api.drive(), { ok: false, reason: "offline" });
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ECONNRESET"]);
});

test("headers that never arrive answer offline, and the request is aborted", async () => {
  let aborted = false;
  const { api, logs } = setup({
    timeoutMs: 10,
    routes: [(url, init) => new Promise(() => init.signal.addEventListener("abort", () => (aborted = true)))],
  });
  assert.deepEqual(await api.drive(), { ok: false, reason: "offline" });
  assert.equal(aborted, true);
  assert.deepEqual(logs, ["A request to OneDrive did not complete: ETIMEDOUT"]);
});

// The spec: the 302 is never followed with the Authorization header.
test("the download address is the 302's, asked for without following it", async () => {
  const { api, calls } = setup({ routes: [redirect()] });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: true, url: PRESIGNED });
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/drives/d0c0ffee/items/ITEM!1/content");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
});

test("a download answer with no address, or one that is not https, is refused", async () => {
  const { api } = setup({ routes: [redirect("http://download.invented.example/x"), new Response("bytes", { status: 200 })] });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: false, reason: "unknown" });
  assert.deepEqual(await api.downloadLocation(DRIVE, "ITEM!1"), { ok: false, reason: "unknown" });
});

test("downloads from the pre-authenticated address with no token on the request", async () => {
  const { api, calls } = setup({ routes: [redirect(), new Response("hello", { status: 200 })] });
  const answer = await api.download(DRIVE, "ITEM!1", 100);
  assert.equal(answer.ok, true);
  assert.equal(answer.bytes.toString("utf8"), "hello");
  assert.equal(calls[1].url, PRESIGNED);
  assert.equal(calls[1].authorization, null);
  assert.equal("Authorization" in calls[1].init.headers, false);
});

test("a download over the limit is too large, by the length it declares or by what arrives", async () => {
  const { api } = setup({
    routes: [redirect(), new Response("hello", { status: 200, headers: { "Content-Length": "5" } }), redirect(), new Response("hello", { status: 200 })],
  });
  assert.deepEqual(await api.download(DRIVE, "ITEM!1", 4), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 4 });
  assert.deepEqual(await api.download(DRIVE, "ITEM!1", 4), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 4 });
});

test("a range is asked of the address with no token, and a 206 for exactly that range is accepted", async () => {
  const { api, calls } = setup({ routes: [new Response("56789", { status: 206, headers: { "Content-Range": "bytes 5-9/20" } })] });
  const range = await api.rangeFrom(PRESIGNED, 5, 9);
  assert.equal(range.ok, true);
  assert.equal(range.status, 206);
  assert.equal(await new Response(range.body).text(), "56789");
  assert.equal(calls[0].init.headers.Range, "bytes=5-9");
  assert.equal(calls[0].authorization, null);
});

test("a 206 for other bytes than were asked is refused, and its body released", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const { api } = setup({ routes: [new Response(body, { status: 206, headers: { "Content-Range": "bytes 0-4/20" } })] });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 5, 9), { ok: false, reason: "offline" });
  assert.equal(cancelled, true);
});

test("a 200 answers a range only from the start", async () => {
  const { api } = setup({ routes: [new Response("0123456789", { status: 200 }), new Response("0123456789", { status: 200 })] });
  const whole = await api.rangeFrom(PRESIGNED, 0, 9);
  assert.equal(whole.ok, true);
  assert.equal(whole.status, 200);
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 5, 9), { ok: false, reason: "offline" });
});

test("a refused address has expired; a range past the end is unsatisfiable", async () => {
  const { api } = setup({ routes: [new Response(null, { status: 403 }), new Response(null, { status: 401 }), new Response(null, { status: 416 })] });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1), { ok: false, reason: "expired" });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1), { ok: false, reason: "expired" });
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 90, 99), { ok: false, reason: "unsatisfiable" });
});

test("an address that is not https is never fetched", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.rangeFrom("http://download.invented.example/x", 0, 1), { ok: false, reason: "unknown" });
  assert.equal(calls.length, 0);
});

test("the deadline covers the headers only, not a body that arrives after it", async () => {
  const { api } = setup({
    timeoutMs: 20,
    routes: [
      (url, init) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
            setTimeout(() => {
              try {
                controller.enqueue(new TextEncoder().encode("late"));
                controller.close();
              } catch {
                // Errored by an abort: the assertion below says so.
              }
            }, 60);
          },
        });
        return new Response(body, { status: 206, headers: { "Content-Range": "bytes 0-3/4" } });
      },
    ],
  });
  const range = await api.rangeFrom(PRESIGNED, 0, 3);
  assert.equal(range.ok, true);
  assert.equal(await new Response(range.body).text(), "late");
});

test("a range the window gives up on before its headers is aborted and answers at once", async () => {
  let fetchAborted = false;
  const controller = new AbortController();
  const { api } = setup({
    timeoutMs: 60_000,
    routes: [
      (url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () => {
            fetchAborted = true;
            reject(init.signal.reason);
          }),
        ),
    ],
  });
  const pending = api.rangeFrom(PRESIGNED, 0, 1, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { ok: false, reason: "offline" });
  assert.equal(fetchAborted, true);
});

test("a range asked for under a signal already aborted asks nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const { api, calls } = setup();
  assert.deepEqual(await api.rangeFrom(PRESIGNED, 0, 1, { signal: controller.signal }), { ok: false, reason: "offline" });
  assert.equal(calls.length, 0);
});

test("no log line holds an address, an id, a path, the token or an error's message", async () => {
  const fail = (url) => {
    throw Object.assign(new Error(`connect failed for ${url}`), { code: "ECONNRESET" });
  };
  const { api, logs } = setup({
    routes: [
      fail,
      redirect("http://insecure.example/ITEM!1"),
      fail,
      json(200, { value: [], "@odata.nextLink": "https://elsewhere.example/Notes/next" }),
    ],
  });
  await api.item(DRIVE, "ITEM!1", "Notes/Plan.md");
  await api.downloadLocation(DRIVE, "ITEM!1");
  await api.rangeFrom(PRESIGNED, 0, 1);
  await api.children(DRIVE, "root", "Notes");
  assert.equal(logs.length, 4);
  const text = logs.join(" ");
  for (const secret of [ACCESS, PRESIGNED, "ITEM!1", DRIVE, "Notes", "insecure.example", "elsewhere.example", "connect failed"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.ok(text.includes("ECONNRESET"));
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveApi.test.js`
Expected: FAIL - `Cannot find module '../src/oneDriveApi'`.

- [ ] **Step 6: Write the client**

```js
// apps/desktop/src/oneDriveApi.js
"use strict";

const {
  ONEDRIVE_MY_DRIVE_URL,
  OneDriveDriveSchema,
  OneDriveItemSchema,
  OneDrivePageSchema,
  contentRangeMatches,
  graphErrorCode,
  isGraphUrl,
  isHttpsUrl,
  isOneDriveId,
  oneDriveChildrenUrl,
  oneDriveContentUrl,
  oneDriveFailure,
  oneDriveMetaUrl,
  oneDriveSharedWithMeUrl,
  retryAfterMs,
} = require("@trypthos/domain");

/// The calls to OneDrive (Microsoft Graph), read side, and nothing else. PR 3 adds the writes.
///
/// **Main process only.** The access token comes from `microsoftAuth.js` and never leaves this
/// process; neither does a pre-authenticated download address, which is a credential in all but name
/// for as long as it lives. Addresses, schemas and what a status means are in the domain's
/// `oneDrive.ts`; what is here is the request, the token, the retries, and turning exceptions into
/// results.
///
/// **Nothing here throws outward**, and no log line carries an address (it holds a path, an id or a
/// signature), a token or an error's message - only what failed and an error code.

const DEFAULT_TIMEOUT_MS = 30_000;
/// A bound on effort, as Drive's: 50 pages of 200 is far past what a tree can usefully show.
const MAX_PAGES = 50;

function failure(reason) {
  return { ok: false, reason };
}

function createOneDriveApi({
  accessToken,
  fetch = globalThis.fetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  function codeOf(error) {
    return error?.code ?? error?.name ?? "error";
  }

  /// One attempt under the deadline. `work(signal)` makes the request and reads what it needs, and is
  /// raced against the deadline as well as aborted by it: a fake, or a stalled socket, may never
  /// settle. `outer` is the caller's own signal - the window's request for a range - and aborting it
  /// aborts the request at once. Once `work` has answered the deadline stands down, so a body that is
  /// streamed afterwards is never cut off by it. Answers what `work` answered, or null.
  async function deadlined(work, outer = null) {
    const controller = new AbortController();
    let timer;
    let onAbort = null;
    const stop = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
        controller.abort(error);
        reject(error);
      }, timeoutMs);
      if (outer !== null) {
        onAbort = () => {
          const error = Object.assign(new Error("aborted"), { name: "AbortError", abandoned: true });
          controller.abort(error);
          reject(error);
        };
        outer.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      return await Promise.race([work(controller.signal), stop]);
    } catch (error) {
      // A caller that gave up is not a failure worth an error line; it is logged quietly, by its code.
      if (error?.abandoned === true) logger.info?.(`A request to OneDrive was abandoned: ${codeOf(error)}`);
      else logger.error?.(`A request to OneDrive did not complete: ${codeOf(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
      if (onAbort !== null) outer.removeEventListener("abort", onAbort);
    }
  }

  async function tokenFrom(options) {
    try {
      return await accessToken(options);
    } catch (error) {
      logger.error?.(`The OneDrive access token could not be obtained: ${codeOf(error)}`);
      return failure("not-connected");
    }
  }

  /// One Graph request with the token. At most one retry after a 401, with a token refreshed for it,
  /// and one after a 429 or 503, waiting what `Retry-After` asks up to ten seconds. `read(response)`
  /// makes the value of an answer below 400 - a 302 included, for a caller that asked not to follow
  /// one. Answers `{ ok: true, value }` or a failure.
  async function send(url, read, { redirect = "follow" } = {}) {
    let token = await tokenFrom();
    if (!token.ok) return token;

    let refreshed = false;
    let waited = false;
    for (;;) {
      const bearer = token.token;
      const got = await deadlined(async (signal) => {
        const response = await fetch(url, { method: "GET", signal, redirect, headers: { Authorization: `Bearer ${bearer}` } });
        if (response.status < 400) return { response, value: await read(response) };
        return { response, value: await response.json().catch(() => null) };
      });
      if (got === null) return failure("offline");
      const { response } = got;
      if (response.status < 400) return { ok: true, value: got.value };

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await tokenFrom({ force: true });
        if (!token.ok) return token;
        continue;
      }
      const reason = oneDriveFailure(response.status, graphErrorCode(got.value));
      if (reason === "rate-limited" && !waited) {
        waited = true;
        await sleep(retryAfterMs(response.headers?.get("retry-after") ?? null));
        continue;
      }
      return failure(reason);
    }
  }

  async function getJson(url, schema) {
    const got = await send(url, (response) => response.json());
    if (!got.ok) return got;
    const parsed = schema.safeParse(got.value);
    if (!parsed.success) {
      logger.error?.("OneDrive answered in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, value: parsed.data };
  }

  /// Every page of a listing, following `@odata.nextLink`. The next address comes from Graph's answer
  /// and the token goes with it, so one that is not on Graph is refused rather than followed.
  async function allPages(first) {
    const items = [];
    let url = first;
    for (let page = 0; page < MAX_PAGES && url !== null; page += 1) {
      const answer = await getJson(url, OneDrivePageSchema);
      if (!answer.ok) return answer;
      items.push(...answer.value.value);
      const next = answer.value["@odata.nextLink"] ?? null;
      if (next !== null && !isGraphUrl(next)) {
        logger.error?.("OneDrive named a next page somewhere other than Graph; it was not followed.");
        return failure("unknown");
      }
      url = next;
    }
    return { ok: true, items };
  }

  const ids = (...values) => values.every((value) => typeof value === "string" && isOneDriveId(value));

  async function drive() {
    const answer = await getJson(ONEDRIVE_MY_DRIVE_URL, OneDriveDriveSchema);
    return answer.ok ? { ok: true, drive: answer.value } : answer;
  }

  /// A folder's children, every page, by its path below `itemId` ("" is `itemId` itself).
  async function children(driveId, itemId, path) {
    if (!ids(driveId, itemId)) return failure("not-found");
    return allPages(oneDriveChildrenUrl(driveId, itemId, path));
  }

  async function item(driveId, itemId, path) {
    if (!ids(driveId, itemId)) return failure("not-found");
    const answer = await getJson(oneDriveMetaUrl(driveId, itemId, path), OneDriveItemSchema);
    return answer.ok ? { ok: true, item: answer.value } : answer;
  }

  async function sharedWithMe() {
    return allPages(oneDriveSharedWithMeUrl());
  }

  /// Where a file's bytes can be fetched from: the address Graph's 302 names, asked for WITHOUT
  /// following it, so the token never travels to another host. The address is pre-authenticated and
  /// short-lived, and it never leaves this process.
  async function downloadLocation(driveId, itemId) {
    if (!ids(driveId, itemId)) return failure("not-found");
    const got = await send(
      oneDriveContentUrl(driveId, itemId),
      async (response) => {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        return response.status >= 300 ? location : null;
      },
      { redirect: "manual" },
    );
    if (!got.ok) return got;
    if (typeof got.value !== "string" || !isHttpsUrl(got.value)) {
      logger.error?.("OneDrive answered a download without an address this build can use.");
      return failure("unknown");
    }
    return { ok: true, url: got.value };
  }

  /// A file's bytes, refused above `limitBytes` by the length the answer declares or, failing that, by
  /// what arrived. Fetched from the pre-authenticated address with no token at all.
  async function download(driveId, itemId, limitBytes) {
    const where = await downloadLocation(driveId, itemId);
    if (!where.ok) return where;
    const got = await deadlined(async (signal) => {
      const response = await fetch(where.url, { method: "GET", signal, headers: {} });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { status: response.status };
      }
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > limitBytes) {
        await response.body?.cancel().catch(() => {});
        return { status: response.status, tooLarge: declared };
      }
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    });
    if (got === null) return failure("offline");
    if (got.tooLarge !== undefined) return { ok: false, reason: "too-large", sizeBytes: got.tooLarge, limitBytes };
    if (got.bytes === undefined) return failure(oneDriveFailure(got.status, null));
    if (got.bytes.length > limitBytes) return { ok: false, reason: "too-large", sizeBytes: got.bytes.length, limitBytes };
    return { ok: true, bytes: got.bytes };
  }

  /// Bytes `start` to `end` (inclusive) from a pre-authenticated address, as the response's own stream
  /// and unread: the caller pulls it as a player plays. No token goes with it. The deadline covers the
  /// headers only, and `signal` - the window's request - aborts it at once.
  ///
  /// Accepted: a 206 whose `Content-Range` is exactly the range asked for, or a 200 for a range that
  /// starts at 0 (the provider checks that it is the whole file). Anything else is released and
  /// refused. A 401 or 403 is the address having expired, which the provider answers by asking once
  /// for a new one.
  async function rangeFrom(url, start, end, { signal } = {}) {
    if (!isHttpsUrl(url)) return failure("unknown");
    if (signal?.aborted) return failure("offline");
    const response = await deadlined(
      (inner) => fetch(url, { method: "GET", signal: inner, headers: { Range: `bytes=${start}-${end}` } }),
      signal ?? null,
    );
    if (response === null) return failure("offline");
    if (response.status === 206 && contentRangeMatches(response.headers.get("content-range"), start, end)) {
      return { ok: true, status: 206, body: response.body };
    }
    if (response.status === 200 && start === 0) return { ok: true, status: 200, body: response.body };
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) return failure("expired");
    if (response.status === 416) return failure("unsatisfiable");
    if (response.ok) {
      logger.error?.("OneDrive answered a range with other bytes than were asked for.");
      return failure("offline");
    }
    return failure(oneDriveFailure(response.status, null));
  }

  return { drive, children, item, sharedWithMe, downloadLocation, download, rangeFrom };
}

module.exports = { createOneDriveApi };
```

- [ ] **Step 7: Run the client tests and the shell suite**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveApi.test.js`
Expected: PASS, no stderr.
Run: `npm test --workspace trypthos-desktop`
Expected: PASS (`domainExports.test.js` sees the new imports exported).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/oneDriveApi.js apps/desktop/test/oneDriveApi.test.js
git commit -m "Shell: the OneDrive Graph reads, with downloads that never carry the token" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shell - `oneDriveWorkspace.js`, the provider and its opener

**Files:**
- Create: `apps/desktop/src/oneDriveWorkspace.js`
- Create: `apps/desktop/test/oneDriveWorkspace.test.js`

**Interfaces:**
- Consumes: Task 1's `MAX_TEXT_FILE_BYTES` (existing), `createPathGuard` (existing), `decodeTextFile` (existing), `isHttpsUrl`, `oneDriveEntriesOf`, `sameOneDriveId`; Task 2's client (`drive`, `item`, `children`, `download`, `downloadLocation`, `rangeFrom`).
- Produces:

```js
GUARD_ROOT = "/onedrive"
openOneDriveWorkspace({ ref, api, now?, ttlMs? }) =>
  Promise<{ ok: true, name: string, provider } | { ok: false, reason: "other-account" | "not-found" | ... }>
provider = {
  id: ref.itemId, kind: "onedrive",
  list(path) -> { ok, nodes: { id, name, kind }[] },
  listKnown(path) -> { ok, nodes, complete: boolean },
  read(path) -> { ok: true, content, revision: { id: cTag }, readOnly: true } | failure,
  readBytes(path, limitBytes) -> { ok: true, bytes } | failure,
  mediaSource(path) -> { ok: true, size, open(start, end, signal) -> { ok: true, body } | failure } | failure,
  write() -> { ok: false, reason: "read-only" },
  webAddress(path) -> { ok: true, url } | failure,
  refresh() -> { ok: true, truncated: false },
}
```

`ref` is `{ kind: "onedrive", driveId, itemId, shared?: true, name }` (the schema arrives in Task 4; the provider takes it as data).

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/test/oneDriveWorkspace.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_TEXT_FILE_BYTES } = require("@trypthos/domain");
const { openOneDriveWorkspace, GUARD_ROOT } = require("../src/oneDriveWorkspace");

/// A OneDrive folder as a workspace, over a fake OneDrive client.
///
/// OneDrive is addressed by path, so there is no id map to test. What is under test: the guard runs
/// before any request; a read's revision is the content tag asked for fresh; a listing is kept for its
/// TTL and dropped by refresh; media streams from a pre-authenticated address that is fetched again
/// once when it has expired; nothing is ever written; and an own-drive folder is never opened under
/// another account.

const MINE = "d0c0ffee";
const REF = { kind: "onedrive", driveId: MINE, itemId: "ROOT!0", name: "Notes then" };

/// The drive, by path below the workspace's root ("" is the root itself).
const TREE = {
  "": { id: "ROOT!0", name: "Notes now", folder: {}, webUrl: "https://onedrive.live.com/?id=ROOT!0" },
  "Plan.md": { id: "ITEM!1", name: "Plan.md", size: 5, cTag: "ctag-1", file: {}, webUrl: "https://onedrive.live.com/?id=ITEM!1" },
  Archive: { id: "ITEM!2", name: "Archive", folder: {} },
  "Archive/Old.md": { id: "ITEM!3", name: "Old.md", size: 3, cTag: "ctag-3", file: {} },
  "clip.mp4": { id: "ITEM!4", name: "clip.mp4", size: 10, cTag: "ctag-4", file: {} },
  "huge.md": { id: "ITEM!5", name: "huge.md", size: 17 * 1024 * 1024, cTag: "ctag-5", file: {} },
};

const BYTES = { "ITEM!1": Buffer.from("hello"), "ITEM!3": Buffer.from("old") };

function childrenOf(items, path) {
  const prefix = path === "" ? "" : `${path}/`;
  return Object.entries(items)
    .filter(([key]) => key !== "" && key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([, item]) => ({ ...item }));
}

function fakeApi({ myDrive = MINE, items = TREE, rangeFrom = null } = {}) {
  const calls = [];
  let issued = 0;
  const api = {
    drive: async () => {
      calls.push(["drive"]);
      return { ok: true, drive: { id: myDrive } };
    },
    item: async (driveId, itemId, path) => {
      calls.push(["item", driveId, itemId, path]);
      return items[path] === undefined ? { ok: false, reason: "not-found" } : { ok: true, item: { ...items[path] } };
    },
    children: async (driveId, itemId, path) => {
      calls.push(["children", driveId, itemId, path]);
      return items[path]?.folder === undefined ? { ok: false, reason: "not-found" } : { ok: true, items: childrenOf(items, path) };
    },
    download: async (driveId, itemId, limitBytes) => {
      calls.push(["download", driveId, itemId, limitBytes]);
      return BYTES[itemId] === undefined ? { ok: false, reason: "not-found" } : { ok: true, bytes: BYTES[itemId] };
    },
    downloadLocation: async (driveId, itemId) => {
      calls.push(["location", driveId, itemId]);
      issued += 1;
      return { ok: true, url: `https://download.invented.example/${itemId}/${issued}` };
    },
    rangeFrom: async (url, start, end, options) => {
      calls.push(["range", url, start, end]);
      if (rangeFrom !== null) return rangeFrom(url, start, end, options);
      return { ok: true, status: 206, body: new Response(Buffer.from("0123456789").subarray(start, end + 1)).body };
    },
  };
  return { api, calls };
}

async function open({ ref = REF, now, ...options } = {}) {
  const { api, calls } = fakeApi(options);
  const opened = await openOneDriveWorkspace({ ref, api, ...(now === undefined ? {} : { now }) });
  return { opened, provider: opened.ok ? opened.provider : null, calls };
}

test("guards a root of its own, which exists nowhere", () => {
  assert.equal(GUARD_ROOT, "/onedrive");
});

test("opens an own-drive folder under its current name, having checked whose drive it is", async () => {
  const { opened, calls } = await open();
  assert.equal(opened.ok, true);
  assert.equal(opened.name, "Notes now");
  assert.equal(opened.provider.kind, "onedrive");
  assert.equal(opened.provider.id, "ROOT!0");
  assert.deepEqual(calls, [["drive"], ["item", MINE, "ROOT!0", ""]]);
});

test("opens My files under the name it was chosen by, since Graph calls the root 'root'", async () => {
  const { opened } = await open({
    ref: { kind: "onedrive", driveId: MINE, itemId: "root", name: "My files" },
    items: { ...TREE, "": { ...TREE[""], name: "root" } },
  });
  assert.equal(opened.name, "My files");
});

test("an own-drive folder is other-account under a different account, and nothing else is asked", async () => {
  const { opened, calls } = await open({ myDrive: "beefcafe" });
  assert.deepEqual(opened, { ok: false, reason: "other-account" });
  assert.deepEqual(calls, [["drive"]]);
});

test("compares the drive ids without regard to case", async () => {
  assert.equal((await open({ myDrive: "D0C0FFEE" })).opened.ok, true);
});

// Its driveId is someone else's by design.
test("a folder shared with the user is not checked against the connected drive", async () => {
  const { opened, calls } = await open({ ref: { ...REF, driveId: "beefcafe", shared: true } });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls, [["item", "beefcafe", "ROOT!0", ""]]);
});

test("a root that is not a folder, or not there, does not open", async () => {
  assert.deepEqual((await open({ items: { ...TREE, "": { id: "ROOT!0", name: "x.md", file: {} } } })).opened, {
    ok: false,
    reason: "not-found",
  });
  assert.deepEqual((await open({ items: {} })).opened, { ok: false, reason: "not-found" });
});

test("a failure asking whose drive it is is passed on", async () => {
  const { api } = fakeApi();
  api.drive = async () => ({ ok: false, reason: "offline" });
  assert.deepEqual(await openOneDriveWorkspace({ ref: REF, api }), { ok: false, reason: "offline" });
});

test("lists the root and a folder by path, folders first, then names whatever the case", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.list(""), {
    ok: true,
    nodes: [
      { id: "Archive", name: "Archive", kind: "directory" },
      { id: "clip.mp4", name: "clip.mp4", kind: "file" },
      { id: "huge.md", name: "huge.md", kind: "file" },
      { id: "Plan.md", name: "Plan.md", kind: "file" },
    ],
  });
  assert.deepEqual(await provider.list("Archive"), { ok: true, nodes: [{ id: "Archive/Old.md", name: "Old.md", kind: "file" }] });
  assert.deepEqual(
    calls.filter((call) => call[0] === "children"),
    [
      ["children", MINE, "ROOT!0", ""],
      ["children", MINE, "ROOT!0", "Archive"],
    ],
  );
});

test("keeps a listing for its TTL, asks again after it, and refresh drops it", async () => {
  let clock = 0;
  const { provider, calls } = await open({ now: () => clock });
  const listings = () => calls.filter((call) => call[0] === "children").length;
  await provider.list("");
  await provider.list("");
  assert.equal(listings(), 1);
  clock += 61_000;
  await provider.list("");
  assert.equal(listings(), 2);
  assert.deepEqual(await provider.refresh(), { ok: true, truncated: false });
  await provider.list("");
  assert.equal(listings(), 3);
});

test("two walks of one folder at once ask OneDrive once", async () => {
  const { provider, calls } = await open();
  await Promise.all([provider.list("Archive"), provider.list("Archive")]);
  assert.equal(calls.filter((call) => call[0] === "children").length, 1);
});

test("answers what is already listed without asking, and says when a folder never was", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
  await provider.list("");
  const before = calls.length;
  const known = await provider.listKnown("");
  assert.equal(known.complete, true);
  assert.equal(known.nodes.length, 4);
  assert.equal(calls.length, before);
  await provider.refresh();
  assert.deepEqual(await provider.listKnown(""), { ok: true, nodes: [], complete: false });
});

// The workspace boundary. Every escape is refused by the shared guard before any request is made.
test("refuses a path that leaves the workspace, before asking OneDrive anything", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  for (const escape of ["../outside.md", "Archive/../../outside.md", "/etc/passwd", "C:/Windows/win.ini", "C:outside.md", "\\\\server\\share\\x.md"]) {
    for (const answer of [
      provider.list(escape),
      provider.listKnown(escape),
      provider.read(escape),
      provider.readBytes(escape, 10),
      provider.mediaSource(escape),
      provider.webAddress(escape),
    ]) {
      assert.deepEqual(await answer, { ok: false, reason: "permission-denied" }, escape);
    }
  }
  assert.equal(calls.length, before);
});

test("reads a file read-only, its revision the content tag asked for before the bytes", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "ctag-1" }, readOnly: true });
  assert.deepEqual(calls.slice(before), [
    ["item", MINE, "ROOT!0", "Plan.md"],
    ["download", MINE, "ITEM!1", MAX_TEXT_FILE_BYTES],
  ]);
});

test("a folder is not a file, a missing file is not found, and a file with no content tag is not read", async () => {
  const { provider } = await open({ items: { ...TREE, "untagged.md": { id: "ITEM!9", name: "untagged.md", size: 1, file: {} } } });
  assert.deepEqual(await provider.read("Archive"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Missing.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("untagged.md"), { ok: false, reason: "unknown" });
  assert.deepEqual(await provider.read(""), { ok: false, reason: "permission-denied" });
});

test("a file larger than a text file may be is refused by its size, with nothing downloaded", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.read("huge.md"), {
    ok: false,
    reason: "too-large",
    sizeBytes: 17 * 1024 * 1024,
    limitBytes: MAX_TEXT_FILE_BYTES,
  });
  assert.equal(calls.some((call) => call[0] === "download"), false);
});

test("reads a file's bytes under the limit it is given", async () => {
  const { provider } = await open();
  const read = await provider.readBytes("Archive/Old.md", 10);
  assert.equal(read.ok, true);
  assert.equal(read.bytes.toString("utf8"), "old");
  assert.deepEqual(await provider.readBytes("Plan.md", 2), { ok: false, reason: "too-large", sizeBytes: 5, limitBytes: 2 });
});

test("writes nothing: a save in this release answers read-only, asking OneDrive nothing", async () => {
  const { provider, calls } = await open();
  const before = calls.length;
  assert.deepEqual(await provider.write("Plan.md", "changed", { id: "ctag-1" }), { ok: false, reason: "read-only" });
  assert.deepEqual(await provider.write("New.md", "made", null), { ok: false, reason: "read-only" });
  assert.equal(calls.length, before);
  // New File, New Folder and rename are PR 3: their IPC gates answer unsupported without the methods.
  assert.equal(provider.createDirectory, undefined);
  assert.equal(provider.rename, undefined);
});

test("streams a clip in ranges from one pre-authenticated address, its size from the listing", async () => {
  const { provider, calls } = await open();
  const media = await provider.mediaSource("clip.mp4");
  assert.equal(media.ok, true);
  assert.equal(media.size, 10);
  assert.equal(await new Response((await media.open(5, 9)).body).text(), "56789");
  assert.equal(await new Response((await media.open(0, 1)).body).text(), "01");
  assert.deepEqual(calls.filter((call) => call[0] === "location"), [["location", MINE, "ITEM!4"]]);
});

test("an expired address is fetched again once, and a second refusal is permission-denied", async () => {
  let refusals = 1;
  const rangeFrom = async (url, start, end) => {
    if (refusals > 0) {
      refusals -= 1;
      return { ok: false, reason: "expired" };
    }
    return { ok: true, status: 206, body: new Response(Buffer.from("0123456789").subarray(start, end + 1)).body };
  };
  const { provider, calls } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  assert.equal(await new Response((await media.open(2, 3)).body).text(), "23");
  assert.equal(calls.filter((call) => call[0] === "location").length, 2);

  refusals = 2;
  assert.deepEqual(await media.open(2, 3), { ok: false, reason: "permission-denied" });
  assert.equal(calls.filter((call) => call[0] === "location").length, 3);
});

test("a whole-file answer is accepted only for a whole-file range", async () => {
  const rangeFrom = async () => ({ ok: true, status: 200, body: new Response(Buffer.from("0123456789")).body });
  const { provider } = await open({ rangeFrom });
  const media = await provider.mediaSource("clip.mp4");
  assert.deepEqual(await media.open(0, 4), { ok: false, reason: "offline" });
  assert.equal(await new Response((await media.open(0, 9)).body).text(), "0123456789");
});

test("a folder, a missing file or a file with no size has no media source", async () => {
  const { provider } = await open({ items: { ...TREE, "unsized.mp4": { id: "ITEM!8", name: "unsized.mp4", file: {} } } });
  assert.deepEqual(await provider.mediaSource("Archive"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.mediaSource("gone.mp4"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.mediaSource("unsized.mp4"), { ok: false, reason: "not-found" });
});

test("refresh forgets the download addresses with the listings", async () => {
  const { provider, calls } = await open();
  await (await provider.mediaSource("clip.mp4")).open(0, 1);
  await provider.refresh();
  await (await provider.mediaSource("clip.mp4")).open(0, 1);
  assert.equal(calls.filter((call) => call[0] === "location").length, 2);
});

test("names an entry's page on the web, and the workspace's own, but never a non-https one", async () => {
  const { provider } = await open({ items: { ...TREE, "odd.md": { id: "ITEM!7", name: "odd.md", file: {}, webUrl: "javascript:alert(1)" } } });
  assert.deepEqual(await provider.webAddress(""), { ok: true, url: "https://onedrive.live.com/?id=ROOT!0" });
  assert.deepEqual(await provider.webAddress("Plan.md"), { ok: true, url: "https://onedrive.live.com/?id=ITEM!1" });
  assert.deepEqual(await provider.webAddress("odd.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.webAddress("gone.md"), { ok: false, reason: "not-found" });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveWorkspace.test.js`
Expected: FAIL - `Cannot find module '../src/oneDriveWorkspace'`.

- [ ] **Step 3: Write the provider**

```js
// apps/desktop/src/oneDriveWorkspace.js
"use strict";

const {
  MAX_TEXT_FILE_BYTES,
  createPathGuard,
  decodeTextFile,
  isHttpsUrl,
  oneDriveEntriesOf,
  sameOneDriveId,
} = require("@trypthos/domain");

/// A OneDrive folder, as a workspace. Read-only in this release: saving, New File, New Folder and
/// rename are PR 3 (docs/specs/onedrive-workspace.md).
///
/// OneDrive addresses an item by its path below another and refuses two names in one folder, so -
/// unlike Google Drive - there is no map from paths to ids, no duplicate-name suffix and no re-keying.
/// Every request names its item by the workspace root's id plus the workspace-relative path, after the
/// shared path guard has resolved that path over a root that exists nowhere (GitHub's `/repo`, Drive's
/// `/drive`): `..`, absolute, drive-qualified and UNC paths are refused here exactly as they are for a
/// folder on disk, before anything is asked of Graph.
///
/// A read asks for the item's content tag BEFORE its bytes, so the revision the editor holds is never
/// newer than what it read. Media streams from the pre-authenticated address Graph's 302 names, kept
/// per file until it expires; neither it nor the token ever leaves the main process.

const GUARD_ROOT = "/onedrive";

/// How long a folder's listing is trusted, as Drive's: the filter, Find in Files and the chat's
/// outline all walk the tree through `list`.
const LISTING_TTL_MS = 60_000;

function failure(reason) {
  return { ok: false, reason };
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

function createOneDriveProvider({ ref, api, now = Date.now, ttlMs = LISTING_TTL_MS }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });

  /// The workspace-relative form of a candidate path, "" for the root, or null when it escapes.
  function relativePath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// Workspace path -> `{ at, generation, entries }` of that folder's last successful listing.
  const listings = new Map();
  /// Workspace path -> `{ generation, promise }` for the listing in flight, so concurrent walks of one
  /// folder ask Graph once.
  const inFlight = new Map();
  /// Item id -> the pre-authenticated address its bytes were last fetched from.
  const locations = new Map();
  /// Bumped by `refresh()`. A listing begun under an older generation is never cached or joined.
  let generation = 0;

  async function entriesOf(path) {
    const cached = listings.get(path);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, entries: cached.entries };
    }
    const joined = inFlight.get(path);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.children(ref.driveId, ref.itemId, path);
        if (!listed.ok) return listed;
        const entries = oneDriveEntriesOf(listed.items);
        if (started === generation) listings.set(path, { at: now(), generation: started, entries });
        return { ok: true, entries };
      } finally {
        if (inFlight.get(path) === pending) inFlight.delete(path);
      }
    })();
    inFlight.set(path, pending);
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
    /// is false for a folder nobody has opened since the last refresh.
    async listKnown(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const known = listings.get(path);
      if (known === undefined || known.generation !== generation) return { ok: true, nodes: [], complete: false };
      return { ok: true, nodes: known.entries.map((entry) => treeNode(path, entry)), complete: true };
    },

    /// Read-only in this release: the shell says so per file, and the editor offers no save.
    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      // The content tag is the revision a save in PR 3 presents with If-Match. A file without one has
      // nothing honest to hand the editor.
      if (typeof found.item.cTag !== "string") return failure("unknown");
      const fetched = await bytesOf(found.item, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      return { ok: true, content: decoded.content, revision: { id: found.item.cTag }, readOnly: true };
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
            where = await locate(true);
            if (!where.ok) return where;
            ranged = await api.rangeFrom(where.url, start, end, { signal });
          }
          // Refused twice in a row, straight after a new address was issued: not an expiry.
          if (!ranged.ok) return failure(ranged.reason === "expired" ? "permission-denied" : ranged.reason);
          // A 200 is the whole file: only a correct answer to a range that IS the whole file. For any
          // other, the protocol would label the full body a 206 of the wrong length.
          if (ranged.status === 200 && end !== size - 1) {
            await ranged.body?.cancel().catch(() => {});
            return failure("offline");
          }
          return { ok: true, body: ranged.body };
        },
      };
    },

    /// Nothing is written to OneDrive in this release. `file:write`, Save As and the chat's
    /// create-file tool all call this, so it exists and refuses, as Drive's did in its PR 2.
    async write() {
      return failure("read-only");
    },

    /// Where an entry lives on the web, for Open in OneDrive: the item's own `webUrl`, and only an
    /// https one. It stays in the main process: the shell opens it, the renderer never sees it.
    async webAddress(candidate) {
      const path = relativePath(candidate);
      if (path === null) return failure("permission-denied");
      const meta = await api.item(ref.driveId, ref.itemId, path);
      if (!meta.ok) return meta;
      const url = meta.item.webUrl;
      return typeof url === "string" && isHttpsUrl(url) ? { ok: true, url } : failure("not-found");
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

- [ ] **Step 4: Run the provider tests and the shell suite**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveWorkspace.test.js`
Expected: PASS, no stderr.
Run: `npm test --workspace trypthos-desktop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/oneDriveWorkspace.js apps/desktop/test/oneDriveWorkspace.test.js
git commit -m "Shell: a OneDrive folder as a read-only workspace, addressed by path behind the guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `onedrive` workspace kind, end to end

**Files:**
- Modify: `packages/domain/src/workspaceRef.ts`, `packages/domain/src/workspaceRef.test.ts`
- Modify: `packages/domain/src/settings.ts`, `packages/domain/src/settings.test.ts`
- Modify: `packages/domain/src/index.ts` (`OneDriveWorkspaceRefSchema` beside `GoogleDriveWorkspaceRefSchema`)
- Modify: `apps/desktop/src/providers.js`, `apps/desktop/test/providers.test.js`
- Modify: `apps/desktop/src/ipcHandlers.js` (`createOneDrive` dependency, `providerDeps.oneDrive`)
- Modify: `apps/desktop/src/main.js`
- Modify: `apps/desktop/test/oneDriveIpc.test.js`
- Modify: `apps/app/src/components/SourceGlyph.tsx`, `apps/app/src/index.css`, `apps/app/src/lib/theme.browser.test.tsx`
- Modify: `apps/app/src/components/WorkspaceHome.tsx`, `apps/app/src/components/WorkspaceHome.test.tsx`
- Modify: `apps/app/src/components/WorkspacePanel.test.tsx` (the row's mark)
- Modify: `apps/app/src/locales/en.json` (`home.kindOneDrive`)

**Interfaces:**
- Consumes: Task 1's `OneDriveIdSchema`; Task 2's `createOneDriveApi`; Task 3's `openOneDriveWorkspace`.
- Produces:
  - `OneDriveWorkspaceRefSchema` - `{ kind: "onedrive"; driveId: string; itemId: string; shared?: true; name: string }`, strict; `ProviderKind` gains `"onedrive"`; `PROVIDER_KINDS` is `["local", "github", "google-drive", "onedrive"]`.
  - `workspaceRefName` -> `name`; `workspaceRefKey` -> `onedrive:<driveId>:<itemId>`; `workspaceRefLabel` -> `OneDrive / <name>`; `workspaceRefMark` -> `"onedrive"`.
  - `SETTINGS_VERSION = 25`, a no-op migration `{ to: 25 }`.
  - `registerIpcHandlers({ ..., createOneDrive })` where `createOneDrive(accessToken) => oneDriveApi`; `providerDeps = { github, drive, oneDrive }`.
  - `PROVIDER_OPENERS.onedrive(ref, { oneDrive })`.
  - Renderer: `SourceGlyph mark="onedrive"` (`data-mark="onedrive"`), `sourceColour("onedrive") === "text-onedrive"`, token `--tp-onedrive` / utility `text-onedrive`.

- [ ] **Step 1: Write the failing domain tests**

In `packages/domain/src/workspaceRef.test.ts`, after `describe("a Google Drive folder", ...)`:

```ts
describe("a OneDrive folder", () => {
  const ref = { kind: "onedrive" as const, driveId: "d0c0ffee", itemId: "ITEM!3", name: "Notes" };

  it("parses, own or shared with the user", () => {
    expect(WorkspaceRefSchema.parse(ref)).toEqual(ref);
    const shared = { ...ref, driveId: "beefcafe", shared: true as const };
    expect(WorkspaceRefSchema.parse(shared)).toEqual(shared);
  });

  // Both ids reach a Graph address; the schema is the boundary that keeps them ids.
  it("refuses an id that is not a OneDrive id, a shared flag that is not true, and an unknown field", () => {
    expect(WorkspaceRefSchema.safeParse({ ...ref, itemId: "../x" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, driveId: "a/b" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, shared: false }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, name: "" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, extra: 1 }).success).toBe(false);
  });

  it("is named, keyed, labelled and marked as a OneDrive folder", () => {
    expect(workspaceRefName(ref)).toBe("Notes");
    expect(workspaceRefKey(ref)).toBe("onedrive:d0c0ffee:ITEM!3");
    expect(workspaceRefLabel(ref)).toBe("OneDrive / Notes");
    expect(workspaceRefMark(ref)).toBe("onedrive");
    expect(PROVIDER_KINDS).toContain("onedrive");
  });

  // Graph ids are case-sensitive, so the key is not folded. The name is only what it was called, and
  // whether it was shared is a fact about how it was reached, not which place it is.
  it("is the same workspace whatever it was called, and another one for another item", () => {
    expect(sameWorkspaceRef(ref, { ...ref, name: "Renamed" })).toBe(true);
    expect(sameWorkspaceRef(ref, { ...ref, shared: true as const })).toBe(true);
    expect(sameWorkspaceRef(ref, { ...ref, itemId: "item!3" })).toBe(false);
  });
});
```

In `packages/domain/src/settings.test.ts`, in `describe("version 24")`, replace the two lines

```ts
    expect(SETTINGS_VERSION).toBe(24);
    expect(loaded.schemaVersion).toBe(24);
```

with

```ts
    expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(24);
    expect(loaded.schemaVersion).toBe(SETTINGS_VERSION);
```

and append:

```ts
describe("version 25", () => {
  it("remembers a OneDrive folder, own or shared", () => {
    const mine = { kind: "onedrive" as const, driveId: "d0c0ffee", itemId: "root", name: "My files" };
    const shared = { kind: "onedrive" as const, driveId: "beefcafe", itemId: "SHARED!7", shared: true as const, name: "Joint" };
    expect(loadSettings({ ...DEFAULT_SETTINGS, workspaces: [mine, shared] }).workspaces).toEqual([mine, shared]);
  });

  it("leaves workspaces remembered at version 24 exactly as they were", () => {
    const before = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 24,
      workspaces: [
        { kind: "google-drive" as const, folderId: "root", rootId: "0ARealRootId", name: "My Drive" },
        { kind: "local" as const, root: "/v/Notes" },
      ],
    };
    const loaded = loadSettings(before);
    expect(SETTINGS_VERSION).toBe(25);
    expect(loaded.schemaVersion).toBe(25);
    expect(loaded.workspaces).toEqual(before.workspaces);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @trypthos/domain -- workspaceRef settings`
Expected: FAIL - the OneDrive ref does not parse (`invalid_union_discriminator`), and `SETTINGS_VERSION` is 24.

- [ ] **Step 3: Implement the domain half**

`packages/domain/src/workspaceRef.ts` - add the import beside the Drive one:

```ts
import { OneDriveIdSchema } from "./oneDrive";
```

after `GoogleDriveWorkspaceRefSchema`:

```ts
export const OneDriveWorkspaceRefSchema = z
  .object({
    kind: z.literal("onedrive"),
    /// The drive the folder lives in: the connected account's own, or - for a folder shared with the
    /// user - its owner's.
    driveId: OneDriveIdSchema,
    /// The folder's item id, or the alias `root` for My files.
    itemId: OneDriveIdSchema,
    /// Present when the folder was shared with the user. Its `driveId` is someone else's by design, so
    /// it is not checked against the connected account; an own-drive folder is, and answers
    /// `other-account` under a different one. Not part of `workspaceRefKey`.
    shared: z.literal(true).optional(),
    /// What the folder was called when it was chosen. Display only, as Drive's.
    name: z.string().min(1),
  })
  .strict();
```

the union and the list:

```ts
export const WorkspaceRefSchema = z.discriminatedUnion("kind", [
  LocalWorkspaceRefSchema,
  GitHubWorkspaceRefSchema,
  GoogleDriveWorkspaceRefSchema,
  OneDriveWorkspaceRefSchema,
]);
```

```ts
export const PROVIDER_KINDS = ["local", "github", "google-drive", "onedrive"] as const satisfies readonly ProviderKind[];
```

and one case in each of the three switches:

```ts
// workspaceRefName, after the google-drive case:
    case "onedrive":
      return ref.name;
```

```ts
// workspaceRefKey, after the google-drive case. Graph ids are case-sensitive, so neither is folded.
    case "onedrive":
      return `onedrive:${ref.driveId}:${ref.itemId}`;
```

```ts
// workspaceRefLabel, after the google-drive case:
    case "onedrive":
      return `OneDrive / ${ref.name}`;
```

`packages/domain/src/index.ts` - in the `./workspaceRef` export block, after `GoogleDriveWorkspaceRefSchema,`:

```ts
  OneDriveWorkspaceRefSchema,
```

`packages/domain/src/settings.ts` - `export const SETTINGS_VERSION = 25;` and, at the top of `SETTINGS_MIGRATIONS`:

```ts
  {
    to: 25,
    // Version 25 lets a remembered workspace be a OneDrive folder. Nothing already remembered changes.
    // The version is for the OTHER direction, as with 23: the reference is strict, so a file naming a
    // OneDrive folder, read by the previous build, would fail to parse and take every remembered
    // workspace with it - this makes that build refuse the file instead.
    migrate: (input) => input,
  },
```

Run: `npm test --workspace @trypthos/domain` - PASS.

- [ ] **Step 4: Write the failing shell tests**

In `apps/desktop/test/providers.test.js`, append:

```js
/// A OneDrive client that knows one drive and one folder.
function oneDriveClient(myDrive = "d0c0ffee") {
  return {
    drive: async () => ({ ok: true, drive: { id: myDrive } }),
    item: async (_driveId, itemId) => ({ ok: true, item: { id: itemId, name: "Notes now", folder: {} } }),
    children: async () => ({ ok: true, items: [] }),
  };
}

test("opens a OneDrive folder through the OneDrive client, under its current name", async () => {
  const opened = await openWorkspaceFor(
    { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!0", name: "Notes then" },
    { oneDrive: oneDriveClient() },
  );

  assert.equal(opened.ok, true);
  assert.equal(opened.workspace.name, "Notes now");
  assert.equal(opened.workspace.root, null);
  assert.equal(opened.workspace.guard, null);
  assert.equal(opened.workspace.vault, false);
  assert.equal(opened.workspace.provider.kind, "onedrive");
});

test("an own-drive OneDrive folder under another account answers other-account", async () => {
  assert.deepEqual(
    await openWorkspaceFor({ kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!0", name: "Notes" }, { oneDrive: oneDriveClient("beefcafe") }),
    { ok: false, reason: "other-account" },
  );
});

test("a OneDrive folder in a build without a Microsoft client answers not configured", async () => {
  assert.deepEqual(await openWorkspaceFor({ kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!0", name: "Notes" }, {}), {
    ok: false,
    reason: "not-configured",
  });
});
```

In `apps/desktop/test/oneDriveIpc.test.js`, replace `withHandlers` with this version (it adds `createOneDrive` and `openExternal`; the existing tests pass neither and are unchanged):

```js
async function withHandlers(body, { microsoft = "real", createOneDrive = null, openExternal } = {}) {
  const authLogged = [];
  const authLog = { error: (...args) => void authLogged.push(args.map(String).join(" ")) };
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-onedrive-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    const accounts = fakeAccounts();
    const auth = microsoft === "none" ? null : microsoftOver(accounts, authLog);
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts,
      microsoft: auth,
      createOneDrive,
      openExternal,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain, accounts, auth, authLogged });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}
```

and append:

```js
/// The OneDrive client factory, as `main.js` passes it: built over an access-token supplier. `seen`
/// records the supplier, so a test can check whose token it is.
function fakeOneDriveFactory({ myDrive = "d0c0ffee", seen = {} } = {}) {
  return (accessToken) => {
    seen.accessToken = accessToken;
    const plan = { id: "ITEM!1", name: "Plan.md", size: 5, cTag: "ctag-1", file: {}, webUrl: "https://onedrive.live.com/?id=ITEM!1" };
    return {
      drive: async () => ({ ok: true, drive: { id: myDrive } }),
      item: async (_driveId, itemId, filePath) => {
        if (filePath === "") return { ok: true, item: { id: itemId, name: "Notes now", folder: {} } };
        return filePath === "Plan.md" ? { ok: true, item: plan } : { ok: false, reason: "not-found" };
      },
      children: async (_driveId, _itemId, folderPath) => (folderPath === "" ? { ok: true, items: [plan] } : { ok: false, reason: "not-found" }),
      download: async () => ({ ok: true, bytes: Buffer.from("hello") }),
    };
  };
}

// Each test opens its own item id: the registry of open workspaces is module-level, so a reference an
// earlier test opened would answer the workspace already open rather than reaching the opener.
test("opens a OneDrive folder by reference and reads it read-only, like any other workspace", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const ref = { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!10", name: "Notes then" };
      const opened = await ipcMain.invoke("workspace:openRef", { ref });
      assert.equal(opened.ok, true);
      assert.equal(opened.workspace.name, "Notes now");
      assert.deepEqual(opened.workspace.ref, ref);
      assert.equal("driveVariant" in opened.workspace, false);

      const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
      assert.deepEqual(listed.nodes.map((node) => node.id), [`${opened.workspace.id}/Plan.md`]);

      const read = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/Plan.md` });
      assert.deepEqual(read, { ok: true, content: "hello", revision: { id: "ctag-1" }, readOnly: true });
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

test("a save into a OneDrive folder answers read-only in this release", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!11", name: "Notes" } });
      const written = await ipcMain.invoke("file:write", {
        path: `${opened.workspace.id}/Plan.md`,
        content: "changed",
        expectedRevision: { id: "ctag-1" },
        message: null,
      });
      assert.deepEqual(written, { ok: false, reason: "read-only" });
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

test("an own-drive folder of another Microsoft account is not opened under this one", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!12", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "other-account" });
    },
    { createOneDrive: fakeOneDriveFactory({ myDrive: "beefcafe" }) },
  );
});

test("a folder shared with the user lives in another drive by design, and opens", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const ref = { kind: "onedrive", driveId: "beefcafe", itemId: "SHARED!7", shared: true, name: "Joint" };
      const opened = await ipcMain.invoke("workspace:openRef", { ref });
      assert.equal(opened.ok, true);
      assert.deepEqual(opened.workspace.ref, ref);
    },
    { createOneDrive: fakeOneDriveFactory() },
  );
});

test("the OneDrive client is built over the Microsoft account's access token", async () => {
  const seen = {};
  await withHandlers(
    async () => {
      assert.equal(typeof seen.accessToken, "function");
      // Nothing is stored, so the account itself answers - through this supplier - that it is not connected.
      assert.deepEqual(await seen.accessToken(), { ok: false, reason: "not-connected" });
    },
    { createOneDrive: fakeOneDriveFactory({ seen }) },
  );
});

test("a build without a OneDrive client cannot open a OneDrive folder", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!13", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "not-configured" });
    },
    { microsoft: "none", createOneDrive: fakeOneDriveFactory() },
  );
});

test("Open in OneDrive shows the item's page in the browser, and answers no address", async () => {
  const shown = [];
  await withHandlers(
    async ({ ipcMain }) => {
      const workspace = (await ipcMain.invoke("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ROOT!14", name: "Notes" } })).workspace;
      assert.deepEqual(await ipcMain.invoke("workspace:reveal", { path: `${workspace.id}/Plan.md` }), { ok: true });
      assert.deepEqual(shown, ["https://onedrive.live.com/?id=ITEM!1"]);
    },
    { createOneDrive: fakeOneDriveFactory(), openExternal: async (url) => void shown.push(url) },
  );
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/providers.test.js apps/desktop/test/oneDriveIpc.test.js`
Expected: FAIL - "every provider kind the domain names can be opened" reports `["onedrive"]` missing; the OneDrive opens answer `unsupported`.

- [ ] **Step 6: Implement the shell half**

`apps/desktop/src/providers.js` - beside the Drive require:

```js
const { openOneDriveWorkspace } = require("./oneDriveWorkspace");
```

after `openGoogleDrive`:

```js
/// A OneDrive folder. Read through the OneDrive client the handlers built over the Microsoft account;
/// a build without a Microsoft client has none, which is "not configured", as for Google Drive. The
/// opener checks an own-drive reference against the connected account (`other-account`).
async function openOneDrive(ref, { oneDrive }) {
  if (!oneDrive) return { ok: false, reason: "not-configured" };
  const opened = await openOneDriveWorkspace({ ref, api: oneDrive });
  if (!opened.ok) return opened;
  return {
    ok: true,
    workspace: { ref, name: opened.name, root: null, guard: null, provider: opened.provider, vault: false },
  };
}
```

and the registry:

```js
const OPENERS = {
  local: openLocal,
  github: openGitHub,
  "google-drive": openGoogleDrive,
  onedrive: openOneDrive,
};
```

`apps/desktop/src/ipcHandlers.js` - in the destructured options of `registerIpcHandlers`, after `createGoogleDrive = null,`:

```js
  /// Builds the OneDrive client over an access-token supplier - `oneDriveApi.js` in the app. A
  /// factory, like `createGoogleDrive`, so a test can hand in a fake. No client without `microsoft`.
  createOneDrive = null,
```

and replace `const providerDeps = { github, drive };` with:

```js
  const oneDrive =
    microsoft === null || createOneDrive === null
      ? null
      : createOneDrive((options) => microsoft.accessToken(options));

  const providerDeps = { github, drive, oneDrive };
```

`apps/desktop/src/main.js` - beside `const { createGoogleDriveApi } = require("./googleDriveApi");`:

```js
const { createOneDriveApi } = require("./oneDriveApi");
```

and in the `registerIpcHandlers({ ... })` call, after `createGoogleDrive: ...,`:

```js
      // Every OneDrive call is made here, with the token microsoftAuth holds - net.fetch for the same
      // proxy and certificate reasons as GitHub and Drive.
      createOneDrive: (accessToken) =>
        createOneDriveApi({ accessToken, fetch: (url, options) => net.fetch(url, options) }),
```

Run: `npm test --workspace trypthos-desktop` - PASS, no stderr.

- [ ] **Step 7: Write the failing renderer tests**

`apps/app/src/components/WorkspacePanel.test.tsx`, after the test "marks a Google Drive folder with Drive's glyph and colour":

```tsx
  it("marks a OneDrive folder with OneDrive's glyph and colour, and names it as OneDrive's", () => {
    panel({
      workspaces: [
        {
          id: "Plans",
          name: "Plans",
          ref: { kind: "onedrive" as const, driveId: "d0c0ffee", itemId: "ITEM!3", name: "Plans" },
          truncated: false,
        },
      ],
    });
    const row = screen.getByRole("button", { name: "Plans" });
    const mark = [...row.querySelectorAll("svg")].at(-1);
    expect(mark?.getAttribute("data-mark")).toBe("onedrive");
    expect(mark?.getAttribute("class") ?? "").toContain("text-onedrive");
    expect(row.getAttribute("title")).toBe("OneDrive / Plans");
  });
```

`apps/app/src/components/WorkspaceHome.test.tsx`, inside `describe("a workspace's home page")`, after "says a vault is a vault":

```tsx
  it("says a OneDrive folder is one", () => {
    page({ workspace: { id: "Plans", name: "Plans", ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "ITEM!3", name: "Plans" } } });
    expect(screen.getByText("OneDrive folder - Plans")).toBeTruthy();
  });
```

`apps/app/src/lib/theme.browser.test.tsx`, in "defines every colour token in both themes", change the line `"--tp-leaf", "--tp-obsidian", "--tp-graph-dim", "--tp-graph-dim-edge",` to:

```ts
      "--tp-leaf", "--tp-obsidian", "--tp-drive", "--tp-onedrive", "--tp-graph-dim", "--tp-graph-dim-edge",
```

- [ ] **Step 8: Run them to verify they fail**

Run: `npm test --workspace trypthos-app -- WorkspacePanel WorkspaceHome` and `npm run typecheck`
Expected: FAIL - the OneDrive row's mark is missing (`sourceColour` has no `onedrive` case), the home line renders `Folder - undefined`, and typecheck reports `sourceColour` lacking a return for `"onedrive"` and `workspace.ref.root` not existing on the OneDrive ref in `WorkspaceHome.tsx`.
Run: `npm run test:browser --workspace trypthos-app -- theme` - FAIL: `--tp-onedrive` resolves to "" in both themes.

- [ ] **Step 9: Implement the renderer half**

`apps/app/src/components/SourceGlyph.tsx` - in `sourceColour`, after the `google-drive` case:

```tsx
    case "onedrive":
      return "text-onedrive";
```

and in `SourceGlyph`, after the `google-drive` case:

```tsx
    case "onedrive":
      // A cloud, drawn in the app's own outline style: a generic mark in OneDrive's blue, not
      // Microsoft's artwork.
      return (
        <Glyph className={className} mark="onedrive">
          <path d="M7 18h10.5a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 8.02 5 5 0 0 0 7 18Z" />
        </Glyph>
      );
```

`apps/app/src/index.css` - in the `@theme inline` block, after `--color-drive: var(--tp-drive);`:

```css
  --color-onedrive: var(--tp-onedrive);
```

after `--tp-drive: #1a73e8;` (the light block, two-space indent):

```css
  /* OneDrive blue: the mark on a OneDrive folder. */
  --tp-onedrive: #0364b8;
```

and after each of the two `--tp-drive: #8ab4f8;` lines (the media-query dark block at four spaces, the `[data-theme="dark"]` block at two), at the same indent:

```css
--tp-onedrive: #4fa3e8;
```

`apps/app/src/components/WorkspaceHome.tsx` - replace the kind line's expression:

```tsx
          {workspace.ref.kind === "github"
            ? t("home.kindRepository")
            : workspace.ref.kind === "google-drive"
              ? `${t("home.kindDrive")} - ${workspace.name}`
              : workspace.ref.kind === "onedrive"
                ? `${t("home.kindOneDrive")} - ${workspace.name}`
                : `${workspace.vault === true ? t("home.kindVault") : t("home.kindFolder")} - ${workspace.ref.root}`}
```

`apps/app/src/locales/en.json` - in `home`, after `"kindDrive": "Google Drive folder",`:

```json
    "kindOneDrive": "OneDrive folder",
```

Run the strict-UTF-8 check on `en.json`.

- [ ] **Step 10: Run everything this task touched**

Run: `npm run typecheck && npm test --workspace trypthos-app -- WorkspacePanel WorkspaceHome i18nKeys && npm run test:browser --workspace trypthos-app -- theme && npm test --workspace @trypthos/domain && npm test --workspace trypthos-desktop`
Expected: all PASS, no stderr.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/workspaceRef.ts packages/domain/src/workspaceRef.test.ts packages/domain/src/settings.ts packages/domain/src/settings.test.ts packages/domain/src/index.ts apps/desktop/src/providers.js apps/desktop/test/providers.test.js apps/desktop/src/ipcHandlers.js apps/desktop/src/main.js apps/desktop/test/oneDriveIpc.test.js apps/app/src/components/SourceGlyph.tsx apps/app/src/index.css apps/app/src/lib/theme.browser.test.tsx apps/app/src/components/WorkspaceHome.tsx apps/app/src/components/WorkspaceHome.test.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/locales/en.json
git commit -m "The onedrive workspace kind: settings 25, the opener with its account check, and its mark" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Renderer - OneDrive's words, Open in OneDrive, and what the tree offers

**Files:**
- Modify: `apps/app/src/hooks/useWorkspace.ts`, `apps/app/src/hooks/useWorkspace.test.ts`
- Modify: `apps/app/src/lib/cloudAccounts.ts`, `apps/app/src/lib/cloudAccounts.test.ts`
- Modify: `apps/app/src/lib/workspaceCapabilities.ts`
- Create: `apps/app/src/lib/workspaceCapabilities.test.ts`
- Modify: `apps/app/src/components/WorkspacePanel.tsx`, `apps/app/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/app/src/components/FindDialog.tsx`, `apps/app/src/components/FindDialog.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: Task 4's `"onedrive"` `ProviderKind`.
- Produces:
  - `providerFailureKey("onedrive", reason)` answers `errors.oneDriveOtherAccount`, `errors.oneDriveReadOnly`, `errors.oneDriveOffline`, `errors.oneDriveRateLimited`, `errors.oneDriveNotConnected`, `errors.oneDriveScopeDenied`, `errors.oneDriveTimedOut`, `errors.oneDriveNotConfigured`; everything else through `failureKey`.
  - `oneDriveFailureKey` is **removed** from `lib/cloudAccounts.ts`; `ONEDRIVE_ACCOUNT.failureKey` is `(reason) => providerFailureKey("onedrive", reason)`.
  - `opensInBrowser({ kind: "onedrive" }) === true`; `canEditTree({ kind: "onedrive" }) === false` (PR 3).
  - Keys: `workspace.openInOneDrive`, `workspace.searchPartialCloud` (replaces `workspace.searchPartialDrive`), `errors.oneDriveOtherAccount`, `errors.oneDriveReadOnly`.

- [ ] **Step 1: Write the failing tests**

`apps/app/src/hooks/useWorkspace.test.ts`, inside `describe("providerFailureKey")`:

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
    expect(providerFailureKey("onedrive", "read-only")).toBe("errors.oneDriveReadOnly");
    expect(providerFailureKey("onedrive", "permission-denied")).toBe(failureKey("permission-denied"));
    expect(providerFailureKey("onedrive", "unknown")).toBe("errors.unknown");
    expect(providerFailureKey("onedrive", "cancelled")).toBeNull();
  });
```

`apps/app/src/lib/cloudAccounts.test.ts` - change the import to

```ts
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT, cloudAccountKeys } from "./cloudAccounts";
```

and replace the whole `describe("oneDriveFailureKey", ...)` with:

```ts
describe("the OneDrive account's failures", () => {
  it.each([
    ["offline", "errors.oneDriveOffline"],
    ["rate-limited", "errors.oneDriveRateLimited"],
    ["not-connected", "errors.oneDriveNotConnected"],
    ["scope-denied", "errors.oneDriveScopeDenied"],
    ["timed-out", "errors.oneDriveTimedOut"],
    ["not-configured", "errors.oneDriveNotConfigured"],
    ["other-account", "errors.oneDriveOtherAccount"],
    ["read-only", "errors.oneDriveReadOnly"],
    // A failed code exchange answers this. The shared wording names no provider.
    ["unknown", "errors.unknown"],
  ])("answers %s with %s, which exists", (reason, key) => {
    expect(ONEDRIVE_ACCOUNT.failureKey(reason)).toBe(key);
    expect(typeof lookup(key)).toBe("string");
  });

  it("is not an error when the browser was closed", () => {
    expect(ONEDRIVE_ACCOUNT.failureKey("cancelled")).toBeNull();
  });
});
```

`apps/app/src/lib/workspaceCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canEditTree, opensInBrowser } from "./workspaceCapabilities";

describe("what the tree offers for each kind of workspace", () => {
  // OneDrive gains New File, New Folder and rename with its writes, in PR 3.
  it("edits the tree of a folder on disk and a Drive folder, and not yet a OneDrive folder", () => {
    expect(canEditTree({ kind: "local" })).toBe(true);
    expect(canEditTree({ kind: "google-drive" })).toBe(true);
    expect(canEditTree({ kind: "onedrive" })).toBe(false);
    expect(canEditTree({ kind: "github" })).toBe(false);
  });

  it("shows a Drive or OneDrive entry in the browser, and nothing else there", () => {
    expect(opensInBrowser({ kind: "google-drive" })).toBe(true);
    expect(opensInBrowser({ kind: "onedrive" })).toBe(true);
    expect(opensInBrowser({ kind: "local" })).toBe(false);
    expect(opensInBrowser({ kind: "github" })).toBe(false);
  });
});
```

`apps/app/src/components/WorkspacePanel.test.tsx` - inside `describe("the workspace menu")`, directly after `describe("in a Google Drive workspace", ...)`:

```tsx
  describe("in a OneDrive workspace", () => {
    const PLANS = {
      id: "Plans",
      name: "Plans",
      ref: { kind: "onedrive" as const, driveId: "d0c0ffee", itemId: "ITEM!3", name: "Plans" },
      truncated: false,
    };
    const folders = {
      Plans: {
        status: "loaded" as const,
        children: [
          { id: "Plans/ideas", name: "ideas", kind: "directory" as const },
          { id: "Plans/plan.md", name: "plan.md", kind: "file" as const },
        ],
      },
    };
    const items = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

    // Read-only in this release: nothing that would write, and an entry is shown on OneDrive's site.
    it("offers Open in OneDrive and Refresh on the workspace row, and nothing that writes", async () => {
      panel({ workspaces: [PLANS], folders, selectedFolder: "Plans" });
      await rightClick(screen.getByRole("button", { name: /^Plans$/ }));

      expect(items()).toEqual(["Open in OneDrive", "Refresh"]);
    });

    it("shows a file in OneDrive through the same handler as Reveal, and offers no rename", async () => {
      const onRevealEntry = vi.fn();
      panel({ workspaces: [PLANS], folders, onRevealEntry });
      const user = await rightClick(screen.getByRole("button", { name: /plan\.md/ }));

      expect(items()).not.toContain("Rename ...");
      expect(items()).not.toContain("Open in Google Drive");
      await user.click(screen.getByRole("menuitem", { name: "Open in OneDrive" }));

      expect(onRevealEntry).toHaveBeenCalledWith("Plans/plan.md");
    });
  });
```

and in the same file, in the test "says when only the opened Google Drive folders were searched, and not otherwise", rename it "says when only the opened cloud folders were searched" and change the expected text to `"Cloud folders are searched only where you have opened them."`.

`apps/app/src/components/FindDialog.test.tsx` - in "says when only the opened Google Drive folders were searched, even with no matches", rename it "says when only the opened cloud folders were searched, even with no matches" and change the expected text to `"Cloud folders are searched only where you have opened them."`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace trypthos-app -- useWorkspace cloudAccounts workspaceCapabilities WorkspacePanel FindDialog`
Expected: FAIL - `providerFailureKey("onedrive", "offline")` is `errors.offline`; `other-account` and `read-only` keys are missing for OneDrive; `opensInBrowser({ kind: "onedrive" })` is false, so the OneDrive menu has no Open entry; the partial-search line still names Google Drive.

- [ ] **Step 3: Implement**

`apps/app/src/hooks/useWorkspace.ts` - in `providerFailureKey`, after the `if (kind === "google-drive") { ... }` block:

```ts
  // OneDrive's own words: the shared keys for offline, rate-limited and not-connected name GitHub, and
  // the sign-in's scope-denied, timed-out and not-configured name Google.
  if (kind === "onedrive") {
    switch (reason) {
      case "other-account":
        return "errors.oneDriveOtherAccount";
      case "read-only":
        return "errors.oneDriveReadOnly";
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
```

and in its doc comment replace "which is the wrong provider for a Google Drive folder or the Google account" with "which is the wrong provider for a Google Drive or OneDrive folder, or for either account".

`apps/app/src/lib/cloudAccounts.ts` - change the first line to

```ts
import { providerFailureKey } from "../hooks/useWorkspace";
```

delete the whole `oneDriveFailureKey` function and its comment, and in `ONEDRIVE_ACCOUNT` set

```ts
  failureKey: (reason) => providerFailureKey("onedrive", reason),
```

`apps/app/src/lib/workspaceCapabilities.ts`:

```ts
import type { WorkspaceRef } from "@trypthos/domain";

/// Whether the tree can be edited from the browser: a new file, a new folder, a rename.
///
/// A folder on disk and a Drive folder both have a mutable place a name can be given; a GitHub
/// repository has none, because a save there is a commit. A OneDrive folder will, once its writes
/// land (PR 3) - until then it is read-only. The shell is still the one that refuses - this only
/// decides what the menu offers.
export function canEditTree(ref: Pick<WorkspaceRef, "kind">): boolean {
  return ref.kind === "local" || ref.kind === "google-drive";
}

/// Whether "show this entry where it lives" means opening it in a web page rather than in the file
/// manager: a Drive or OneDrive entry. The shell chooses between the two; the menu only has to word it.
export function opensInBrowser(ref: Pick<WorkspaceRef, "kind">): boolean {
  return ref.kind === "google-drive" || ref.kind === "onedrive";
}
```

`apps/app/src/components/WorkspacePanel.tsx` - replace the reveal entry's label expression:

```tsx
                  {inBrowser
                    ? menuWorkspace?.ref.kind === "onedrive"
                      ? t("workspace.openInOneDrive")
                      : t("workspace.openInDrive")
                    : platform === "darwin"
                      ? t("workspace.revealInFinder")
                      : t("workspace.revealInExplorer")}
```

and in the filter results, replace the partial line and its comment:

```tsx
            {/* A cloud folder is searched only where it has been opened, which the list cannot show by itself. */}
            {filterStatus.kind === "results" && filterStatus.partial === true && (
              <p className="px-2 py-1 text-xs text-ink-4">{t("workspace.searchPartialCloud")}</p>
            )}
```

`apps/app/src/components/FindDialog.tsx` - change `t("workspace.searchPartialDrive")` to `t("workspace.searchPartialCloud")`.

`apps/app/src/locales/en.json`:
- in `workspace`, replace `"searchPartialDrive": "Google Drive folders are searched only where you have opened them.",` with `"searchPartialCloud": "Cloud folders are searched only where you have opened them.",`
- in `workspace`, after `"openInDrive": "Open in Google Drive"`, add a comma and `"openInOneDrive": "Open in OneDrive"`
- in `errors`, after `"oneDriveTimedOut": ...,`:

```json
    "oneDriveOtherAccount": "This OneDrive folder belongs to a different Microsoft account from the one connected now. Connect that account, or open the folder again.",
    "oneDriveReadOnly": "OneDrive folders open read-only in this release, so this file cannot be saved there yet.",
```

Run the strict-UTF-8 check on `en.json`.

- [ ] **Step 4: Run them, and the guards**

Run: `npm test --workspace trypthos-app -- useWorkspace cloudAccounts workspaceCapabilities WorkspacePanel FindDialog i18nKeys` then `npm run typecheck && npm run lint`
Expected: PASS, no stderr. (The i18n guard sees `workspace.searchPartialCloud` and `workspace.openInOneDrive` as literal calls; `errors.*` is a dynamic prefix.)

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/lib/cloudAccounts.ts apps/app/src/lib/cloudAccounts.test.ts apps/app/src/lib/workspaceCapabilities.ts apps/app/src/lib/workspaceCapabilities.test.ts apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/components/FindDialog.tsx apps/app/src/components/FindDialog.test.tsx apps/app/src/locales/en.json
git commit -m "Renderer: OneDrive failures in Microsoft's words, and Open in OneDrive" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shell - the picker's channel, `onedrive:folders`, and the leak guard over the real client

**Files:**
- Modify: `packages/domain/src/ipc.ts` (`OneDriveFoldersRequest`; `"onedrive:folders"` in `IPC_CHANNELS` after `"onedrive:disconnect"`)
- Modify: `packages/domain/src/ipc.test.ts` (the schema; the channel list)
- Modify: `packages/domain/src/index.ts` (`OneDriveFoldersRequest` after `GoogleFoldersRequest`)
- Modify: `apps/desktop/src/ipcHandlers.js` (the handler)
- Modify: `apps/desktop/src/preload.js`, `apps/desktop/test/preloadBridge.test.js`
- Modify: `apps/desktop/test/oneDriveIpc.test.js`

**Interfaces:**
- Consumes: Task 1's `OneDriveIdSchema`, `oneDriveFoldersOf`; Task 2's `createOneDriveApi`; Task 4's `createOneDrive` / `oneDrive` wiring.
- Produces:
  - `OneDriveFoldersRequest`: `{ in: "my-files" } | { in: "shared-with-me" } | { in: "folder"; driveId; itemId }`, each strict.
  - Channel `onedrive:folders` answering `{ ok: true, driveId: string, folders: OneDriveFolder[] }` for `my-files`, `{ ok: true, folders: OneDriveFolder[] }` for the other two, or `{ ok: false, reason }` - never a token, never an address. `shared-with-me` never fails: a failure is `{ ok: true, folders: [] }`.
  - Preload `listOneDriveFolders(location)`.

- [ ] **Step 1: Write the failing domain tests**

`packages/domain/src/ipc.test.ts` - add `OneDriveFoldersRequest` to the import from `./ipc`, add `"onedrive:folders",` after `"onedrive:disconnect",` in the expected channel list, and append:

```ts
describe("OneDriveFoldersRequest", () => {
  it("names My files, Shared with me, or one folder by its drive and item", () => {
    expect(OneDriveFoldersRequest.parse({ in: "my-files" })).toEqual({ in: "my-files" });
    expect(OneDriveFoldersRequest.parse({ in: "shared-with-me" })).toEqual({ in: "shared-with-me" });
    expect(OneDriveFoldersRequest.parse({ in: "folder", driveId: "beefcafe", itemId: "SHARED!7" })).toEqual({
      in: "folder",
      driveId: "beefcafe",
      itemId: "SHARED!7",
    });
  });

  // Both ids reach a Graph address.
  it("refuses an id that could change the address, a missing one, and anything extra", () => {
    expect(OneDriveFoldersRequest.safeParse({ in: "folder", driveId: "../x", itemId: "root" }).success).toBe(false);
    expect(OneDriveFoldersRequest.safeParse({ in: "folder", driveId: "beefcafe", itemId: "a/b" }).success).toBe(false);
    expect(OneDriveFoldersRequest.safeParse({ in: "folder", driveId: "beefcafe" }).success).toBe(false);
    expect(OneDriveFoldersRequest.safeParse({ in: "my-files", extra: 1 }).success).toBe(false);
    expect(OneDriveFoldersRequest.safeParse({ in: "drives" }).success).toBe(false);
    expect(OneDriveFoldersRequest.safeParse({}).success).toBe(false);
  });
});
```

Run: `npm test --workspace @trypthos/domain -- ipc` - FAIL: `OneDriveFoldersRequest` is not exported, and the channel list lacks `onedrive:folders`.

- [ ] **Step 2: Implement the domain half**

`packages/domain/src/ipc.ts` - beside `import { DriveIdSchema } from "./googleDrive";`:

```ts
import { OneDriveIdSchema } from "./oneDrive";
```

in `IPC_CHANNELS`, after `"onedrive:disconnect",`:

```ts
  "onedrive:folders",
```

and after `GoogleFoldersRequest`:

```ts
/// The OneDrive folder picker asking what is in a place. Folders only: ids and names.
///
/// My files is the connected drive's root and Shared with me a place of its own; a folder is named by
/// the drive it lives in as well as its item id, because a folder shared with the user lives in its
/// owner's drive. Both ids reach a Graph address, so the schema is what keeps them ids.
export const OneDriveFoldersRequest = z.discriminatedUnion("in", [
  z.object({ in: z.literal("my-files") }).strict(),
  z.object({ in: z.literal("shared-with-me") }).strict(),
  z.object({ in: z.literal("folder"), driveId: OneDriveIdSchema, itemId: OneDriveIdSchema }).strict(),
]);

export type OneDriveFoldersRequest = z.infer<typeof OneDriveFoldersRequest>;
```

`packages/domain/src/index.ts` - in the `./ipc` export block, after `GoogleFoldersRequest,`:

```ts
  OneDriveFoldersRequest,
```

Run: `npm test --workspace @trypthos/domain` - PASS.

- [ ] **Step 3: Write the failing shell tests**

`apps/desktop/test/preloadBridge.test.js`, append:

```js
test("listing OneDrive folders forwards the place and nothing else", async () => {
  const { bridge, ipcMain } = loadBridge();
  const received = [];
  ipcMain.handle("onedrive:folders", async (_event, payload) => {
    received.push(payload);
    return { ok: true, folders: [] };
  });

  await bridge.listOneDriveFolders({ in: "my-files" });
  await bridge.listOneDriveFolders({ in: "shared-with-me" });
  await bridge.listOneDriveFolders({ in: "folder", driveId: "beefcafe", itemId: "SHARED!8" });

  assert.deepEqual(received, [{ in: "my-files" }, { in: "shared-with-me" }, { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" }]);
});
```

`apps/desktop/test/oneDriveIpc.test.js` - change the handlers require to

```js
const { registerIpcHandlers, locateMedia } = require("../src/ipcHandlers");
```

add below the `createMicrosoftAuth` require

```js
const { createOneDriveApi } = require("../src/oneDriveApi");
```

and append:

```js
/// A OneDrive client whose places hold folders, files and shared folders, recording each call.
function foldersFactory(calls, overrides = {}) {
  return () => ({
    drive: async () => {
      calls.push(["drive"]);
      return { ok: true, drive: { id: "d0c0ffee" } };
    },
    children: async (driveId, itemId, folderPath) => {
      calls.push(["children", driveId, itemId, folderPath]);
      return {
        ok: true,
        items: [
          { id: "ITEM!2", name: "Projects", folder: {} },
          { id: "ITEM!1", name: "Plan.md", file: {} },
          { id: "LINK!9", name: "Joint", remoteItem: { id: "SHARED!7", folder: {}, parentReference: { driveId: "beefcafe" } } },
        ],
      };
    },
    sharedWithMe: async () => {
      calls.push(["shared"]);
      return {
        ok: true,
        items: [
          { id: "S!1", name: "Handbook", remoteItem: { id: "SHARED!8", folder: {}, parentReference: { driveId: "beefcafe" } } },
          { id: "S!2", name: "notes.md", remoteItem: { id: "SHARED!9", parentReference: { driveId: "beefcafe" } } },
        ],
      };
    },
    ...overrides,
  });
}

test("onedrive:folders lists My files, Shared with me and one folder - folders only, each in its own drive", async () => {
  const calls = [];
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), {
        ok: true,
        driveId: "d0c0ffee",
        folders: [
          { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
          { driveId: "d0c0ffee", itemId: "ITEM!2", name: "Projects", shared: false },
        ],
      });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "shared-with-me" }), {
        ok: true,
        folders: [{ driveId: "beefcafe", itemId: "SHARED!8", name: "Handbook", shared: true }],
      });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" }), {
        ok: true,
        folders: [
          { driveId: "beefcafe", itemId: "SHARED!7", name: "Joint", shared: true },
          { driveId: "beefcafe", itemId: "ITEM!2", name: "Projects", shared: false },
        ],
      });
      assert.deepEqual(calls, [
        ["drive"],
        ["children", "d0c0ffee", "root", ""],
        ["shared"],
        ["children", "beefcafe", "SHARED!8", ""],
      ]);
    },
    { createOneDrive: foldersFactory(calls) },
  );
});

// Spec, open questions: an error from sharedWithMe is "nothing shared" in the picker.
test("Shared with me that cannot be listed is nothing shared, logged by its reason alone", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => void logged.push(args.map(String).join(" "));
  try {
    await withHandlers(
      async ({ ipcMain }) => {
        assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "shared-with-me" }), { ok: true, folders: [] });
      },
      { createOneDrive: foldersFactory([], { sharedWithMe: async () => ({ ok: false, reason: "unknown" }) }) },
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["OneDrive's shared folders could not be listed: unknown"]);
});

test("onedrive:folders passes a failed My files or folder listing on as its reason", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), { ok: false, reason: "offline" });
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" }), {
        ok: false,
        reason: "rate-limited",
      });
    },
    {
      createOneDrive: foldersFactory([], {
        drive: async () => ({ ok: false, reason: "offline" }),
        children: async () => ({ ok: false, reason: "rate-limited" }),
      }),
    },
  );
});

test("onedrive:folders refuses a malformed request, and answers not configured without Microsoft", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => void logged.push(args.map(String).join(" "));
  try {
    await withHandlers(
      async ({ ipcMain }) => {
        assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "folder", driveId: "../x", itemId: "root" }), {
          ok: false,
          reason: "bad-request",
        });
      },
      { createOneDrive: foldersFactory([]) },
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["Rejected a malformed OneDrive folder request."]);

  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("onedrive:folders", { in: "my-files" }), { ok: false, reason: "not-configured" });
    },
    { microsoft: "none", createOneDrive: foldersFactory([]) },
  );
});

const PRESIGNED = "https://download.invented.example/presigned-onedrive-ipc";

/// Graph, scripted, for the REAL client. `seen` records every request: its address, whether it carried
/// the token, and how it treated a redirect.
function scriptedGraph(seen) {
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const file = (id, name, extra = {}) => ({ id, name, size: 7, cTag: `ctag-${id}`, file: {}, webUrl: `https://onedrive.live.com/?id=${id}`, ...extra });
  return async (url, init = {}) => {
    seen.push({ url, authorization: init.headers?.Authorization ?? null, redirect: init.redirect ?? "follow" });
    if (url === PRESIGNED) {
      const range = init.headers?.Range;
      if (range === undefined) return new Response("# Plan\n", { status: 200 });
      const [start, end] = range.replace("bytes=", "").split("-").map(Number);
      return new Response(Buffer.from("0123456789").subarray(start, end + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/10` },
      });
    }
    if (url.endsWith("/content")) return new Response(null, { status: 302, headers: { Location: PRESIGNED } });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/drive?")) return json({ id: "d0c0ffee", driveType: "personal" });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/drive/sharedWithMe")) {
      return json({ value: [{ id: "S!1", name: "Handbook", remoteItem: { id: "SHARED!8", folder: {}, parentReference: { driveId: "beefcafe" } } }] });
    }
    if (url.includes("/children?")) {
      return json({
        value: [file("ITEM!1", "Plan.md"), file("ITEM!4", "chart.png"), file("ITEM!2", "clip.mp4", { size: 10 }), { id: "ITEM!3", name: "Archive", folder: {} }],
      });
    }
    if (url.includes(":/Plan.md:?")) return json(file("ITEM!1", "Plan.md"));
    if (url.includes(":/chart.png:?")) return json(file("ITEM!4", "chart.png"));
    if (url.includes("/items/root?")) return json({ id: "ROOT!0", name: "root", folder: { childCount: 4 }, webUrl: "https://onedrive.live.com/" });
    throw new Error(`unexpected ${url}`);
  };
}

// The leak guard, extended to what PR 2 adds: every OneDrive channel and the media byte source, over
// the REAL client and the REAL account, after a connect - so the access token, the refresh token and a
// pre-authenticated download address have all existed. None may appear in an answer or a log line.
test("no OneDrive channel answers with a token or a pre-authenticated download address", async () => {
  const seen = [];
  const logged = [];
  const record = (...args) => void logged.push(args.map(String).join(" "));
  const originals = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const name of Object.keys(originals)) console[name] = record;
  const browser = [];
  try {
    await withHandlers(
      async ({ ipcMain, authLogged }) => {
        await ipcMain.invoke("onedrive:connect");
        const answers = [];
        const ask = async (channel, payload) => {
          const answer = await ipcMain.invoke(channel, payload);
          answers.push(JSON.stringify(answer ?? null));
          return answer;
        };

        const opened = await ask("workspace:openRef", { ref: { kind: "onedrive", driveId: "d0c0ffee", itemId: "root", name: "My files" } });
        assert.equal(opened.ok, true);
        const id = opened.workspace.id;
        assert.equal((await ask("workspace:list", { path: id })).ok, true);
        assert.equal((await ask("file:read", { path: `${id}/Plan.md` })).content, "# Plan\n");
        assert.equal((await ask("file:readImage", { path: `${id}/chart.png` })).ok, true);
        assert.deepEqual(await ask("workspace:reveal", { path: `${id}/Plan.md` }), { ok: true });
        assert.deepEqual(
          await ask("file:write", { path: `${id}/Plan.md`, content: "x", expectedRevision: { id: "ctag-ITEM!1" }, message: null }),
          { ok: false, reason: "read-only" },
        );
        assert.equal((await ask("onedrive:folders", { in: "my-files" })).ok, true);
        assert.equal((await ask("onedrive:folders", { in: "shared-with-me" })).ok, true);
        assert.equal((await ask("onedrive:folders", { in: "folder", driveId: "beefcafe", itemId: "SHARED!8" })).ok, true);
        assert.equal((await ask("workspace:refresh", { workspaceId: id })).ok, true);

        // The byte source is what the tp-media protocol hands the window: bytes, and a size.
        const media = await locateMedia(`${id}/clip.mp4`);
        assert.equal(media.ok, true);
        const range = await media.open(2, 5);
        assert.equal(await new Response(range.body).text(), "2345");
        answers.push(JSON.stringify({ ok: media.ok, size: media.size }));

        const text = [...answers, ...logged, ...authLogged].join(" ");
        for (const secret of [ACCESS, REFRESH, ROTATED, PRESIGNED]) assert.ok(!text.includes(secret), `leaked ${secret}`);
      },
      {
        createOneDrive: (accessToken) => createOneDriveApi({ accessToken, fetch: scriptedGraph(seen), logger: { error: record, info: record } }),
        openExternal: async (url) => void browser.push(url),
      },
    );
  } finally {
    Object.assign(console, originals);
  }

  // Only meaningful if the token and the address were really used: Graph saw the token, the
  // pre-authenticated address never did, and the redirect to it was never followed.
  assert.ok(seen.some((request) => request.authorization === `Bearer ${ACCESS}`));
  const presigned = seen.filter((request) => request.url === PRESIGNED);
  assert.ok(presigned.length >= 3);
  assert.ok(presigned.every((request) => request.authorization === null));
  assert.ok(seen.filter((request) => request.url.endsWith("/content")).every((request) => request.redirect === "manual"));
  assert.deepEqual(browser, ["https://onedrive.live.com/?id=ITEM!1"]);
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npm run build --workspace @trypthos/domain && node --test apps/desktop/test/oneDriveIpc.test.js apps/desktop/test/preloadBridge.test.js`
Expected: FAIL - `handlers.get(...)` is not a function for `onedrive:folders`, and `bridge.listOneDriveFolders` is not a function. (`secretsIpc.test.js`'s "every channel in the contract has a handler" also fails until Step 5, since `IPC_CHANNELS` names the channel.)

- [ ] **Step 5: Implement the shell half**

`apps/desktop/src/ipcHandlers.js` - add `OneDriveFoldersRequest,` and `oneDriveFoldersOf,` to the `const { ... } = require("@trypthos/domain");` block (beside `GoogleFoldersRequest,` and `foldersOf,`), and after the `google:folders` handler:

```js
  /// The OneDrive folder picker's only window onto OneDrive: My files (the connected drive's root,
  /// answered with that drive's id, so the picker can open My files itself), Shared with me, or the
  /// folders in one folder by drive and item id. Folders only - drive ids, item ids, names and whether
  /// each is shared - never a token and never an address. Opening one goes through
  /// `workspace:openRef` like every other workspace.
  ///
  /// Shared with me never fails the picker (spec, open questions): Graph's shared-items endpoint has
  /// changed before, so an error from it is "nothing shared", logged by its reason.
  ipcMain.handle("onedrive:folders", async (_event, payload) => {
    const parsed = OneDriveFoldersRequest.safeParse(payload);
    if (!parsed.success) {
      console.error("Rejected a malformed OneDrive folder request.");
      return { ok: false, reason: "bad-request" };
    }
    if (oneDrive === null) return { ok: false, reason: "not-configured" };

    const place = parsed.data;
    if (place.in === "shared-with-me") {
      const shared = await oneDrive.sharedWithMe();
      if (!shared.ok) {
        console.error(`OneDrive's shared folders could not be listed: ${shared.reason}`);
        return { ok: true, folders: [] };
      }
      return { ok: true, folders: oneDriveFoldersOf(shared.items, null) };
    }
    if (place.in === "my-files") {
      const mine = await oneDrive.drive();
      if (!mine.ok) return mine;
      const listed = await oneDrive.children(mine.drive.id, "root", "");
      if (!listed.ok) return listed;
      return { ok: true, driveId: mine.drive.id, folders: oneDriveFoldersOf(listed.items, mine.drive.id) };
    }
    const listed = await oneDrive.children(place.driveId, place.itemId, "");
    if (!listed.ok) return listed;
    return { ok: true, folders: oneDriveFoldersOf(listed.items, place.driveId) };
  });
```

`apps/desktop/src/preload.js` - after `listDriveFolders: ...,`:

```js
  /// The folders in one OneDrive place - My files, Shared with me, or one folder by its drive and item
  /// id - as ids and names. Never a token and never an address.
  listOneDriveFolders: (location) => ipcRenderer.invoke("onedrive:folders", location),
```

- [ ] **Step 6: Run the shell and domain suites; prove the leak guard can fail**

Run: `npm test --workspace @trypthos/domain && npm test --workspace trypthos-desktop`
Expected: PASS, no stderr.
Then prove the guard can fail: temporarily add `leaked: (await api.downloadLocation(ref.driveId, found.item.id)).url,` to the object `read` answers in `oneDriveWorkspace.js`. Run `node --test apps/desktop/test/oneDriveIpc.test.js`: the leak test FAILS with "leaked https://download.invented.example/presigned-onedrive-ipc". Revert it, run again: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/ipc.ts packages/domain/src/ipc.test.ts packages/domain/src/index.ts apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/test/preloadBridge.test.js apps/desktop/test/oneDriveIpc.test.js
git commit -m "Shell: onedrive:folders for the picker, and the leak guard over the real OneDrive client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Renderer - one folder picker for both clouds, and the OneDrive button

**Files:**
- Create: `apps/app/src/lib/cloudFolders.ts`
- Create: `apps/app/src/components/OpenCloudFolderDialog.tsx`
- Create: `apps/app/src/components/cloudFolderSources.tsx`, `apps/app/src/components/cloudFolderSources.test.tsx`
- Modify: `apps/app/src/components/OpenDriveDialog.tsx` (becomes a wrapper; `OpenDriveDialog.test.tsx` is **not** changed)
- Create: `apps/app/src/components/OpenOneDriveDialog.tsx`, `apps/app/src/components/OpenOneDriveDialog.test.tsx`
- Modify: `apps/app/src/lib/workspaceClient.ts`
- Modify: `apps/app/src/components/CloudAccountSection.test.tsx`, `apps/app/src/components/SettingsAccounts.test.tsx` (their `OneDriveBridge` fakes gain `listOneDriveFolders`)
- Modify: `apps/app/src/lib/i18nKeys.test.ts`
- Modify: `apps/app/src/components/WorkspacePanel.tsx`, `apps/app/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/app/src/App.tsx`, `apps/app/src/App.test.tsx`
- Modify: `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: Task 6's `onedrive:folders` answers and preload `listOneDriveFolders`; Task 5's `providerFailureKey("onedrive", ...)`; Task 4's `SourceGlyph mark="onedrive"`; PR 1's `CloudAccountSection`, `ONEDRIVE_ACCOUNT`, `oneDriveAccount`, `oneDriveBridge`.
- Produces:

```ts
// apps/app/src/lib/workspaceClient.ts
export type OneDriveLocation = { in: "my-files" } | { in: "shared-with-me" } | { in: "folder"; driveId: string; itemId: string };
export type OneDriveFoldersResult =
  | { ok: true; driveId?: string; folders: { driveId: string; itemId: string; name: string; shared: boolean }[] }
  | { ok: false; reason: string };
// OneDriveBridge gains:
listOneDriveFolders(location: OneDriveLocation): Promise<OneDriveFoldersResult>;

// apps/app/src/lib/cloudFolders.ts
export interface CloudPlace { kind: string; id: string | null; name: string; driveId: string | null; shared: boolean }
export interface CloudFolder { id: string; name: string; shared: boolean; driveId?: string }
export type CloudFoldersResult = { ok: true; folders: CloudFolder[]; driveId?: string | null } | { ok: false; reason: string };
export interface CloudRoot { kind: string; id: string | null; nameKey: string; shared: boolean }
export interface CloudFolderSource {
  mark: WorkspaceMark; markClass: string; titleKey: string; rootKey: string; roots: readonly CloudRoot[];
  topHeadingKey: string | null; readOnlyNoteKey: string; account: CloudAccountKind; accountCalls: CloudAccountBridge | null;
  list(place: CloudPlace | null): Promise<CloudFoldersResult>; failureKey(reason: string): string;
  enter(here: CloudPlace | null, folder: CloudFolder): CloudPlace; refFor(place: CloudPlace): WorkspaceRef | null;
  glyph(place: CloudPlace, className: string): ReactElement;
}

// apps/app/src/components/cloudFolderSources.tsx
export function googleDriveFolderSource(bridge: GoogleBridge | null): CloudFolderSource;
export function oneDriveFolderSource(bridge: OneDriveBridge | null): CloudFolderSource;
export function cloudFolderKeys(): string[];

// apps/app/src/components/OpenCloudFolderDialog.tsx
export default function OpenCloudFolderDialog(props: { source: CloudFolderSource; onCancel: () => void; onOpen: (ref: WorkspaceRef) => void }): JSX.Element;
// apps/app/src/components/OpenOneDriveDialog.tsx
export default function OpenOneDriveDialog(props: { bridge: OneDriveBridge | null; onCancel: () => void; onOpen: (ref: WorkspaceRef) => void }): JSX.Element;
// OpenDriveDialog keeps its props: { bridge: GoogleBridge | null; onCancel; onOpen }.

// WorkspacePanel gains an optional prop:
onOpenOneDrive?: () => void;
```

- [ ] **Step 1: Write the failing OneDrive picker tests**

```tsx
// apps/app/src/components/OpenOneDriveDialog.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenOneDriveDialog from "./OpenOneDriveDialog";
import type { OneDriveBridge, OneDriveFoldersResult, OneDriveLocation } from "../lib/workspaceClient";

const MINE = "d0c0ffee";
const THEIRS = "beefcafe";

/// What each place holds. Keyed by what the dialog asks, so a test also proves what it asked.
function answerFor(location: OneDriveLocation): OneDriveFoldersResult {
  if (location.in === "my-files") {
    return {
      ok: true,
      driveId: MINE,
      folders: [
        { driveId: THEIRS, itemId: "SHARED!7", name: "Joint", shared: true },
        { driveId: MINE, itemId: "ITEM!2", name: "Projects", shared: false },
      ],
    };
  }
  if (location.in === "shared-with-me") return { ok: true, folders: [{ driveId: THEIRS, itemId: "SHARED!8", name: "Handbook", shared: true }] };
  if (location.itemId === "ITEM!2") return { ok: true, folders: [{ driveId: MINE, itemId: "ITEM!5", name: "2026", shared: false }] };
  if (location.itemId === "SHARED!8") return { ok: true, folders: [{ driveId: THEIRS, itemId: "ITEM!6", name: "Chapters", shared: false }] };
  return { ok: true, folders: [] };
}

function fakeBridge(overrides: Partial<OneDriveBridge> = {}) {
  return {
    oneDriveStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    connectOneDrive: vi.fn(async () => ({ ok: true as const, email: "ada@example.com" })),
    cancelOneDriveConnect: vi.fn(async () => ({ ok: true })),
    disconnectOneDrive: vi.fn(async () => ({ ok: true })),
    listOneDriveFolders: vi.fn(async (location: OneDriveLocation): Promise<OneDriveFoldersResult> => answerFor(location)),
    ...overrides,
  } satisfies OneDriveBridge;
}

const markOf = (button: HTMLElement) => button.querySelector("[data-mark]")?.getAttribute("data-mark");

describe("OpenOneDriveDialog", () => {
  it("shows My files and Shared with me under OneDrive's mark, and nothing to open yet", async () => {
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    const myFiles = await screen.findByRole("button", { name: "My files" });
    expect(markOf(myFiles)).toBe("onedrive");
    expect(markOf(screen.getByRole("button", { name: "Shared with me" }))).toBe("drive-shared-with-me");
    const title = screen.getByRole("heading", { name: "Open a OneDrive folder" });
    expect(title.parentElement?.querySelector('[data-mark="onedrive"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
    // The top level is two fixed places: nothing is listed until one is entered.
    expect(bridge.listOneDriveFolders).not.toHaveBeenCalled();
  });

  it("opens My files itself, on the connected account's drive", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "my-files" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: MINE, itemId: "root", name: "My files" });
  });

  it("opens a folder in My files by its drive and item", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", { name: "2026" })).toBeDefined();
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "folder", driveId: MINE, itemId: "ITEM!2" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: MINE, itemId: "ITEM!2", name: "Projects" });
  });

  it("offers nothing to open in Shared with me; a shared folder opens in its owner's drive, marked shared", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    const handbook = await screen.findByRole("button", { name: "Handbook" });
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "shared-with-me" });
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
    expect(markOf(handbook)).toBe("drive-shared-folder");

    await userEvent.click(handbook);
    await screen.findByRole("button", { name: "Chapters" });
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "folder", driveId: THEIRS, itemId: "SHARED!8" });
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: THEIRS, itemId: "SHARED!8", shared: true, name: "Handbook" });
  });

  it("marks a shared folder in My files as shared, and opens it in its owner's drive", async () => {
    const onOpen = vi.fn();
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    const joint = await screen.findByRole("button", { name: "Joint" });
    expect(markOf(joint)).toBe("drive-shared-folder");
    expect(markOf(screen.getByRole("button", { name: "Projects" }))).toBe("drive-folder");

    await userEvent.click(joint);
    expect(await screen.findByText("No folders here.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: THEIRS, itemId: "SHARED!7", shared: true, name: "Joint" });
  });

  // Spec, open questions: Shared with me answering nothing - or failing, which the shell answers as
  // nothing - is an empty place, never an error over the dialog.
  it("shows an empty Shared with me as an empty place", async () => {
    const bridge = fakeBridge({ listOneDriveFolders: vi.fn(async (): Promise<OneDriveFoldersResult> => ({ ok: true, folders: [] })) });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    expect(await screen.findByText("No folders here.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks to connect when no account is connected, and carries on once one is", async () => {
    let connected = false;
    const bridge = fakeBridge({
      oneDriveStatus: vi.fn(async () => ({
        ok: true as const,
        configured: true,
        connected,
        email: connected ? "ada@example.com" : null,
        reason: null,
      })),
      connectOneDrive: vi.fn(async () => {
        connected = true;
        return { ok: true as const, email: "ada@example.com" };
      }),
    });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect(await screen.findByRole("button", { name: "My files" })).toBeDefined();
  });

  it("names a failed listing in Microsoft's words", async () => {
    const bridge = fakeBridge({ listOneDriveFolders: vi.fn(async (): Promise<OneDriveFoldersResult> => ({ ok: false, reason: "offline" })) });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Microsoft");
    expect(alert.textContent).not.toContain("GitHub");
  });

  it("goes back up through the breadcrumb", async () => {
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "2026" });

    const crumbs = within(screen.getByRole("navigation"));
    expect(crumbs.getByRole("button", { name: "My files" })).toBeDefined();
    await userEvent.click(crumbs.getByRole("button", { name: "OneDrive" }));
    expect(await screen.findByRole("button", { name: "Shared with me" })).toBeDefined();
  });

  it("says OneDrive opens read-only in this release, and cancels", async () => {
    const onCancel = vi.fn();
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={onCancel} onOpen={() => {}} />);

    expect(await screen.findByText("OneDrive folders open read-only for now. Saving to OneDrive follows in the next release.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

```tsx
// apps/app/src/components/cloudFolderSources.test.tsx
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import { cloudFolderKeys, googleDriveFolderSource, oneDriveFolderSource } from "./cloudFolderSources";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

describe("the folder sources and the catalogue", () => {
  // They are looked up as t(source.titleKey) and the like, which the i18n guard cannot see as calls.
  it("name only keys that exist", () => {
    for (const key of cloudFolderKeys()) expect(typeof lookup(key), key).toBe("string");
  });

  it("name each source's title, root crumb, places, heading and note", () => {
    expect(cloudFolderKeys()).toEqual(
      expect.arrayContaining(["drive.title", "drive.root", "drive.sharedDrives", "oneDrivePicker.title", "oneDrivePicker.myFiles", "oneDrivePicker.readOnlyNote"]),
    );
  });
});

describe("what a chosen place opens as", () => {
  it("opens nothing for Shared with me, and a OneDrive place only once its drive is known", () => {
    const source = oneDriveFolderSource(null);
    expect(source.refFor({ kind: "shared-with-me", id: null, name: "Shared with me", driveId: null, shared: true })).toBeNull();
    expect(source.refFor({ kind: "my-files", id: "root", name: "My files", driveId: null, shared: false })).toBeNull();
    expect(source.refFor({ kind: "my-files", id: "root", name: "My files", driveId: "d0c0ffee", shared: false })).toEqual({
      kind: "onedrive",
      driveId: "d0c0ffee",
      itemId: "root",
      name: "My files",
    });
  });

  it("makes Google's references exactly as the Drive picker always has", () => {
    const source = googleDriveFolderSource(null);
    expect(source.refFor({ kind: "my-drive", id: "root", name: "My Drive", driveId: null, shared: false })).toEqual({
      kind: "google-drive",
      folderId: "root",
      name: "My Drive",
    });
    expect(source.refFor({ kind: "folder", id: "dirEEE", name: "2026", driveId: "sharedDDD", shared: false })).toEqual({
      kind: "google-drive",
      folderId: "dirEEE",
      driveId: "sharedDDD",
      name: "2026",
    });
    expect(source.refFor({ kind: "shared-with-me", id: null, name: "Shared with me", driveId: null, shared: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail, and record Google's picker as green**

Run: `npm test --workspace trypthos-app -- OpenOneDriveDialog cloudFolderSources`
Expected: FAIL - cannot resolve `./OpenOneDriveDialog` and `./cloudFolderSources`.
Run: `npm test --workspace trypthos-app -- OpenDriveDialog`
Expected: PASS - the baseline the refactor must keep, untouched.

- [ ] **Step 3: The bridge and the catalogue**

`apps/app/src/lib/workspaceClient.ts` - after `DriveFoldersResult`:

```ts
/// A place the OneDrive picker can list: the user's own files (the connected drive's root), the
/// folders shared with them, or one folder by the drive it lives in and its item id.
export type OneDriveLocation = { in: "my-files" } | { in: "shared-with-me" } | { in: "folder"; driveId: string; itemId: string };

/// What a OneDrive place holds: folders, each in the drive it lives in. My files also answers its own
/// drive's id, which is how the picker can open My files itself.
export type OneDriveFoldersResult =
  | { ok: true; driveId?: string; folders: { driveId: string; itemId: string; name: string; shared: boolean }[] }
  | { ok: false; reason: string };
```

in `interface OneDriveBridge`, after `disconnectOneDrive(...)`:

```ts
  listOneDriveFolders(location: OneDriveLocation): Promise<OneDriveFoldersResult>;
```

and in `oneDriveBridge()`, after `disconnectOneDrive: bridge.disconnectOneDrive,`:

```ts
    listOneDriveFolders: bridge.listOneDriveFolders,
```

`apps/app/src/components/CloudAccountSection.test.tsx` - in `fakeOneDrive`, after `disconnectOneDrive: ...,`:

```ts
    listOneDriveFolders: async () => ({ ok: true, folders: [] }),
```

`apps/app/src/components/SettingsAccounts.test.tsx` - in the `oneDrive` fake, after `disconnectOneDrive: ...,` the same line.

`apps/app/src/locales/en.json`:
- in `cloud`, after `"notConnected": "Not connected"`, add a comma and:

```json
    "loadingFolders": "Loading folders...",
    "noFolders": "No folders here.",
    "openThisFolder": "Open this folder"
```

- in `drive`, delete `"loading"`, `"empty"`, `"openThis"` and `"cancel"` (the shared picker reads `cloud.*`), leaving `title`, `root`, `myDrive`, `sharedWithMe`, `sharedDrives` and `readOnlyNote`.
- after the `drive` section, a new section:

```json
  "oneDrivePicker": {
    "title": "Open a OneDrive folder",
    "root": "OneDrive",
    "myFiles": "My files",
    "sharedWithMe": "Shared with me",
    "readOnlyNote": "OneDrive folders open read-only for now. Saving to OneDrive follows in the next release."
  },
```

- in `workspace`, after `"openDrive": "Open Google Drive folder",`:

```json
    "openOneDrive": "Open OneDrive folder",
```

Run the strict-UTF-8 check on `en.json`.

`apps/app/src/lib/i18nKeys.test.ts` - beside `import { cloudAccountKeys } from "./cloudAccounts";`:

```ts
import { cloudFolderKeys } from "../components/cloudFolderSources";
```

and in "has no orphaned keys":

```ts
    // The keys the account kinds and the folder sources name, which no t("...") call spells out:
    // exactly these, not a prefix.
    const used = new Set([...usedKeys().keys(), ...cloudAccountKeys(), ...cloudFolderKeys()]);
```

- [ ] **Step 4: The folder-source types**

```ts
// apps/app/src/lib/cloudFolders.ts
import type { ReactElement } from "react";
import type { WorkspaceMark, WorkspaceRef } from "@trypthos/domain";
import type { CloudAccountKind } from "./cloudAccounts";
import type { CloudAccountBridge } from "./workspaceClient";

/// What the shared cloud-folder picker is driven by: one descriptor per provider, so Google Drive and
/// OneDrive look and behave alike by construction rather than by two copies that drift. Keys, not
/// wording, as `cloudAccounts.ts`; the dialog translates.

/// One step of the breadcrumb: where the user went.
export interface CloudPlace {
  /// What kind of place. A source's fixed places name their own kinds ("my-drive", "my-files",
  /// "shared-with-me", "shared-drive"); "folder" is a folder anywhere below them.
  kind: string;
  /// The id to list and to open, or null for a place that is not a folder (Shared with me).
  id: string | null;
  name: string;
  /// The drive the place is in, when the provider needs one. Null until it is known.
  driveId: string | null;
  /// Whether the provider calls it shared, or the trail reached it through something that is.
  shared: boolean;
}

/// One folder in a listing.
export interface CloudFolder {
  id: string;
  name: string;
  shared: boolean;
  /// The drive this folder is in, when the provider names one per folder (OneDrive).
  driveId?: string;
}

/// What a place's listing came back with. `driveId` is the drive the listed place itself is in, for a
/// place that did not know it - OneDrive's My files learns its drive this way.
export type CloudFoldersResult = { ok: true; folders: CloudFolder[]; driveId?: string | null } | { ok: false; reason: string };

/// A fixed row at the top level: a place of the provider's own.
export interface CloudRoot {
  kind: string;
  id: string | null;
  nameKey: string;
  shared: boolean;
}

export interface CloudFolderSource {
  mark: WorkspaceMark;
  /// The colour class of the provider's mark, e.g. "text-drive".
  markClass: string;
  titleKey: string;
  /// The first crumb, and the breadcrumb's label.
  rootKey: string;
  roots: readonly CloudRoot[];
  /// The heading over the folders the top level lists (Drive's shared drives), or null for none.
  topHeadingKey: string | null;
  readOnlyNoteKey: string;
  account: CloudAccountKind;
  /// The account's calls, or null in the browser preview - where the dialog shows the account section,
  /// which says so.
  accountCalls: CloudAccountBridge | null;
  /// The folders in a place; null is the top level.
  list(place: CloudPlace | null): Promise<CloudFoldersResult>;
  failureKey(reason: string): string;
  /// The place a listed folder becomes when it is entered from `here`.
  enter(here: CloudPlace | null, folder: CloudFolder): CloudPlace;
  /// What a place opens as, or null where there is nothing to open.
  refFor(place: CloudPlace): WorkspaceRef | null;
  /// The mark for a place, on a row and on the first crumb.
  glyph(place: CloudPlace, className: string): ReactElement;
}
```

- [ ] **Step 5: The shared dialog**

```tsx
// apps/app/src/components/OpenCloudFolderDialog.tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import CloudAccountSection from "./CloudAccountSection";
import SourceGlyph from "./SourceGlyph";
import Spinner from "./Spinner";
import { attempt } from "../hooks/useGitHub";
import type { CloudFolder, CloudFolderSource, CloudPlace } from "../lib/cloudFolders";

interface Props {
  /// Which provider's places, and how to list and open them. Memoised by the caller: it is an effect
  /// dependency, and a fresh one each render would list again each render.
  source: CloudFolderSource;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// What a request came back with. "Loading" is not stored: it is whatever is left when the answer on
/// hand was for a different request than the one now wanted, which spares the effect a synchronous
/// `setState` on every step.
type Listing =
  | { state: "connect" }
  | { state: "failed"; errorKey: string }
  | { state: "loaded"; folders: CloudFolder[]; driveId: string | null };

function placeKey(place: CloudPlace): string {
  return `${place.kind}:${place.driveId ?? ""}:${place.id ?? ""}`;
}

/// Choosing a cloud folder to open as a workspace - Google Drive's or OneDrive's, by the source given.
///
/// The top level is the source's fixed places (My Drive and Shared with me; My files and Shared with
/// me), each with its own icon, then whatever the source lists there (Drive's shared drives). Below it
/// the picker browses folders only, with a breadcrumb. "Open this folder" is offered wherever the
/// source says the place opens as a workspace. With no account connected it shows the same connect
/// control as Settings, and carries on once one is.
export default function OpenCloudFolderDialog({ source, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<CloudPlace[]>([]);
  const [answer, setAnswer] = useState<{ request: string; listing: Listing } | null>(null);
  const [reloads, setReloads] = useState(0);
  const here = trail.at(-1) ?? null;
  const request = `${here === null ? "top" : placeKey(here)}#${reloads}`;
  const listing: Listing | { state: "loading" } = answer !== null && answer.request === request ? answer.listing : { state: "loading" };

  useEffect(() => {
    if (source.accountCalls === null) return;
    let live = true;
    void (async () => {
      const result = await attempt(() => source.list(here));
      if (!live) return;
      if (result.ok) {
        setAnswer({ request, listing: { state: "loaded", folders: result.folders, driveId: result.driveId ?? null } });
      } else if (result.reason === "not-connected" || result.reason === "not-configured") {
        setAnswer({ request, listing: { state: "connect" } });
      } else {
        setAnswer({ request, listing: { state: "failed", errorKey: source.failureKey(result.reason) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [source, here, request]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const enter = useCallback((place: CloudPlace) => setTrail((previous) => [...previous, place]), []);

  // The place itself, with the drive its listing named when the place did not know one yet.
  const listedDriveId = listing.state === "loaded" ? listing.driveId : null;
  const target = here === null ? null : here.driveId === null && listedDriveId !== null ? { ...here, driveId: listedDriveId } : here;
  const ref = target === null ? null : source.refFor(target);

  const open = () => {
    if (ref !== null) onOpen(ref);
  };

  // A crumb you can go back to reads as a link: the accent, underlined, a pointer, and a focus ring.
  const crumbLinkClass =
    "cursor-pointer rounded px-1 text-accent underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const rowClass = "flex w-full items-center gap-2 truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(source.titleKey)}
      // Flex, not a grid, for the reason `OpenRepoDialog` gives: a grid row is sized to the unclipped
      // panel and draws a tall one off the bottom of the window.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-[56rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-rule bg-app p-4 shadow-menu">
        <div className="flex items-center gap-2">
          <SourceGlyph mark={source.mark} className={`size-5 ${source.markClass}`} />
          <h2 className="text-sm font-semibold text-ink">{t(source.titleKey)}</h2>
        </div>

        {source.accountCalls === null || listing.state === "connect" ? (
          <CloudAccountSection kind={source.account} bridge={source.accountCalls} onConnected={() => setReloads((count) => count + 1)} />
        ) : (
          <>
            <nav aria-label={t(source.rootKey)} className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              {here === null ? (
                <span aria-current="page" className="px-1">
                  {t(source.rootKey)}
                </span>
              ) : (
                <button type="button" className={crumbLinkClass} onClick={() => setTrail([])}>
                  {t(source.rootKey)}
                </button>
              )}
              {trail.map((place, index) => {
                const current = index === trail.length - 1;
                const content = (
                  <>
                    {index === 0 && source.glyph(place, `size-3.5 ${source.markClass}`)}
                    {place.name}
                  </>
                );
                return (
                  <span key={placeKey(place)} className="flex items-center gap-1">
                    <span aria-hidden="true">/</span>
                    {current ? (
                      <span aria-current="page" className="flex items-center gap-1 px-1">
                        {content}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`flex items-center gap-1 ${crumbLinkClass}`}
                        onClick={() => setTrail((previous) => previous.slice(0, index + 1))}
                      >
                        {content}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>

            <div className="mt-2 h-[32rem] max-h-[70vh] overflow-y-auto rounded border border-rule">
              {here === null && (
                <ul>
                  {source.roots.map((root) => {
                    const place: CloudPlace = { kind: root.kind, id: root.id, name: t(root.nameKey), driveId: null, shared: root.shared };
                    return (
                      <li key={root.kind}>
                        <button type="button" className={rowClass} onClick={() => enter(place)}>
                          {source.glyph(place, `size-4 shrink-0 ${source.markClass}`)}
                          {place.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {here === null && source.topHeadingKey !== null && listing.state === "loaded" && listing.folders.length > 0 && (
                <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t(source.topHeadingKey)}</h3>
              )}
              {listing.state === "loading" && (
                <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
                  <Spinner label={t("cloud.loadingFolders")} />
                  {t("cloud.loadingFolders")}
                </p>
              )}
              {listing.state === "failed" && (
                <p role="alert" className="m-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
                  {t(listing.errorKey)}
                </p>
              )}
              {listing.state === "loaded" && (
                <>
                  <ul>
                    {listing.folders.map((folder) => {
                      const place = source.enter(here, folder);
                      return (
                        <li key={`${folder.driveId ?? ""}:${folder.id}`}>
                          <button type="button" className={rowClass} onClick={() => enter(place)}>
                            {source.glyph(place, `size-4 shrink-0 ${here === null ? source.markClass : "text-ink-3"}`)}
                            {folder.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {here !== null && listing.folders.length === 0 && <p className="p-2 text-xs text-ink-3">{t("cloud.noFolders")}</p>}
                </>
              )}
            </div>

            <p className="mt-2 text-xs text-ink-4">{t(source.readOnlyNoteKey)}</p>
          </>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover">
            {t("cloud.cancel")}
          </button>
          {ref !== null && listing.state !== "connect" && (
            <button type="button" onClick={open} className="rounded bg-accent px-3 py-1 text-ui text-on-accent">
              {t("cloud.openThisFolder")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: The two sources, and the two wrappers**

```tsx
// apps/app/src/components/cloudFolderSources.tsx
import type { WorkspaceRef } from "@trypthos/domain";
import DriveGlyph, { type DriveGlyphKind } from "./DriveGlyph";
import SourceGlyph from "./SourceGlyph";
import { providerFailureKey } from "../hooks/useWorkspace";
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT } from "../lib/cloudAccounts";
import type { CloudFolderSource, CloudPlace } from "../lib/cloudFolders";
import {
  googleAccount,
  oneDriveAccount,
  type DriveLocation,
  type GoogleBridge,
  type OneDriveBridge,
  type OneDriveLocation,
} from "../lib/workspaceClient";

/// The two clouds the shared folder picker browses. Each is a plain descriptor: its words as keys,
/// how a place is listed, what a chosen place opens as, and the mark each place is drawn with.

/// What to ask the shell to list for a Drive place. The top level, which is no place, lists the
/// shared drives - My Drive and Shared with me are fixed rows that need no listing.
function driveLocationOf(place: CloudPlace | null): DriveLocation {
  if (place === null) return { in: "drives" };
  if (place.kind === "shared-with-me" || place.id === null) return { in: "shared-with-me" };
  return { in: "folder", id: place.id };
}

function driveGlyphKind(place: CloudPlace): DriveGlyphKind {
  switch (place.kind) {
    case "my-drive":
      return "my-drive";
    case "shared-with-me":
      return "shared-with-me";
    case "shared-drive":
      return "shared-drive";
    default:
      return place.shared ? "shared-folder" : "folder";
  }
}

export function googleDriveFolderSource(bridge: GoogleBridge | null): CloudFolderSource {
  return {
    mark: "google-drive",
    markClass: "text-drive",
    titleKey: "drive.title",
    rootKey: "drive.root",
    roots: [
      { kind: "my-drive", id: "root", nameKey: "drive.myDrive", shared: false },
      { kind: "shared-with-me", id: null, nameKey: "drive.sharedWithMe", shared: true },
    ],
    topHeadingKey: "drive.sharedDrives",
    readOnlyNoteKey: "drive.readOnlyNote",
    account: GOOGLE_ACCOUNT,
    accountCalls: googleAccount(bridge),
    list: async (place) => (bridge === null ? { ok: false, reason: "not-desktop" } : bridge.listDriveFolders(driveLocationOf(place))),
    failureKey: (reason) => providerFailureKey("google-drive", reason) ?? "errors.unknown",
    // A row at the top level is a shared drive; below it, a folder, shown as shared when Drive says so
    // or when it sits under something that is.
    enter: (here, folder) =>
      here === null
        ? { kind: "shared-drive", id: folder.id, name: folder.name, driveId: folder.id, shared: false }
        : { kind: "folder", id: folder.id, name: folder.name, driveId: here.driveId, shared: folder.shared || here.shared },
    refFor: (place) => {
      if (place.kind === "shared-with-me" || place.id === null) return null;
      const ref: WorkspaceRef = {
        kind: "google-drive",
        folderId: place.id,
        ...(place.driveId === null ? {} : { driveId: place.driveId }),
        name: place.name,
      };
      return ref;
    },
    glyph: (place, className) => <DriveGlyph kind={driveGlyphKind(place)} className={className} />,
  };
}

/// What to ask the shell to list for a OneDrive place. The top level is never listed - its two places
/// are fixed - so this is only ever asked for a place.
function oneDriveLocationOf(place: CloudPlace): OneDriveLocation {
  if (place.kind === "my-files") return { in: "my-files" };
  if (place.kind === "shared-with-me" || place.id === null || place.driveId === null) return { in: "shared-with-me" };
  return { in: "folder", driveId: place.driveId, itemId: place.id };
}

export function oneDriveFolderSource(bridge: OneDriveBridge | null): CloudFolderSource {
  return {
    mark: "onedrive",
    markClass: "text-onedrive",
    titleKey: "oneDrivePicker.title",
    rootKey: "oneDrivePicker.root",
    roots: [
      { kind: "my-files", id: "root", nameKey: "oneDrivePicker.myFiles", shared: false },
      { kind: "shared-with-me", id: null, nameKey: "oneDrivePicker.sharedWithMe", shared: true },
    ],
    topHeadingKey: null,
    readOnlyNoteKey: "oneDrivePicker.readOnlyNote",
    account: ONEDRIVE_ACCOUNT,
    accountCalls: oneDriveAccount(bridge),
    // The top level lists nothing, but it still has to know whether there is an account to list with,
    // so it asks the account - which is what turns the dialog into the connect control when there is none.
    list: async (place) => {
      if (bridge === null) return { ok: false, reason: "not-desktop" };
      if (place === null) {
        const status = await bridge.oneDriveStatus();
        if (!status.configured) return { ok: false, reason: "not-configured" };
        if (!status.connected) return { ok: false, reason: "not-connected" };
        return { ok: true, folders: [] };
      }
      const answer = await bridge.listOneDriveFolders(oneDriveLocationOf(place));
      if (!answer.ok) return answer;
      return {
        ok: true,
        driveId: answer.driveId ?? null,
        folders: answer.folders.map((folder) => ({ id: folder.itemId, name: folder.name, shared: folder.shared, driveId: folder.driveId })),
      };
    },
    failureKey: (reason) => providerFailureKey("onedrive", reason) ?? "errors.unknown",
    // Every OneDrive folder names its own drive: a shared one lives in its owner's.
    enter: (here, folder) => ({
      kind: "folder",
      id: folder.id,
      name: folder.name,
      driveId: folder.driveId ?? here?.driveId ?? null,
      shared: folder.shared || (here !== null && here.shared),
    }),
    refFor: (place) => {
      if (place.kind === "shared-with-me" || place.id === null || place.driveId === null) return null;
      const ref: WorkspaceRef = {
        kind: "onedrive",
        driveId: place.driveId,
        itemId: place.id,
        ...(place.shared ? { shared: true as const } : {}),
        name: place.name,
      };
      return ref;
    },
    // My files carries OneDrive's own mark; everything else the app's generic folder outlines.
    glyph: (place, className) =>
      place.kind === "my-files" ? (
        <SourceGlyph mark="onedrive" className={className} />
      ) : (
        <DriveGlyph kind={place.kind === "shared-with-me" ? "shared-with-me" : place.shared ? "shared-folder" : "folder"} className={className} />
      ),
  };
}

/// Every catalogue key the folder sources name. They are looked up as `t(source.titleKey)` and the
/// like, which the i18n guard cannot see as calls, so it reads this list instead: exactly these keys.
export function cloudFolderKeys(): string[] {
  return [googleDriveFolderSource(null), oneDriveFolderSource(null)].flatMap((source) => [
    source.titleKey,
    source.rootKey,
    source.readOnlyNoteKey,
    ...source.roots.map((root) => root.nameKey),
    ...(source.topHeadingKey === null ? [] : [source.topHeadingKey]),
  ]);
}
```

Replace the whole of `apps/app/src/components/OpenDriveDialog.tsx` with:

```tsx
import { useMemo } from "react";
import type { WorkspaceRef } from "@trypthos/domain";
import OpenCloudFolderDialog from "./OpenCloudFolderDialog";
import { googleDriveFolderSource } from "./cloudFolderSources";
import type { GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// Choosing a Google Drive folder: the shared cloud-folder picker over Drive's places - My Drive,
/// Shared with me and a row per shared drive. See `OpenCloudFolderDialog`.
export default function OpenDriveDialog({ bridge, onCancel, onOpen }: Props) {
  // Memoised: the source is an effect dependency of the picker and of its account section.
  const source = useMemo(() => googleDriveFolderSource(bridge), [bridge]);
  return <OpenCloudFolderDialog source={source} onCancel={onCancel} onOpen={onOpen} />;
}
```

```tsx
// apps/app/src/components/OpenOneDriveDialog.tsx
import { useMemo } from "react";
import type { WorkspaceRef } from "@trypthos/domain";
import OpenCloudFolderDialog from "./OpenCloudFolderDialog";
import { oneDriveFolderSource } from "./cloudFolderSources";
import type { OneDriveBridge } from "../lib/workspaceClient";

interface Props {
  /// The OneDrive half of the shell, or null in the browser preview.
  bridge: OneDriveBridge | null;
  onCancel: () => void;
  /// The folder the user chose. Opening it is the workspace's business, not this dialog's.
  onOpen: (ref: WorkspaceRef) => void;
}

/// Choosing a OneDrive folder: the shared cloud-folder picker over My files and Shared with me. See
/// `OpenCloudFolderDialog`.
export default function OpenOneDriveDialog({ bridge, onCancel, onOpen }: Props) {
  // Memoised: the source is an effect dependency of the picker and of its account section.
  const source = useMemo(() => oneDriveFolderSource(bridge), [bridge]);
  return <OpenCloudFolderDialog source={source} onCancel={onCancel} onOpen={onOpen} />;
}
```

- [ ] **Step 7: Run both pickers and the guards**

Run: `npm test --workspace trypthos-app -- OpenOneDriveDialog OpenDriveDialog cloudFolderSources CloudAccountSection SettingsAccounts i18nKeys`
Expected: PASS - `OpenDriveDialog.test.tsx` unchanged and green, the OneDrive tests green, no orphaned or missing keys.

- [ ] **Step 8: Write the failing header tests**

`apps/app/src/components/WorkspacePanel.test.tsx` - in `describe("the sources a workspace can be opened from")`, after "asks for the Drive folder picker when the Drive button is pressed":

```tsx
  // Offered only in a build with OneDrive, which the panel is told by being given somewhere to send
  // the press - the same arrangement as Obsidian's.
  it("offers OneDrive only when there is a picker to open", () => {
    panel();
    expect(screen.queryByRole("button", { name: "Open OneDrive folder" })).toBeNull();
  });

  it("puts OneDrive's button after Google Drive's, and asks for its picker when pressed", async () => {
    const onOpenOneDrive = vi.fn();
    const props = panel({ onOpenOneDrive });

    const button = screen.getByRole("button", { name: "Open OneDrive folder" });
    expect(button.querySelector("[data-mark]")?.getAttribute("data-mark")).toBe("onedrive");
    const names = within(button.parentElement!)
      .getAllByRole("button")
      .map((each) => each.getAttribute("aria-label"));
    expect(names.indexOf("Open OneDrive folder")).toBe(names.indexOf("Open Google Drive folder") + 1);

    await userEvent.setup().click(button);
    expect(onOpenOneDrive).toHaveBeenCalledTimes(1);
    expect(props.onOpenDrive).not.toHaveBeenCalled();
  });
```

and in `describe("the menu for the empty panel")`:

```tsx
  it("offers OneDrive after Google Drive when the build has it, and does what it says", async () => {
    const onOpenOneDrive = vi.fn();
    panel({ workspaces: [], onOpenOneDrive });
    const user = await rightClick(screen.getByTestId("workspace-body"));

    expect(items()).toEqual(["Open GitHub repository", "Open Google Drive folder", "Open OneDrive folder", "Open folder"]);
    await user.click(screen.getByRole("menuitem", { name: "Open OneDrive folder" }));
    expect(onOpenOneDrive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
```

`apps/app/src/App.test.tsx` - append at the end of the file:

```tsx
describe("opening a OneDrive folder", () => {
  /// The GitHub shell, with a OneDrive half whose build has, or has not, a Microsoft client.
  function oneDriveShell(configured: boolean) {
    let asked = 0;
    shellWithGitHub({
      oneDriveStatus: async () => {
        asked += 1;
        return { ok: true as const, configured, connected: configured, email: configured ? "ada@example.com" : null, reason: null };
      },
      connectOneDrive: async () => ({ ok: true as const, email: "ada@example.com" }),
      cancelOneDriveConnect: async () => ({ ok: true }),
      disconnectOneDrive: async () => ({ ok: true }),
      listOneDriveFolders: async () => ({ ok: true as const, driveId: "d0c0ffee", folders: [] }),
    });
    return { asked: () => asked };
  }

  it("offers OneDrive in a build that has it, and opens its picker", async () => {
    oneDriveShell(true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open OneDrive folder" }));
    expect(await screen.findByRole("dialog", { name: "Open a OneDrive folder" })).toBeTruthy();
  });

  it("leaves OneDrive out of a build without it", async () => {
    const shell = oneDriveShell(false);
    render(<App />);

    await waitFor(() => expect(shell.asked()).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Open OneDrive folder" })).toBeNull();
  });
});
```

- [ ] **Step 9: Run them to verify they fail**

Run: `npm test --workspace trypthos-app -- WorkspacePanel App.test`
Expected: FAIL - no "Open OneDrive folder" button or menu entry; App never asks `oneDriveStatus`.

- [ ] **Step 10: Implement the button, the menu entry and the wiring**

`apps/app/src/components/WorkspacePanel.tsx` - in `interface Props`, after `onOpenDrive: () => void;`:

```tsx
  /// Opens the OneDrive folder picker. Absent in a build without OneDrive, which takes the button and
  /// the menu entry away - as Obsidian's are absent where Obsidian is not installed.
  onOpenOneDrive?: () => void;
```

add `onOpenOneDrive,` to the destructured props after `onOpenDrive,`; replace the header comment above the source buttons with

```tsx
        {/* One button per source rather than a menu behind one: a menu would put each behind a click
            that says nothing about what is in it. Obsidian's is there only when Obsidian is installed,
            and OneDrive's only in a build that has it. A sixth source is where this changes shape. */}
```

after the Google Drive header button:

```tsx
        {onOpenOneDrive !== undefined && (
          <button
            type="button"
            onClick={onOpenOneDrive}
            aria-label={t("workspace.openOneDrive")}
            title={t("workspace.openOneDrive")}
            className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
          >
            <SourceGlyph mark="onedrive" className="size-4" />
          </button>
        )}
```

and in the empty-panel menu, after the `workspace.openDrive` entry:

```tsx
          {onOpenOneDrive !== undefined && (
            <ContextMenuItem
              onClick={() => {
                setSourceMenu(null);
                onOpenOneDrive();
              }}
            >
              {t("workspace.openOneDrive")}
            </ContextMenuItem>
          )}
```

`apps/app/src/App.tsx`:
- imports: `import OpenOneDriveDialog from "./components/OpenOneDriveDialog";` after `OpenDriveDialog`, and `import { attempt } from "./hooks/useGitHub";` beside the other hook imports.
- after `const [pickingDrive, setPickingDrive] = useState(false);`:

```tsx
  const [pickingOneDrive, setPickingOneDrive] = useState(false);
  /// Whether this build can open OneDrive folders, which is whether OneDrive's button is in the
  /// browser's header at all. Asked once at launch, as Obsidian's is: a build without a Microsoft
  /// client has nothing to connect, and a picker that could only say so is not worth a button. Not
  /// gated on being connected - the picker carries the connect control, as Google's does.
  const [oneDriveConfigured, setOneDriveConfigured] = useState(false);
```

- after `const oneDrive = useMemo(() => oneDriveBridge(), []);`:

```tsx
  useEffect(() => {
    if (oneDrive === null) return;
    let current = true;
    void attempt(() => oneDrive.oneDriveStatus()).then((status) => {
      if (current) setOneDriveConfigured(status.ok && status.configured);
    });
    return () => {
      current = false;
    };
  }, [oneDrive]);
```

- on `<WorkspacePanel ...>`, after `onOpenDrive={() => setPickingDrive(true)}`:

```tsx
          onOpenOneDrive={oneDriveConfigured ? () => setPickingOneDrive(true) : undefined}
```

- after the `{pickingDrive && (<OpenDriveDialog ... />)}` block:

```tsx
      {pickingOneDrive && (
        <OpenOneDriveDialog
          bridge={oneDrive}
          onCancel={() => setPickingOneDrive(false)}
          onOpen={(ref) => {
            setPickingOneDrive(false);
            void actions.openRef(ref);
          }}
        />
      )}
```

- [ ] **Step 11: Run the renderer suites and the guards**

Run: `npm test --workspace trypthos-app && npm run typecheck && npm run lint && npm run test:browser`
Expected: all PASS, no stderr.

- [ ] **Step 12: Commit**

```bash
git add apps/app/src/lib/cloudFolders.ts apps/app/src/components/OpenCloudFolderDialog.tsx apps/app/src/components/cloudFolderSources.tsx apps/app/src/components/cloudFolderSources.test.tsx apps/app/src/components/OpenDriveDialog.tsx apps/app/src/components/OpenOneDriveDialog.tsx apps/app/src/components/OpenOneDriveDialog.test.tsx apps/app/src/lib/workspaceClient.ts apps/app/src/components/CloudAccountSection.test.tsx apps/app/src/components/SettingsAccounts.test.tsx apps/app/src/lib/i18nKeys.test.ts apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/App.tsx apps/app/src/App.test.tsx apps/app/src/locales/en.json
git commit -m "Renderer: one cloud folder picker for Drive and OneDrive, and the OneDrive button" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, version and release notes (the controller does the manual check, line endings, push and PR)

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json` (five entries) -> `0.103.0`
- Modify: `apps/app/src/lib/releaseNotes/current.ts` (new `RECENT[0]`)
- Modify: `apps/app/src/lib/appInfo.ts` (the Workspace browser and OneDrive rows; the Microsoft disclaimer already covers Graph - no new third party)
- Modify: `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md`
- Modify: `docs/specs/onedrive-workspace.md` (status line; Open questions after the manual check)

- [ ] **Step 1: Find the PR number**

Run: `gh pr list --state all --limit 1 --json number -q '.[0].number'` and `gh issue list --state all --limit 1 --json number -q '.[0].number'`; the PR will be the larger of the two plus one. Use it as `pr` below and confirm it after `gh pr create`.

- [ ] **Step 2: Bump the version in lockstep**

Edit each file by hand to `0.103.0`. In `package-lock.json` change only the top-level `version` and the four `packages` entries whose `name` is `trypthos`, `trypthos-app`, `trypthos-desktop` and `@trypthos/domain` - count exactly five changes. Run `npm test --workspace trypthos-app -- versionMirrors releases` - it fails until Step 3 lands (`RECENT[0]` must equal `version.json`), then passes.

- [ ] **Step 3: Write the release entry**

At the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`:

```ts
  {
    version: "0.103.0",
    date: "<today, YYYY-MM-DD>",
    pr: <number from Step 1>,
    headline: "Open OneDrive folders, read-only",
    summary:
      "With a Microsoft account connected, the folder browser has a OneDrive button, and the panel's right-click menu has the same choice. It opens a picker with My files and Shared with me: open My files itself, any folder in it, or a folder someone shared with you, and it opens as another tree beside your other folders, marked with a OneDrive cloud, and comes back the next time you start Trypthos. Files open read-only for now - saving to OneDrive follows in the next release - pictures a note embeds are shown, and videos and audio play and can be seeked, streamed in ranges through the main process so neither your sign-in nor the download address reaches the window. Folders are read as you open them and a listing is kept for a minute; right-click Refresh asks OneDrive again, and Open in OneDrive shows a file, a folder or the whole workspace on onedrive.live.com in your browser. The filter box and Find in Files search only the cloud folders you have opened, and say so. A OneDrive folder remembered under one Microsoft account is not opened under another, and Trypthos says so. Work and school accounts are not supported.",
    added: [
      "Open My files, a folder in it, or a folder shared with you from OneDrive as a read-only workspace, from the OneDrive button or the panel's right-click menu.",
      "Open in OneDrive, Refresh, embedded pictures, and video and audio playback in OneDrive folders.",
    ],
    changed: [
      "The Google Drive and OneDrive folder pickers share one design.",
      "The note under filtered results reads Cloud folders are searched only where you have opened them, since it now covers OneDrive too.",
      "Microsoft refusing the account lookup as forbidden now reads as permission denied rather than an unknown error.",
    ],
  },
```

- [ ] **Step 4: Update the inventories in lockstep**

- `apps/app/src/lib/appInfo.ts`, Workspace browser row: replace `on this machine, on GitHub or in Google Drive` with `on this machine, on GitHub, in Google Drive or in OneDrive`, and replace `OneDrive and Dropbox follow in a later release.` with `Dropbox follows in a later release.`
- `appInfo.ts`, the OneDrive row becomes: `| OneDrive | Connect a personal Microsoft account from Settings > Accounts, then open My files, a folder in it, or a folder shared with you as another tree. Files open read-only for now; pictures are shown, video and audio play, and Open in OneDrive shows an entry on onedrive.live.com. Saving to OneDrive follows in the next release. |`
- `README.md` Features: the same OneDrive row text; in the Workspace browser row replace `from your machine, from GitHub or from Google Drive` with `from your machine, from GitHub, from Google Drive or from OneDrive`, replace `the same Obsidian, GitHub and folder choices as its header buttons` with `the same choices as its header buttons`, and replace `OneDrive and Dropbox follow in a later release.` with `With a Microsoft account connected, a OneDrive button opens a OneDrive folder the same way, read-only for now. Dropbox follows in a later release.` In "Not built yet", replace `the other cloud folders (OneDrive, Dropbox)` with `saving to OneDrive, Dropbox folders`. In the roadmap's Cloud providers item, replace `Still to come: OneDrive and Dropbox.` with `OneDrive folders open read-only. Still to come: saving to OneDrive, and Dropbox.`
- `docs/features.md`: replace `Google Drive is behind the same interface, and OneDrive and Dropbox follow.` with `Google Drive and OneDrive are behind the same interface, and Dropbox follows.` Under `## OneDrive`, replace the last two sentences of the existing paragraph (`Opening OneDrive folders follows in the next release. Work and school accounts are not supported.`) with `Work and school accounts are not supported.` and add a second paragraph:

```markdown
**Open a OneDrive folder beside your other folders.** With a Microsoft account connected, the folder browser has a OneDrive button (and the panel's right-click menu the same choice), in builds made with OneDrive support. It opens the same picker as Google Drive's, with My files and Shared with me and a breadcrumb to go back up: open My files itself, any folder in it, or a folder someone shared with you. It opens as another tree, marked with a OneDrive cloud, and comes back the next time you start Trypthos. Files open read-only for now - saving, New File, New Folder and rename follow in the next release. Markdown and text files open as they do anywhere else, pictures a note embeds are shown, and videos and audio play and can be seeked: they stream in ranges through the main process, from an address OneDrive hands out for a short time, so neither your sign-in nor that address reaches the window. Folders are read as you open them and a listing is kept for a minute; right-click Refresh asks OneDrive again. The filter box and Find in Files search only the folders you have opened, and say so. Open in OneDrive shows a file, a folder or the whole workspace on onedrive.live.com in your browser. A folder remembered under one Microsoft account is not opened under another: it stays in the list greyed out, with a message saying so. If OneDrive cannot list what has been shared with you, Shared with me is simply empty.
```

- `docs/Architecture.md`: in "Storage providers", the Order line becomes `Order: local (**built**), GitHub (**built; reads, and commits to a branch**), Google Drive (**sign-in, folders, saving, new files and folders, rename and Open in Google Drive built**), OneDrive (**sign-in and read-only folders built**), Dropbox.` Rename `### OneDrive account (sign-in only)` to `### OneDrive (sign-in and read-only folders)`, change its first sentence to `As of 0.102.0 a personal Microsoft account can be connected and disconnected, and as of 0.103.0 OneDrive folders open read-only; saving is not built yet.`, and append these bullets to that section:

```markdown
- **The pure half is `oneDrive.ts`.** Ids (`isOneDriveId`, `OneDriveIdSchema`: `^[A-Za-z0-9!._-]{1,256}$`, checked before any id reaches an address), Graph addresses by path (`oneDrivePathUrl` encodes each segment with `encodeURIComponent`; the workspace root is addressed by its item id, `root` for My files), the item, page and drive schemas, `oneDriveFailure(status, code)` (the spec's error table: 401 not-connected, 403 permission-denied, 404 not-found, 409 `nameAlreadyExists` exists, 412 conflict, 413 too-large, 429/503 rate-limited, other 4xx unknown, 5xx offline), `retryAfterMs` (at most ten seconds), `contentRangeMatches`, `oneDriveEntriesOf` (files and folders only, never a `remoteItem`, folders first) and `oneDriveFoldersOf` (the picker's folders, a shared one in its owner's drive).
- **`oneDriveApi.js` is the read side over `net.fetch`.** `drive`, `children` (every page, at most 50 of 200; a `@odata.nextLink` that is not on Graph is refused rather than sent the token), `item`, `sharedWithMe`, `downloadLocation`, `download` and `rangeFrom`. One retry after a 401 with a forced refresh, one after 429/503 honouring `Retry-After`. **The token never leaves Graph's host:** `downloadLocation` asks for `/content` with `redirect: "manual"` and reads the 302's `Location`, and `download` and `rangeFrom` fetch that pre-authenticated address with no `Authorization` header. A range is accepted as a 206 whose `Content-Range` matches, or a 200 from offset 0; 401/403 from the address is `expired`. The deadline covers headers only, and the window's abort signal is threaded through.
- **`oneDriveWorkspace.js` addresses everything by path.** No id map, no duplicate suffix, no re-keying: OneDrive refuses duplicate names. The shared path guard over `/onedrive` runs before every request. A listing is cached for 60 s and joined while in flight; `listKnown` answers what was listed since the last refresh, as Drive's does. `read` asks for the item's `cTag` before its bytes and answers `readOnly: true` with revision `{ id: cTag }`; `write` answers `read-only` (PR 3 replaces it); there is no `createDirectory` or `rename` yet, so their IPC gates answer `unsupported`. `mediaSource` takes size and id from the parent's listing and keeps each file's download address until a range is refused as expired, then asks once for a new one. `webAddress` is the item's own `webUrl`, https only.
- **A OneDrive workspace is an `onedrive` ref** `{ driveId, itemId, shared?: true, name }`, keyed `onedrive:<driveId>:<itemId>` (unfolded) and labelled `OneDrive / <name>`; settings v25, a no-op migration so an older build refuses the file rather than dropping every workspace. **An own-drive ref is checked against the connected account** (`/me/drive`, compared case-insensitively) and answers `other-account` on a mismatch; a ref with `shared: true` lives in its owner's drive by design and is not checked.
- **`onedrive:folders` is the picker's only view of OneDrive.** A strict `in` union - `my-files` (answered with the connected drive's id, so My files itself can be opened), `shared-with-me`, or `folder` with a drive id and an item id - answering drive ids, item ids, names and `shared`, never a token or an address. A failed `sharedWithMe` is answered as nothing shared.
- **One folder picker for both clouds.** `OpenCloudFolderDialog` is driven by a `CloudFolderSource` (`lib/cloudFolders.ts`; `googleDriveFolderSource` and `oneDriveFolderSource` in `components/cloudFolderSources.tsx`); `OpenDriveDialog` and `OpenOneDriveDialog` are wrappers. The sources' keys are listed exactly by `cloudFolderKeys()`, which the i18n guard reads. The OneDrive header button appears when the build has a Microsoft client (`configured`); the picker shows the connect control when no account is connected.
- **Leak guard.** `oneDriveIpc.test.js` drives every OneDrive channel and the media byte source over the real client and the real account after a connect, and checks answers and log lines for the access token, both refresh tokens and the pre-authenticated address - and that the address was never sent the token and the 302 was never followed.
- **OneDrive is excluded from the vault graph**, as Drive is.
```

- `CLAUDE.md`: in the status line replace `and a OneDrive account can be connected` with `and OneDrive folders open read-only`; in "Cloud providers" the order line becomes `Phase 1 is **local filesystem only.** Then, in order: **Google Drive** (shipped), **OneDrive** (read-only shipped, saving in progress), **Dropbox** (GitHub shipped first, out of the original order).`
- `docs/specs/onedrive-workspace.md`: the status line becomes `**Status: PR 2 delivered (0.103.0).** It is the design the work is measured against, agreed before the first line of it.`

Run the strict-UTF-8 check on `README.md`, `docs/features.md`, `docs/Architecture.md`, `CLAUDE.md` and the spec.

- [ ] **Step 5: Full verification**

Run, from the repo root: `npm run lint && npm run typecheck && npm run build && npm test && npm run test:browser`
Expected: all pass, and no stderr lines in any suite (search the output for `stderr`, `Error`, `Warning`). The dash guard covers the release entry and the new catalogue strings.

- [ ] **Step 6: The manual check (controller)**

Set `TRYPTHOS_ONEDRIVE_CLIENT` to the `.secrets/onedrive-client.json` path, `npm run app`, and with a connected personal account:
1. The OneDrive button is in the header and in the empty-panel right-click menu. Open My files itself; it opens as `My files` with the cloud mark. Expand folders; open a markdown file (read-only, no save offered); a note with an embedded picture shows it; a video plays and seeks.
2. **The redirect:** a file opens at all only if `net.fetch` exposed the 302's `Location` under `redirect: "manual"`. If files fail to open with `unknown` and the log says "OneDrive answered a download without an address this build can use", record that in the spec's "What the spike established", and switch `downloadLocation` to the item's `@microsoft.graph.downloadUrl` from a plain item GET in this PR, with its own test.
3. Open in OneDrive on a file, a folder and the workspace row opens onedrive.live.com. Right-click Refresh re-lists. The filter finds only opened folders and shows the cloud line.
4. **Shared with me (spec, Open questions):** from a second personal Microsoft account, share a test folder with the first; open it through Shared with me, browse and read it. Record in the spec's Open questions whether `sharedWithMe` listed it and whether `/drives/{driveId}/items/{itemId}` listed its children. If it did not work, ship with the place showing its empty state and say so in the PR.
5. Quit, relaunch: the OneDrive workspace comes back. Disconnect, connect the second account, relaunch: the first account's My files is greyed out and the banner says it belongs to a different Microsoft account. Reconnect the first: Retry opens it.
6. Google Drive's picker still works exactly as before.

Update `docs/specs/onedrive-workspace.md` "Open questions" with what steps 2 and 4 found, and run the strict-UTF-8 check on it.

- [ ] **Step 7: Commit, repair line endings, push, open the PR**

```bash
git add -A
git commit -m "Docs and release notes: 0.103.0, browse OneDrive folders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
node <scratchpad>/fix-eol.mjs origin/main
for f in $(git diff --name-only origin/main HEAD); do [ "$f" = package-lock.json ] && continue; git restore --staged --source=origin/main -- "$f"; git add "$f"; done
git commit -m "Restore main's line endings on every line this branch did not change" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git diff --stat origin/main HEAD   # only real changes
git checkout -- package-lock.json  # the repair touched the LF-pinned lock in the worktree only
git push -u origin claude/onedrive-pr2
gh pr create --base main --title "OneDrive, part 2: browse OneDrive folders, read-only" --body-file <body>
```

The PR body states: what was built; the rulings above; the manual check's findings on the redirect and on Shared with me; the PR 1 review items closed here (the cancelled sign-in's generation bump pinned by its own test, the `/me` 4xx note in the spec's error table, Graph 403 as permission-denied); **Deployment surface: needs a release (new installer).** It ends with the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review against the spec

**Coverage of Delivery item 2 and the PR 2 parts of the spec:**
- The `onedrive` ref kind `{ kind, driveId, itemId, name }` and settings 24 -> 25 with a migration test -> Task 4 (plus the ruled `shared` flag).
- `oneDrive.ts`: driveItem / children-page / me-drive schemas, address builders with per-segment encoding (`#`, `%`, `?`, space, non-ASCII tested), `oneDriveFailure` row by row -> Task 1. The token response and `/me` schemas already exist in `microsoftAuth.ts` (PR 1). The write builders (`createUrl` with `conflictBehavior=fail`) are PR 3's.
- `oneDriveApi.js` read side: `drive`, `children` paged, `item`, the spec's `readText` as `download` with a size limit, `downloadLocation` (302, `redirect: "manual"`, never followed with the token), ranged reads from the pre-authenticated address, `sharedWithMe`; 401 retry, `Retry-After` capped at 10 s, header-only deadline, abort signal -> Task 2. The spec's `me` stays in `microsoftAuth.js` (PR 1 ruling).
- `oneDriveWorkspace.js`: list, read with revision `{ id: cTag }`, media source, web address, refresh, `GUARD_ROOT = "/onedrive"`, TTL cache without id map; guard refuses `..`, absolute, drive-letter, drive-relative and UNC before any request; media re-fetches an expired location once -> Task 3.
- The `onedrive` opener in `providers.js` with the other-account check for an own-drive ref -> Tasks 3 and 4.
- `onedrive:folders` (My files root and subfolders; Shared with me) -> Task 6. Shared with me failing or empty is an empty place -> Tasks 6 and 7.
- The picker, generalised from `OpenDriveDialog` over a folder source with Google's tests unchanged -> Task 7.
- Header button and source-menu entry with a OneDrive mark -> Task 7. `SourceGlyph` and the colour token, light and dark -> Task 4.
- `workspaceCapabilities`: `opensInBrowser` includes onedrive, `canEditTree` does not -> Task 5. Open in OneDrive -> Tasks 3, 4 (IPC), 5 (label). Refresh -> Task 3. Media through tp-media -> Tasks 3 and 6.
- `oneDriveFailureKey` folded into `providerFailureKey` -> Task 5.
- Leak guard: no channel answers with a token or a pre-authenticated address, over the real client -> Task 6.
- A save answers `read-only`, as Drive's PR 2 did -> Task 3 (provider), Task 4 (through `file:write`).
- PR 1 review items: the cancelled-connect generation bump pinned, red first -> Task 2 Steps 1-3; the spec's error-table note on `/me` 4xx -> Task 1 Step 4; Graph 403 is `permission-denied` -> Task 1 (`microsoftAuthErrorFor`) and `oneDriveFailure`.
- Docs and the 0.103.0 release -> Task 8. Spec "Open questions" (listing a shared folder; `sharedWithMe` longevity) -> Task 8 Step 6, recorded after the manual check.
- Not in this PR, deliberately (spec Delivery 3): save with `If-Match`, chat create, New File, New Folder, rename, `canEditTree` for OneDrive.

**Placeholder scan:** the only angle-bracketed values left are the release date, the PR number (Task 8 Step 1 finds it), the scratchpad path of the line-ending script and the PR body file - all filled at run time, as in PR 1's plan. Every task carries its test code and its implementation code.

**Type and name consistency:** `createOneDriveApi({ accessToken, fetch, logger, timeoutMs, sleep })` with `drive / children(driveId, itemId, path) / item(driveId, itemId, path) / sharedWithMe / downloadLocation(driveId, itemId) / download(driveId, itemId, limitBytes) / rangeFrom(url, start, end, { signal })` - used with exactly these names and arities by Task 3's provider, Task 4's fakes and Task 6's handler and leak test. `openOneDriveWorkspace({ ref, api, now, ttlMs })` -> `{ ok, name, provider }`, consumed by `openOneDrive(ref, { oneDrive })`. `providerDeps.oneDrive` is built from `createOneDrive((options) => microsoft.accessToken(options))`. Domain names (`oneDriveItemUrl`, `oneDrivePathUrl`, `oneDriveMetaUrl`, `oneDriveChildrenUrl`, `oneDriveContentUrl`, `oneDriveSharedWithMeUrl`, `oneDriveEntriesOf`, `oneDriveFoldersOf`, `oneDriveFailure`, `graphErrorCode`, `retryAfterMs`, `contentRangeMatches`, `isOneDriveId`, `isGraphUrl`, `isHttpsUrl`, `sameOneDriveId`, `OneDriveIdSchema`, `OneDriveFoldersRequest`, `OneDriveWorkspaceRefSchema`) are exported from the barrel in the task that first needs them. Renderer: `OneDriveLocation`, `OneDriveFoldersResult`, `listOneDriveFolders`, `CloudPlace`, `CloudFolder`, `CloudFoldersResult`, `CloudRoot`, `CloudFolderSource`, `googleDriveFolderSource`, `oneDriveFolderSource`, `cloudFolderKeys`, `OpenCloudFolderDialog`, `OpenOneDriveDialog`, `onOpenOneDrive` - one spelling each throughout. Failure reasons match `failureKey` / `providerFailureKey`; `expired` never leaves the provider.

