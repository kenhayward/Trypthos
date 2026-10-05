# Google Drive - PR 2: Open a Drive folder (read-only) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user with a connected Google account can pick a folder in My Drive or a Shared Drive and open it as a read-only workspace: browse its tree, read its markdown and text files (Google Docs as exported markdown), see images embedded in notes, refresh it, and have it come back at the next launch.

**Architecture:** Pure Drive pieces (URLs, schemas, error mapping, how a listing becomes tree entries) in `packages/domain/src/googleDrive.ts`. The shell gains a hand-rolled Drive client over `net.fetch` (`googleDriveApi.js`, token from PR 1's `googleAuth.accessToken`) and a provider (`googleDriveWorkspace.js`) that keeps a path-to-Drive-id map filled as folders are listed. A new `google-drive` workspace kind joins `WorkspaceRef` (settings v23), the provider registry and the renderer's marks. A folder picker (`OpenDriveDialog`) browses through a new `google:folders` channel. Files open read-only, and Drive failures are worded for Google.

**Tech Stack:** TypeScript + zod (domain), Electron CommonJS + `net.fetch` (shell), React 19 + react-i18next + Tailwind v4 (renderer), vitest (domain, renderer), `node --test` (shell).

**Spec:** `docs/specs/google-drive-workspace.md` - read "What the spike established", "Decisions taken", the PR 2 parts of "Architecture", and **"PR 2 decisions taken while planning"** (which wins where it differs).

**Delivery:** ONE PR from branch `claude/google-drive-pr2` (holds the spec amendment and this plan). Commit after every task; the controller pushes and opens the PR at the end.

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine: no warnings, no `console.error` (the jsdom setup fails a test on one - opt in with `expectsConsoleError` from `apps/app/src/test-setup` only where a test provokes one on purpose; shell tests inject a collecting `logger`).
- Commands run from the repo root. `npm ci`, never `npm install`. **No new dependencies.** In this worktree `npx vitest --root apps/app` has no shim: run renderer tests with `npm test` at the root, or `node ../../node_modules/vitest/vitest.mjs run <filter>` from `apps/app` (and the same from `packages/domain`).
- Domain package: no React, Electron, `fs` or `node:*` imports. Tests sit beside modules, `import { describe, expect, it } from "vitest";`.
- Shell: CommonJS. Tests in `apps/desktop/test/*.test.js` with `node:test` + `node:assert/strict`. Every name destructured from `@trypthos/domain` must be exported from `packages/domain/src/index.ts` (`domainExports.test.js` enforces it). The desktop `pretest` builds the domain.
- Failures cross IPC as results `{ ok: false, reason }`, never throws. Shell modules never throw outward.
- **Secrets and user data:** no access token in any log, answer or error. Log lines name the step plus `error.code ?? error.name` - never a URL (it holds a folder id), never a file name, never `error.message`.
- **Drive ids** are validated with `isDriveId` / `DriveIdSchema` (`^[A-Za-z0-9_-]{1,256}$`) before they reach a URL. An id that fails answers `not-found`.
- New failure reason: `read-only`. Existing ones used: `not-found`, `permission-denied`, `offline`, `rate-limited`, `not-connected`, `not-configured`, `too-large`, `not-text`, `unsupported-encoding`, `unsupported`, `bad-request`, `unknown`.
- Workspace kind string: `"google-drive"`. Provider guard root: `"/drive"`.
- Every user-facing string in `apps/app/src/locales/en.json`, read with literal `t("...")` keys (the `i18nKeys` guard checks both directions). Plain hyphen `-` only, never em/en dashes, in user-facing strings, release notes, README and features.md.
- Colours come from tokens in `apps/app/src/index.css` - never a hex in a component.
- Files containing regex escapes (Task 1's name sanitiser) are written with the editor tools, never a shell heredoc.
- The editor tools rewrite line endings to LF; do not "fix" endings - the controller repairs them against `main` before the PR.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Version: `0.96.0` -> `0.97.0` (functional enhancement). `SETTINGS_VERSION` `22` -> `23`.

## File Map

**Domain (`packages/domain/src`)**
| File | Responsibility |
|---|---|
| `googleDrive.ts` (+test) | Drive URLs, `isDriveId`/`DriveIdSchema`, response schemas, `driveErrorFor`, `displayNameFor`, `childrenToEntries`, `foldersOf` |
| `workspaceRef.ts` (+test) | `google-drive` ref kind and helpers; `PROVIDER_KINDS` |
| `settings.ts` (+test) | Version 23 |
| `ipc.ts` (+test) | `GoogleFoldersRequest`, `google:folders` channel |
| `index.ts` | Barrel exports |

**Shell (`apps/desktop`)**
| File | Responsibility |
|---|---|
| `src/googleDriveApi.js`, `test/googleDriveApi.test.js` | The Drive calls: token, timeout, schema parse, one auth retry, one rate-limit retry |
| `src/googleDriveWorkspace.js`, `test/googleDriveWorkspace.test.js` | Provider: path map, list, read, readBytes, read-only write, refresh; opener |
| `src/providers.js`, `test/providers.test.js` | `google-drive` opener |
| `src/ipcHandlers.js`, `test/googleDriveIpc.test.js` | `createGoogleDrive` dependency, `providerDeps.drive`, `google:folders` |
| `src/preload.js`, `test/preloadBridge.test.js` | `listDriveFolders` |
| `src/main.js` | Builds the Drive client factory |

**Renderer (`apps/app/src`)**
| File | Responsibility |
|---|---|
| `index.css` | `drive` colour token in every theme block |
| `components/WorkspacePanel.tsx` (+test) | Mark, colour, header button, source-menu entry |
| `components/WorkspaceHome.tsx` | Kind line for a Drive folder |
| `hooks/useWorkspace.ts` (+test) | `providerFailureKey`, `read-only` key, Drive files open read-only, kind-aware failures |
| `hooks/useGoogle.ts` | Uses `providerFailureKey` |
| `components/GoogleAccountSection.tsx` (+test) | `onConnected` |
| `components/OpenDriveDialog.tsx` (+test) | Folder picker |
| `lib/workspaceClient.ts` | `listDriveFolders` on `GoogleBridge` |
| `App.tsx` | Picker state and wiring |
| `locales/en.json` | `drive.*`, `workspace.openDrive`, `home.kindDrive`, `errors.readOnly` |

**Docs / release:** `version.json` + mirrors, `releaseNotes/current.ts`, `appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`.

---

### Task 1: Domain - `googleDrive.ts`

**Files:**
- Create: `packages/domain/src/googleDrive.ts`, `packages/domain/src/googleDrive.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces (exported from `@trypthos/domain`):
  - `DRIVE_API`, `FOLDER_MIME`, `GOOGLE_DOC_MIME`
  - `isDriveId(value: string): boolean`, `DriveIdSchema` (zod string with that pattern)
  - `DriveFileSchema`, `DriveFileListSchema`, `SharedDriveListSchema`; type `DriveFile`
  - `childrenUrl(folderId: string, pageToken: string | null, foldersOnly?: boolean): string`, `fileUrl(id)`, `mediaUrl(id)`, `exportUrl(id)`, `sharedDrivesUrl(pageToken: string | null)`
  - `driveErrorFor(status: number, body: unknown): DriveFailure` with `DriveFailure = "not-connected" | "permission-denied" | "not-found" | "rate-limited" | "offline"`
  - `displayNameFor(file: { name: string; mimeType: string }): string`
  - `DriveEntry = { path: string; name: string; kind: "file" | "directory"; fileId: string; mimeType: string; googleDoc: boolean; sizeBytes: number | null; revision: string | null }`
  - `childrenToEntries(parentPath: string, files: readonly DriveFile[]): DriveEntry[]`
  - `foldersOf(files: readonly DriveFile[]): { id: string; name: string }[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/googleDrive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DRIVE_API,
  DriveFileListSchema,
  DriveIdSchema,
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  childrenToEntries,
  childrenUrl,
  displayNameFor,
  driveErrorFor,
  exportUrl,
  fileUrl,
  foldersOf,
  isDriveId,
  mediaUrl,
  sharedDrivesUrl,
  type DriveFile,
} from "./googleDrive";

/// The pure half of reading Google Drive: every URL the shell asks, every shape it accepts, and the
/// one function that decides what a folder's listing shows in the tree.

const file = (overrides: Partial<DriveFile> & { id: string; name: string }): DriveFile => ({
  mimeType: "text/markdown",
  ...overrides,
});

describe("Drive ids", () => {
  it("accepts the alphabet Drive ids are made of", () => {
    expect(isDriveId("1H60_yEnI5d4GT-qNk")).toBe(true);
    expect(isDriveId("root")).toBe(true);
    expect(DriveIdSchema.safeParse("0AbcDEF").success).toBe(true);
  });

  // An id is spliced into a query string. Anything outside the alphabet - a quote above all - is
  // refused before it can be read as query syntax.
  it("refuses anything that could be read as query syntax", () => {
    for (const bad of ["", "a'b", "a b", "a/b", "a\\b", "x".repeat(257), "id' or name contains 'x"]) {
      expect(isDriveId(bad)).toBe(false);
    }
  });
});

describe("URLs", () => {
  it("lists a folder's children, newest page first, across Shared Drives", () => {
    const url = new URL(childrenUrl("folder1", null));
    expect(`${url.origin}${url.pathname}`).toBe(`${DRIVE_API}/files`);
    expect(url.searchParams.get("q")).toBe("'folder1' in parents and trashed = false");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("fields")).toContain("nextPageToken");
    expect(url.searchParams.get("fields")).toContain("headRevisionId");
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("carries the page token and can ask for folders only", () => {
    const url = new URL(childrenUrl("folder1", "page-2", true));
    expect(url.searchParams.get("pageToken")).toBe("page-2");
    expect(url.searchParams.get("q")).toBe(`'folder1' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`);
  });

  it("builds the per-file addresses", () => {
    expect(fileUrl("f1")).toMatch(new RegExp(`^${DRIVE_API}/files/f1\\?`));
    expect(new URL(fileUrl("f1")).searchParams.get("supportsAllDrives")).toBe("true");
    expect(new URL(mediaUrl("f1")).searchParams.get("alt")).toBe("media");
    expect(new URL(exportUrl("f1")).searchParams.get("mimeType")).toBe("text/markdown");
    expect(new URL(exportUrl("f1")).pathname).toBe("/drive/v3/files/f1/export");
    expect(new URL(sharedDrivesUrl(null)).pathname).toBe("/drive/v3/drives");
    expect(new URL(sharedDrivesUrl("p2")).searchParams.get("pageToken")).toBe("p2");
  });
});

describe("response schemas", () => {
  it("reads a listing, with and without a next page", () => {
    const parsed = DriveFileListSchema.parse({
      nextPageToken: "p2",
      files: [{ id: "a", name: "A.md", mimeType: "text/markdown", size: "12", headRevisionId: "r1" }],
    });
    expect(parsed.files[0]!.size).toBe("12");
    expect(DriveFileListSchema.parse({}).files).toEqual([]);
  });
});

describe("driveErrorFor", () => {
  it("maps statuses to the reasons the interface words", () => {
    expect(driveErrorFor(401, null)).toBe("not-connected");
    expect(driveErrorFor(404, null)).toBe("not-found");
    expect(driveErrorFor(429, null)).toBe("rate-limited");
    expect(driveErrorFor(500, null)).toBe("offline");
  });

  // Drive answers both "you may not" and "slow down" with 403, telling them apart in the body.
  it("reads a 403's reason to tell a rate limit from a refusal", () => {
    const limited = { error: { errors: [{ reason: "userRateLimitExceeded" }] } };
    expect(driveErrorFor(403, limited)).toBe("rate-limited");
    expect(driveErrorFor(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } })).toBe("rate-limited");
    expect(driveErrorFor(403, { error: { errors: [{ reason: "insufficientFilePermissions" }] } })).toBe("permission-denied");
    expect(driveErrorFor(403, "not json")).toBe("permission-denied");
  });
});

describe("displayNameFor", () => {
  it("gives a Google Doc a markdown name, since that is what it opens as", () => {
    expect(displayNameFor({ name: "Plans", mimeType: GOOGLE_DOC_MIME })).toBe("Plans.md");
    expect(displayNameFor({ name: "Plans.md", mimeType: GOOGLE_DOC_MIME })).toBe("Plans.md");
    expect(displayNameFor({ name: "Plans", mimeType: "text/plain" })).toBe("Plans");
  });

  // Drive allows these in a name; a path cannot hold them.
  it("replaces what a path cannot hold", () => {
    expect(displayNameFor({ name: "a/b\\c:d.md", mimeType: "text/markdown" })).toBe("a_b_c_d.md");
    expect(displayNameFor({ name: "tab\there.md", mimeType: "text/markdown" })).toBe("tab_here.md");
    for (const name of ["", "   ", ".", ".."]) {
      expect(displayNameFor({ name, mimeType: "text/markdown" })).toBe("_");
    }
  });
});

describe("childrenToEntries", () => {
  it("turns a listing into tree entries under their parent's path, folders first", () => {
    const entries = childrenToEntries("Notes", [
      file({ id: "f1", name: "b.md", size: "5", headRevisionId: "r1" }),
      file({ id: "d1", name: "Archive", mimeType: FOLDER_MIME }),
      file({ id: "f2", name: "A.md" }),
    ]);

    expect(entries.map((entry) => entry.path)).toEqual(["Notes/Archive", "Notes/A.md", "Notes/b.md"]);
    expect(entries[0]).toMatchObject({ kind: "directory", fileId: "d1" });
    expect(entries[2]).toMatchObject({ kind: "file", fileId: "f1", sizeBytes: 5, revision: "r1", googleDoc: false });
    expect(entries[1]!.sizeBytes).toBeNull();
  });

  it("puts root children at the top level", () => {
    expect(childrenToEntries("", [file({ id: "f1", name: "a.md" })])[0]!.path).toBe("a.md");
  });

  // Trash, shortcuts (whose target can be outside the workspace) and Google types other than Docs
  // and folders have no text to show.
  it("hides trash, shortcuts, and Google types it cannot open", () => {
    const entries = childrenToEntries("", [
      file({ id: "t", name: "gone.md", trashed: true }),
      file({ id: "s", name: "link", mimeType: "application/vnd.google-apps.shortcut" }),
      file({ id: "x", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }),
      file({ id: "p", name: "photo.png", mimeType: "image/png" }),
      file({ id: "g", name: "Plans", mimeType: GOOGLE_DOC_MIME, modifiedTime: "2026-10-01T10:00:00Z" }),
    ]);

    expect(entries.map((entry) => entry.name)).toEqual(["photo.png", "Plans.md"]);
    // A Google Doc has no headRevisionId; its revision is its modified time.
    expect(entries[1]).toMatchObject({ googleDoc: true, revision: "modified:2026-10-01T10:00:00Z" });
  });

  // Drive allows siblings with one name. A path must name one file, so the second and later get a
  // suffix from their id - decided by creation time, then id, so the same listing always gives the
  // same names.
  it("suffixes the second of two same-named siblings, deterministically, keeping the extension", () => {
    const listing = [
      file({ id: "zzzzzz9", name: "Notes.md", createdTime: "2026-02-01T00:00:00Z" }),
      file({ id: "aaaaaa1", name: "Notes.md", createdTime: "2026-01-01T00:00:00Z" }),
    ];
    const once = childrenToEntries("", listing);
    const again = childrenToEntries("", [...listing].reverse());

    expect(once.map((entry) => [entry.name, entry.fileId])).toEqual([
      ["Notes.md", "aaaaaa1"],
      ["Notes~zzzzzz.md", "zzzzzz9"],
    ]);
    expect(again).toEqual(once);
  });

  it("suffixes after the display name is decided, so a Doc and a file named alike do not collide", () => {
    const entries = childrenToEntries("", [
      file({ id: "doc0001", name: "Plans", mimeType: GOOGLE_DOC_MIME, createdTime: "2026-01-01T00:00:00Z" }),
      file({ id: "md00002", name: "Plans.md", createdTime: "2026-01-02T00:00:00Z" }),
    ]);
    expect(entries.map((entry) => entry.name).sort()).toEqual(["Plans.md", "Plans~md0000.md"]);
  });

  it("suffixes a name with no extension at its end", () => {
    const entries = childrenToEntries("", [
      file({ id: "aaaaaa1", name: "README", mimeType: "text/plain", createdTime: "1" }),
      file({ id: "bbbbbb2", name: "README", mimeType: "text/plain", createdTime: "2" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["README", "README~bbbbbb"]);
  });
});

describe("foldersOf", () => {
  it("keeps only live folders, with their real names", () => {
    expect(
      foldersOf([
        file({ id: "d1", name: "Work/2026", mimeType: FOLDER_MIME }),
        file({ id: "d2", name: "Old", mimeType: FOLDER_MIME, trashed: true }),
        file({ id: "f1", name: "a.md" }),
      ]),
    ).toEqual([{ id: "d1", name: "Work/2026" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/domain`): `node ../../node_modules/vitest/vitest.mjs run googleDrive`
Expected: FAIL - cannot resolve `./googleDrive`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/googleDrive.ts` (use the editor tool - it contains regex escapes):

```ts
import { z } from "zod";

/// Reading Google Drive, the pure half.
///
/// The shell owns the requests and the token; this owns every address it asks, every shape it
/// accepts, and the one function that decides what a folder's listing shows in the tree. See
/// docs/specs/google-drive-workspace.md ("PR 2 decisions taken while planning").

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";

/// Every Drive id is this alphabet. An id is spliced into a query string, so one that is not is
/// refused before it gets there - from settings, from the renderer, from anywhere.
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

export const DriveIdSchema = z.string().regex(DRIVE_ID_PATTERN);

const FILE_FIELDS = "id,name,mimeType,size,headRevisionId,modifiedTime,createdTime,trashed";

export const DriveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  /// Drive sends a size as a string, and none at all for Google's own types and folders.
  size: z.string().optional(),
  headRevisionId: z.string().optional(),
  modifiedTime: z.string().optional(),
  createdTime: z.string().optional(),
  trashed: z.boolean().optional(),
});

export type DriveFile = z.infer<typeof DriveFileSchema>;

export const DriveFileListSchema = z.object({
  files: z.array(DriveFileSchema).default([]),
  nextPageToken: z.string().optional(),
});

export const SharedDriveListSchema = z.object({
  drives: z.array(z.object({ id: z.string().min(1), name: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

export function childrenUrl(folderId: string, pageToken: string | null, foldersOnly = false): string {
  const clauses = [`'${folderId}' in parents`, "trashed = false"];
  if (foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: "1000",
    orderBy: "folder,name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken !== null) params.set("pageToken", pageToken);
  return `${DRIVE_API}/files?${params.toString()}`;
}

export function fileUrl(id: string): string {
  return `${DRIVE_API}/files/${id}?${new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" }).toString()}`;
}

export function mediaUrl(id: string): string {
  return `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
}

export function exportUrl(id: string): string {
  return `${DRIVE_API}/files/${id}/export?${new URLSearchParams({ mimeType: "text/markdown" }).toString()}`;
}

export function sharedDrivesUrl(pageToken: string | null): string {
  const params = new URLSearchParams({ pageSize: "100", fields: "nextPageToken,drives(id,name)" });
  if (pageToken !== null) params.set("pageToken", pageToken);
  return `${DRIVE_API}/drives?${params.toString()}`;
}

const DriveErrorBodySchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }),
});

export type DriveFailure = "not-connected" | "permission-denied" | "not-found" | "rate-limited" | "offline";

/// What a refusal from Drive means to the user. A 403 is read for its reason, because Drive answers
/// both "you may not" and "slow down" with it.
export function driveErrorFor(status: number, body: unknown): DriveFailure {
  if (status === 401) return "not-connected";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 403) {
    const parsed = DriveErrorBodySchema.safeParse(body);
    const reasons = parsed.success ? (parsed.data.error.errors ?? []).map((entry) => entry.reason) : [];
    return reasons.some((reason) => reason === "userRateLimitExceeded" || reason === "rateLimitExceeded")
      ? "rate-limited"
      : "permission-denied";
  }
  return "offline";
}

/// The name a Drive file is shown and addressed by.
///
/// Drive allows `/`, `\`, `:` and control characters in a name; a path cannot hold them, so they
/// become `_` - for display only, nothing is written back. A Google Doc is named `.md` because that
/// is what it opens as, and the interface decides what it can open by extension.
export function displayNameFor(file: { name: string; mimeType: string }): string {
  const cleaned = file.name.replace(/[/\\:\u0000-\u001f\u007f]/g, "_");
  const safe = cleaned.trim() === "" || cleaned === "." || cleaned === ".." ? "_" : cleaned;
  return file.mimeType === GOOGLE_DOC_MIME && !/\.md$/i.test(safe) ? `${safe}.md` : safe;
}

export interface DriveEntry {
  /// Workspace-relative, `/`-separated, built from display names.
  path: string;
  name: string;
  kind: "file" | "directory";
  fileId: string;
  mimeType: string;
  googleDoc: boolean;
  sizeBytes: number | null;
  /// `headRevisionId`, or `modified:<time>` for a Google Doc, which has none.
  revision: string | null;
}

/// Whether a listed item belongs in the tree: not trashed, and a folder, a Google Doc, or an
/// ordinary file. Shortcuts are left out - their target can be outside the workspace.
function isListed(file: DriveFile): boolean {
  if (file.trashed === true) return false;
  if (file.mimeType === FOLDER_MIME || file.mimeType === GOOGLE_DOC_MIME) return true;
  return !file.mimeType.startsWith(GOOGLE_APPS_PREFIX);
}

function compare(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

function withSuffix(name: string, id: string): string {
  const tag = `~${id.slice(0, 6)}`;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}${tag}${name.slice(dot)}` : `${name}${tag}`;
}

/// **The one function that decides what a folder's listing shows.**
///
/// Hides what cannot be opened, names what remains, and gives the second and later of same-named
/// siblings a suffix from their id - ordered by creation time then id, so the same listing always
/// produces the same paths. Folders first, then names, case-insensitively.
export function childrenToEntries(parentPath: string, files: readonly DriveFile[]): DriveEntry[] {
  const byName = new Map<string, DriveFile[]>();
  for (const listed of files.filter(isListed)) {
    const name = displayNameFor(listed);
    byName.set(name, [...(byName.get(name) ?? []), listed]);
  }

  const entries: DriveEntry[] = [];
  for (const [name, group] of byName) {
    const ordered = [...group].sort(
      (one, other) => compare(one.createdTime ?? "", other.createdTime ?? "") || compare(one.id, other.id),
    );
    ordered.forEach((listed, index) => {
      const finalName = index === 0 ? name : withSuffix(name, listed.id);
      const googleDoc = listed.mimeType === GOOGLE_DOC_MIME;
      entries.push({
        path: parentPath === "" ? finalName : `${parentPath}/${finalName}`,
        name: finalName,
        kind: listed.mimeType === FOLDER_MIME ? "directory" : "file",
        fileId: listed.id,
        mimeType: listed.mimeType,
        googleDoc,
        sizeBytes: listed.size === undefined ? null : Number(listed.size),
        revision:
          listed.headRevisionId ??
          (googleDoc && listed.modifiedTime !== undefined ? `modified:${listed.modifiedTime}` : null),
      });
    });
  }

  return entries.sort((one, other) =>
    one.kind === other.kind
      ? compare(one.name.toLowerCase(), other.name.toLowerCase()) || compare(one.name, other.name)
      : one.kind === "directory"
        ? -1
        : 1,
  );
}

/// The folders in a listing, by their real names, for the folder picker.
export function foldersOf(files: readonly DriveFile[]): { id: string; name: string }[] {
  return files
    .filter((listed) => listed.mimeType === FOLDER_MIME && listed.trashed !== true)
    .map((listed) => ({ id: listed.id, name: listed.name }));
}
```

In `packages/domain/src/index.ts`, add at the end:

```ts
export {
  DRIVE_API,
  DriveFileListSchema,
  DriveFileSchema,
  DriveIdSchema,
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  SharedDriveListSchema,
  childrenToEntries,
  childrenUrl,
  displayNameFor,
  driveErrorFor,
  exportUrl,
  fileUrl,
  foldersOf,
  isDriveId,
  mediaUrl,
  sharedDrivesUrl,
} from "./googleDrive";
export type { DriveEntry, DriveFailure, DriveFile } from "./googleDrive";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `packages/domain`): `node ../../node_modules/vitest/vitest.mjs run` then, from the root, `npm run typecheck`
Expected: all domain tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/googleDrive.ts packages/domain/src/googleDrive.test.ts packages/domain/src/index.ts
git commit -m "domain: Drive addresses, schemas, and how a listing becomes a tree"
```

---

### Task 2: Shell - `googleDriveApi.js`, the Drive client

**Files:**
- Create: `apps/desktop/src/googleDriveApi.js`, `apps/desktop/test/googleDriveApi.test.js`

**Interfaces:**
- Consumes: Task 1 exports; an `accessToken({ force?: boolean }?)` function shaped like PR 1's `googleAuth.accessToken` (answers `{ ok: true, token }` or `{ ok: false, reason }`).
- Produces: `createGoogleDriveApi({ accessToken, fetch, logger, timeoutMs, sleep, random })` returning:
  - `listChildren(folderId, { foldersOnly }?)` -> `{ ok: true, files: DriveFile[] }` (all pages, at most 50) or failure
  - `fileMeta(id)` -> `{ ok: true, file: DriveFile }` or failure
  - `download(id)` -> `{ ok: true, bytes: Buffer }` or failure
  - `exportMarkdown(id)` -> `{ ok: true, bytes: Buffer }` or failure
  - `sharedDrives()` -> `{ ok: true, drives: { id, name }[] }` or failure
  - An id failing `isDriveId` answers `{ ok: false, reason: "not-found" }` without a request.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/googleDriveApi.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleDriveApi } = require("../src/googleDriveApi");

/// The Drive calls against a fake fetch. What is under test is the request itself: the token on it,
/// the one retry for an expired token and the one for a rate limit, the schema check, and that
/// nothing throws or logs a URL.

const ACCESS = "access-invented-drive";
const FOLDER = "folderAAA111";

function answer(status, body, { bytes = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === "string") throw new SyntaxError("not json");
      return body;
    },
    // Sliced to the bytes themselves: a small Buffer is a view into a shared pool, and `.buffer`
    // alone would hand back the whole pool.
    arrayBuffer: async () => {
      const source = bytes ?? Buffer.from(JSON.stringify(body));
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    },
  };
}

function setup({ routes = [], tokens = [{ ok: true, token: ACCESS }] } = {}) {
  const calls = [];
  const tokenCalls = [];
  const logs = [];
  const slept = [];
  let tokenIndex = 0;
  const api = createGoogleDriveApi({
    accessToken: async (options = {}) => {
      tokenCalls.push(options);
      const next = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return next;
    },
    fetch: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization });
      const route = routes.shift();
      if (route === undefined) throw new Error(`no route for call ${calls.length}`);
      return typeof route === "function" ? route(url) : route;
    },
    logger: { error: (line) => logs.push(String(line)) },
    sleep: async (ms) => void slept.push(ms),
    random: () => 0.5,
  });
  return { api, calls, tokenCalls, logs, slept };
}

test("lists a folder with the token on the request", async () => {
  const { api, calls } = setup({
    routes: [answer(200, { files: [{ id: "f1", name: "a.md", mimeType: "text/markdown" }] })],
  });

  const listed = await api.listChildren(FOLDER);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.files.map((file) => file.id), ["f1"]);
  assert.equal(calls[0].authorization, `Bearer ${ACCESS}`);
  assert.equal(new URL(calls[0].url).searchParams.get("q"), `'${FOLDER}' in parents and trashed = false`);
});

test("follows every page of a listing", async () => {
  const { api, calls } = setup({
    routes: [
      answer(200, { nextPageToken: "p2", files: [{ id: "f1", name: "a.md", mimeType: "text/markdown" }] }),
      answer(200, { files: [{ id: "f2", name: "b.md", mimeType: "text/markdown" }] }),
    ],
  });

  const listed = await api.listChildren(FOLDER);
  assert.deepEqual(listed.files.map((file) => file.id), ["f1", "f2"]);
  assert.equal(new URL(calls[1].url).searchParams.get("pageToken"), "p2");
});

test("asks for folders only when told to", async () => {
  const { api, calls } = setup({ routes: [answer(200, { files: [] })] });
  await api.listChildren(FOLDER, { foldersOnly: true });
  assert.match(new URL(calls[0].url).searchParams.get("q"), /mimeType = 'application\/vnd\.google-apps\.folder'/);
});

// An id is spliced into a query. One outside Drive's alphabet never reaches a request.
test("refuses an id that is not a Drive id, without a request", async () => {
  const { api, calls } = setup();
  for (const call of [() => api.listChildren("a' or 'b"), () => api.fileMeta("../x"), () => api.download(""), () => api.exportMarkdown("a b")]) {
    assert.deepEqual(await call(), { ok: false, reason: "not-found" });
  }
  assert.equal(calls.length, 0);
});

test("an expired token is refreshed once and the request repeated", async () => {
  const { api, calls, tokenCalls } = setup({
    tokens: [{ ok: true, token: "stale" }, { ok: true, token: ACCESS }],
    routes: [answer(401, { error: { code: 401 } }), answer(200, { files: [] })],
  });

  assert.equal((await api.listChildren(FOLDER)).ok, true);
  assert.deepEqual(tokenCalls, [{}, { force: true }]);
  assert.deepEqual(calls.map((call) => call.authorization), ["Bearer stale", `Bearer ${ACCESS}`]);
});

test("a second 401 is not connected, and no third request is made", async () => {
  const { api, calls } = setup({
    routes: [answer(401, {}), answer(401, {})],
  });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 2);
});

test("a rate limit is waited out once, then reported", async () => {
  const limited = () => answer(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } });
  const { api, calls, slept } = setup({ routes: [limited(), limited()] });

  assert.deepEqual(await api.fileMeta("f1"), { ok: false, reason: "rate-limited" });
  assert.equal(calls.length, 2);
  assert.deepEqual(slept, [1500]);
});

test("a rate limit that clears on the retry succeeds", async () => {
  const { api } = setup({
    routes: [answer(429, {}), answer(200, { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r1" })],
  });
  const meta = await api.fileMeta("f1");
  assert.equal(meta.ok, true);
  assert.equal(meta.file.headRevisionId, "r1");
});

test("no token is not connected, with no request", async () => {
  const { api, calls } = setup({ tokens: [{ ok: false, reason: "not-connected" }] });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "not-connected" });
  assert.equal(calls.length, 0);
});

test("downloads and exports bytes", async () => {
  const { api, calls } = setup({
    routes: [answer(200, null, { bytes: Buffer.from("hello") }), answer(200, null, { bytes: Buffer.from("# Doc") })],
  });

  const downloaded = await api.download("f1");
  assert.equal(Buffer.isBuffer(downloaded.bytes), true);
  assert.equal(downloaded.bytes.toString(), "hello");
  assert.equal((await api.exportMarkdown("g1")).bytes.toString(), "# Doc");
  assert.equal(new URL(calls[0].url).searchParams.get("alt"), "media");
  assert.match(calls[1].url, /\/files\/g1\/export\?/);
});

test("lists every Shared Drive", async () => {
  const { api } = setup({
    routes: [answer(200, { nextPageToken: "p2", drives: [{ id: "d1", name: "Team" }] }), answer(200, { drives: [{ id: "d2", name: "Ops" }] })],
  });
  assert.deepEqual(await api.sharedDrives(), { ok: true, drives: [{ id: "d1", name: "Team" }, { id: "d2", name: "Ops" }] });
});

test("an answer in an unknown shape is offline, logged without the URL", async () => {
  const { api, logs } = setup({ routes: [answer(200, { files: "nope" })] });
  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "offline" });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(FOLDER));
});

test("an unreachable Drive is offline, logged with no URL, token or message", async () => {
  const { api, logs } = setup({
    routes: [
      () => {
        throw Object.assign(new Error(`failed https://www.googleapis.com/drive/v3/files?q=${FOLDER} ${ACCESS}`), {
          code: "ERR_INTERNET_DISCONNECTED",
        });
      },
    ],
  });

  assert.deepEqual(await api.listChildren(FOLDER), { ok: false, reason: "offline" });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(FOLDER) && !logs[0].includes(ACCESS) && !logs[0].includes("googleapis"));
  assert.match(logs[0], /ERR_INTERNET_DISCONNECTED/);
});

test("statuses map through driveErrorFor", async () => {
  const { api } = setup({ routes: [answer(404, {})] });
  assert.deepEqual(await api.download("f1"), { ok: false, reason: "not-found" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL - `Cannot find module '../src/googleDriveApi'`.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/googleDriveApi.js`:

```js
"use strict";

const {
  DriveFileListSchema,
  DriveFileSchema,
  SharedDriveListSchema,
  childrenUrl,
  driveErrorFor,
  exportUrl,
  fileUrl,
  isDriveId,
  mediaUrl,
  sharedDrivesUrl,
} = require("@trypthos/domain");

/// The calls to Google Drive, and nothing else.
///
/// **Main process only**, like the GitHub client: the access token comes from `googleAuth.js` and
/// never leaves this process. Addresses, schemas and what a status means are in the domain; what is
/// here is the request, the token, the retries, and turning exceptions into results.
///
/// **Nothing here throws outward**, and no log line carries a URL (it holds a folder id), a token or
/// an error's message - only what failed and an error code.

const DEFAULT_TIMEOUT_MS = 30_000;
/// A bound on effort, not a belief about folder sizes: 50 pages of 1000 is far past what a tree can
/// usefully show.
const MAX_PAGES = 50;
const RETRY_DELAY_MS = 1_000;

function failure(reason) {
  return { ok: false, reason };
}

function createGoogleDriveApi({
  accessToken,
  fetch = globalThis.fetch,
  logger = console,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  function codeOf(error) {
    return error?.code ?? error?.name ?? "error";
  }

  async function send(url, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timed out")), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      logger.error?.(`A request to Google Drive did not complete: ${codeOf(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /// One GET, with at most one retry after refreshing an expired token and one after waiting out a
  /// rate limit. Answers `{ ok: true, response }` or a failure.
  async function get(url) {
    let token = await accessToken();
    if (!token.ok) return token;

    let refreshed = false;
    let waited = false;
    for (;;) {
      const response = await send(url, token.token);
      if (response === null) return failure("offline");
      if (response.ok) return { ok: true, response };

      const body = await response.json().catch(() => null);
      const reason = driveErrorFor(response.status, body);
      if (reason === "not-connected" && !refreshed) {
        refreshed = true;
        token = await accessToken({ force: true });
        if (!token.ok) return token;
        continue;
      }
      if (reason === "rate-limited" && !waited) {
        waited = true;
        await sleep(RETRY_DELAY_MS + Math.floor(random() * RETRY_DELAY_MS));
        continue;
      }
      return failure(reason);
    }
  }

  async function getJson(url, schema) {
    const got = await get(url);
    if (!got.ok) return got;

    let body;
    try {
      body = await got.response.json();
    } catch {
      logger.error?.("Google Drive answered with something that is not JSON.");
      return failure("offline");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logger.error?.("Google Drive answered in a shape this build does not recognise.");
      return failure("offline");
    }
    return { ok: true, value: parsed.data };
  }

  async function getBytes(url) {
    const got = await get(url);
    if (!got.ok) return got;
    try {
      return { ok: true, bytes: Buffer.from(await got.response.arrayBuffer()) };
    } catch (error) {
      logger.error?.(`A download from Google Drive did not complete: ${codeOf(error)}`);
      return failure("offline");
    }
  }

  async function listChildren(folderId, { foldersOnly = false } = {}) {
    if (!isDriveId(folderId)) return failure("not-found");
    const files = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await getJson(childrenUrl(folderId, pageToken, foldersOnly), DriveFileListSchema);
      if (!answer.ok) return answer;
      files.push(...answer.value.files);
      pageToken = answer.value.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return { ok: true, files };
  }

  async function fileMeta(id) {
    if (!isDriveId(id)) return failure("not-found");
    const answer = await getJson(fileUrl(id), DriveFileSchema);
    return answer.ok ? { ok: true, file: answer.value } : answer;
  }

  async function download(id) {
    if (!isDriveId(id)) return failure("not-found");
    return getBytes(mediaUrl(id));
  }

  async function exportMarkdown(id) {
    if (!isDriveId(id)) return failure("not-found");
    return getBytes(exportUrl(id));
  }

  async function sharedDrives() {
    const drives = [];
    let pageToken = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await getJson(sharedDrivesUrl(pageToken), SharedDriveListSchema);
      if (!answer.ok) return answer;
      drives.push(...answer.value.drives.map((drive) => ({ id: drive.id, name: drive.name })));
      pageToken = answer.value.nextPageToken ?? null;
      if (pageToken === null) break;
    }
    return { ok: true, drives };
  }

  return { listChildren, fileMeta, download, exportMarkdown, sharedDrives };
}

module.exports = { createGoogleDriveApi };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace trypthos-desktop` then `npm run lint`
Expected: all shell tests PASS, output pristine; lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/googleDriveApi.js apps/desktop/test/googleDriveApi.test.js
git commit -m "desktop: the Google Drive client, with one auth retry and one rate-limit retry"
```

---

### Task 3: Shell - `googleDriveWorkspace.js`, the provider

**Files:**
- Create: `apps/desktop/src/googleDriveWorkspace.js`, `apps/desktop/test/googleDriveWorkspace.test.js`

**Interfaces:**
- Consumes: Task 1 (`childrenToEntries`, `FOLDER_MIME`, `createPathGuard`, `decodeTextFile`, `MAX_TEXT_FILE_BYTES` - the last three already exist in the domain), Task 2's api shape.
- Produces: `openGoogleDriveWorkspace({ ref, api })` -> `{ ok: true, name, provider }` or failure; provider `{ id, kind: "google-drive", list, read, readBytes, write, refresh }`; `GUARD_ROOT = "/drive"`.
  - `list(path)` -> `{ ok: true, nodes: { id, name, kind }[] }` (ids are workspace-relative paths)
  - `read(path)` -> `{ ok: true, content, revision: { id } }` or failure (`too-large` carries `sizeBytes`, `limitBytes`)
  - `readBytes(path, limitBytes)` -> `{ ok: true, bytes: Buffer }` or failure
  - `write()` -> `{ ok: false, reason: "read-only" }`
  - `refresh()` -> `{ ok: true, truncated: false }`

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/googleDriveWorkspace.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { openGoogleDriveWorkspace } = require("../src/googleDriveWorkspace");

/// A Drive folder as a workspace, over a fake Drive client.
///
/// Drive names files by id; the tree names them by path. What is under test is the map between the
/// two: filled as folders are listed, resolved on demand for a path nobody has listed yet, and
/// never allowed to reach outside the workspace.

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const REF = { kind: "google-drive", folderId: "rootAAA", name: "Notes" };

const DRIVE = {
  rootAAA: [
    { id: "dirBBB", name: "Archive", mimeType: FOLDER },
    { id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", size: "5", headRevisionId: "rev1" },
    { id: "docDDD", name: "Meeting", mimeType: DOC, modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "pngEEE", name: "chart.png", mimeType: "image/png", size: "4" },
    { id: "bigFFF", name: "huge.md", mimeType: "text/markdown", size: String(17 * 1024 * 1024) },
  ],
  dirBBB: [{ id: "oldGGG", name: "Old.md", mimeType: "text/markdown", size: "3", headRevisionId: "rev2" }],
};

const BYTES = { mdCCC: Buffer.from("hello"), oldGGG: Buffer.from("old"), pngEEE: Buffer.from([1, 2, 3, 4]) };

function fakeApi(overrides = {}) {
  const calls = { list: [], download: [], export: [] };
  const api = {
    fileMeta: async (id) =>
      id === "rootAAA" ? { ok: true, file: { id, name: "Notes (renamed)", mimeType: FOLDER } } : { ok: false, reason: "not-found" },
    listChildren: async (id) => {
      calls.list.push(id);
      return DRIVE[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, files: DRIVE[id] };
    },
    download: async (id) => {
      calls.download.push(id);
      return BYTES[id] === undefined ? { ok: false, reason: "not-found" } : { ok: true, bytes: BYTES[id] };
    },
    exportMarkdown: async (id) => {
      calls.export.push(id);
      return { ok: true, bytes: Buffer.from("# Meeting") };
    },
    ...overrides,
  };
  return { api, calls };
}

async function open(overrides) {
  const { api, calls } = fakeApi(overrides);
  const opened = await openGoogleDriveWorkspace({ ref: REF, api });
  assert.equal(opened.ok, true);
  return { provider: opened.provider, name: opened.name, calls };
}

test("opens a folder under its current name", async () => {
  const { name, provider } = await open();
  assert.equal(name, "Notes (renamed)");
  assert.equal(provider.kind, "google-drive");
});

test("refuses to open something that is not a folder, or is in the trash", async () => {
  for (const file of [
    { id: "rootAAA", name: "x.md", mimeType: "text/markdown" },
    { id: "rootAAA", name: "Notes", mimeType: FOLDER, trashed: true },
  ]) {
    const { api } = fakeApi({ fileMeta: async () => ({ ok: true, file }) });
    assert.deepEqual(await openGoogleDriveWorkspace({ ref: REF, api }), { ok: false, reason: "not-found" });
  }
});

test("passes on a failure to reach the folder", async () => {
  const { api } = fakeApi({ fileMeta: async () => ({ ok: false, reason: "not-connected" }) });
  assert.deepEqual(await openGoogleDriveWorkspace({ ref: REF, api }), { ok: false, reason: "not-connected" });
});

test("lists the root as tree nodes", async () => {
  const { provider } = await open();
  const listed = await provider.list("");
  assert.deepEqual(listed, {
    ok: true,
    nodes: [
      { id: "Archive", name: "Archive", kind: "directory" },
      { id: "chart.png", name: "chart.png", kind: "file" },
      { id: "huge.md", name: "huge.md", kind: "file" },
      { id: "Meeting.md", name: "Meeting.md", kind: "file" },
      { id: "Plan.md", name: "Plan.md", kind: "file" },
    ],
  });
});

test("lists a subfolder by the id its listing recorded", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const listed = await provider.list("Archive");
  assert.deepEqual(listed.nodes, [{ id: "Archive/Old.md", name: "Old.md", kind: "file" }]);
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB"]);
});

test("reads a file, with its head revision", async () => {
  const { provider } = await open();
  await provider.list("");
  assert.deepEqual(await provider.read("Plan.md"), { ok: true, content: "hello", revision: { id: "rev1" } });
});

test("reads a Google Doc as exported markdown", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  assert.deepEqual(await provider.read("Meeting.md"), {
    ok: true,
    content: "# Meeting",
    revision: { id: "modified:2026-10-01T00:00:00Z" },
  });
  assert.deepEqual(calls.export, ["docDDD"]);
  assert.deepEqual(calls.download, []);
});

// A tab restored at launch, or a link followed from another note, names a path whose folder has not
// been listed this session. The provider walks to it rather than calling it missing.
test("reads a path nobody has listed yet by listing its way there", async () => {
  const { provider, calls } = await open();
  assert.deepEqual(await provider.read("Archive/Old.md"), { ok: true, content: "old", revision: { id: "rev2" } });
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB"]);
});

test("a path that is not there is not found", async () => {
  const { provider } = await open();
  assert.deepEqual(await provider.read("Missing.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Plan.md/inside"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.list("Plan.md"), { ok: false, reason: "not-found" });
  assert.deepEqual(await provider.read("Archive"), { ok: false, reason: "not-found" });
});

test("a path outside the workspace is refused before Drive is asked", async () => {
  const { provider, calls } = await open();
  for (const escape of ["../x.md", "/etc/passwd", "C:\\x.md", "Archive/../../x.md"]) {
    assert.deepEqual(await provider.read(escape), { ok: false, reason: "permission-denied" });
  }
  assert.deepEqual(await provider.list("../"), { ok: false, reason: "permission-denied" });
  assert.deepEqual(calls.list, []);
});

test("a file over the limit is refused from its listed size, before downloading", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  const read = await provider.read("huge.md");
  assert.equal(read.ok, false);
  assert.equal(read.reason, "too-large");
  assert.equal(read.sizeBytes, 17 * 1024 * 1024);
  assert.deepEqual(calls.download, []);
});

test("reads the bytes of an image, within the caller's limit", async () => {
  const { provider } = await open();
  await provider.list("");
  const bytes = await provider.readBytes("chart.png", 1024);
  assert.equal(Buffer.isBuffer(bytes.bytes), true);
  assert.equal(bytes.bytes.length, 4);
  assert.equal((await provider.readBytes("chart.png", 2)).reason, "too-large");
});

test("writing is refused: this release opens Drive read-only", async () => {
  const { provider } = await open();
  await provider.list("");
  assert.deepEqual(await provider.write("Plan.md", "changed", { id: "rev1" }), { ok: false, reason: "read-only" });
});

// A refresh lists the root before the folders under it. Re-listing a folder must replace only its
// own children, or an open file under an expanded folder would briefly be unreadable.
test("re-listing a folder keeps what was learned about the folders under it", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  await provider.list("Archive");
  await provider.list("");
  assert.equal((await provider.read("Archive/Old.md")).ok, true);
  assert.deepEqual(calls.list, ["rootAAA", "dirBBB", "rootAAA"]);
});

test("re-listing drops a child that has gone", async () => {
  const { provider } = await open({
    listChildren: (() => {
      let first = true;
      return async (id) => {
        if (id !== "rootAAA") return { ok: true, files: [] };
        const files = first ? DRIVE.rootAAA : DRIVE.rootAAA.filter((file) => file.id !== "mdCCC");
        first = false;
        return { ok: true, files };
      };
    })(),
  });
  await provider.list("");
  await provider.list("");
  assert.deepEqual(await provider.read("Plan.md"), { ok: false, reason: "not-found" });
});

test("refresh forgets every path, so the next read asks Drive again", async () => {
  const { provider, calls } = await open();
  await provider.list("");
  assert.deepEqual(await provider.refresh(), { ok: true, truncated: false });
  await provider.read("Plan.md");
  assert.deepEqual(calls.list, ["rootAAA", "rootAAA"]);
});

test("a listing failure passes through", async () => {
  const { provider } = await open({ listChildren: async () => ({ ok: false, reason: "rate-limited" }) });
  assert.deepEqual(await provider.list(""), { ok: false, reason: "rate-limited" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace trypthos-desktop`
Expected: FAIL - `Cannot find module '../src/googleDriveWorkspace'`.

- [ ] **Step 3: Write the implementation**

Create `apps/desktop/src/googleDriveWorkspace.js`:

```js
"use strict";

const {
  FOLDER_MIME,
  MAX_TEXT_FILE_BYTES,
  childrenToEntries,
  createPathGuard,
  decodeTextFile,
} = require("@trypthos/domain");

/// A Google Drive folder, as a workspace.
///
/// Drive names a file by id; the tree, the editor, recent files and wiki links all name it by path.
/// This keeps the map between the two, filled as folders are listed (`childrenToEntries` decides the
/// names) and walked on demand for a path no listing has reached yet - a restored tab, a followed
/// link. Read-only in this release: `write` refuses.
///
/// The path guard is the shared one, over a root that exists nowhere - the same arrangement as
/// GitHub's `/repo` - so `..`, absolute and drive-qualified paths are refused here exactly as they
/// are for a folder on disk.

const GUARD_ROOT = "/drive";

function failure(reason) {
  return { ok: false, reason };
}

function parentOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function createGoogleDriveProvider({ ref, api }) {
  const guard = createPathGuard({ root: GUARD_ROOT, caseInsensitive: false });
  /// Workspace-relative path -> `DriveEntry`. The root is not in it: its id is the ref's.
  const entries = new Map();

  /// The workspace-relative form of a candidate path, "" for the root, or null when it escapes.
  function drivePath(candidate) {
    const resolved = guard.resolve(candidate === "" ? "." : candidate);
    if (!resolved.ok) return null;
    if (resolved.path === GUARD_ROOT) return "";
    return resolved.path.slice(GUARD_ROOT.length + 1);
  }

  /// Lists one folder and records its children, replacing only that folder's direct children - what
  /// is known about the folders below them stays.
  async function listInto(path, folderId) {
    const listed = await api.listChildren(folderId);
    if (!listed.ok) return listed;

    for (const key of [...entries.keys()]) {
      if (parentOf(key) === path) entries.delete(key);
    }
    const children = childrenToEntries(path, listed.files);
    for (const child of children) entries.set(child.path, child);
    return { ok: true, children };
  }

  /// The entry at a non-root path, listing its way down from the nearest known folder if needed.
  async function ensure(path) {
    const known = entries.get(path);
    if (known !== undefined) return { ok: true, entry: known };

    const parent = parentOf(path);
    let folderId = ref.folderId;
    if (parent !== "") {
      const up = await ensure(parent);
      if (!up.ok) return up;
      if (up.entry.kind !== "directory") return failure("not-found");
      folderId = up.entry.fileId;
    }

    const listed = await listInto(parent, folderId);
    if (!listed.ok) return listed;
    const entry = entries.get(path);
    return entry === undefined ? failure("not-found") : { ok: true, entry };
  }

  async function fileAt(candidate) {
    const path = drivePath(candidate);
    if (path === null || path === "") return failure("permission-denied");
    const found = await ensure(path);
    if (!found.ok) return found;
    return found.entry.kind === "file" ? found : failure("not-found");
  }

  /// A file's bytes, refused by its listed size before anything is downloaded, and by its real size
  /// after (a Google Doc has no listed size).
  async function bytesOf(entry, limitBytes) {
    if (entry.sizeBytes !== null && entry.sizeBytes > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: entry.sizeBytes, limitBytes };
    }
    const fetched = entry.googleDoc ? await api.exportMarkdown(entry.fileId) : await api.download(entry.fileId);
    if (!fetched.ok) return fetched;
    if (fetched.bytes.length > limitBytes) {
      return { ok: false, reason: "too-large", sizeBytes: fetched.bytes.length, limitBytes };
    }
    return fetched;
  }

  return {
    id: ref.folderId,
    kind: "google-drive",

    async list(candidate) {
      const path = drivePath(candidate);
      if (path === null) return failure("permission-denied");

      let folderId = ref.folderId;
      if (path !== "") {
        const found = await ensure(path);
        if (!found.ok) return found;
        if (found.entry.kind !== "directory") return failure("not-found");
        folderId = found.entry.fileId;
      }

      const listed = await listInto(path, folderId);
      if (!listed.ok) return listed;
      return {
        ok: true,
        nodes: listed.children.map((child) => ({ id: child.path, name: child.name, kind: child.kind })),
      };
    },

    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      const fetched = await bytesOf(found.entry, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      return { ok: true, content: decoded.content, revision: { id: found.entry.revision ?? found.entry.fileId } };
    },

    async readBytes(candidate, limitBytes) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      return bytesOf(found.entry, limitBytes);
    },

    /// Saving to Drive is the next release. Refused here as well as in the interface, because the
    /// chat's tools write through the provider too.
    async write() {
      return failure("read-only");
    },

    async refresh() {
      entries.clear();
      return { ok: true, truncated: false };
    },
  };
}

/// Opens a Drive folder: it must exist, be a folder, and not be in the trash. Answers its CURRENT
/// name - the one in the reference is what it was called when it was chosen.
async function openGoogleDriveWorkspace({ ref, api }) {
  const meta = await api.fileMeta(ref.folderId);
  if (!meta.ok) return meta;
  if (meta.file.mimeType !== FOLDER_MIME || meta.file.trashed === true) return failure("not-found");
  return { ok: true, name: meta.file.name, provider: createGoogleDriveProvider({ ref, api }) };
}

module.exports = { openGoogleDriveWorkspace, GUARD_ROOT };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace trypthos-desktop` then `npm run lint`
Expected: PASS, pristine; lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/googleDriveWorkspace.js apps/desktop/test/googleDriveWorkspace.test.js
git commit -m "desktop: a Drive folder as a read-only workspace, mapping paths to Drive ids"
```

---

### Task 4: The `google-drive` workspace kind, end to end

This task widens `WorkspaceRef`, so it has to land the opener and every exhaustive renderer switch in the same commit or typecheck goes red.

**Files:**
- Modify: `packages/domain/src/workspaceRef.ts` (+ `workspaceRef.test.ts`), `packages/domain/src/settings.ts` (+ `settings.test.ts`), `packages/domain/src/index.ts`
- Modify: `apps/desktop/src/providers.js` (+ `test/providers.test.js`), `apps/desktop/src/ipcHandlers.js`, `apps/desktop/src/main.js`
- Create: `apps/desktop/test/googleDriveIpc.test.js`
- Modify: `apps/app/src/index.css`, `apps/app/src/components/WorkspacePanel.tsx` (+ its test), `apps/app/src/components/WorkspaceHome.tsx`, `apps/app/src/hooks/useWorkspace.test.ts` (fake `openWorkspaceRef`), `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: `DriveIdSchema` (Task 1), `createGoogleDriveApi` (Task 2), `openGoogleDriveWorkspace` (Task 3), PR 1's `google.accessToken`.
- Produces:
  - `GoogleDriveWorkspaceRefSchema` = `{ kind: "google-drive", folderId: DriveId, driveId?: DriveId, name: string(min 1) }` strict; `PROVIDER_KINDS = ["local", "github", "google-drive"]`
  - `workspaceRefName` -> `name`; `workspaceRefKey` -> `google-drive:<folderId>`; `workspaceRefLabel` -> `Google Drive / <name>`
  - `SETTINGS_VERSION = 23`
  - `registerIpcHandlers({ ..., createGoogleDrive = null })`; `providerDeps = { github, drive }`
  - Renderer: `WorkspaceMark` includes `"google-drive"`; `SourceGlyph` draws it with `data-mark="google-drive"`; `sourceColour("google-drive") === "text-drive"`

- [ ] **Step 1: Write the failing tests**

In `packages/domain/src/workspaceRef.test.ts`, add (import `PROVIDER_KINDS`, `WorkspaceRefSchema`, `workspaceRefKey`, `workspaceRefLabel`, `workspaceRefMark`, `workspaceRefName`, `sameWorkspaceRef` as the file already does):

```ts
describe("a Google Drive folder", () => {
  const ref = { kind: "google-drive" as const, folderId: "1H60yEnI5d4", name: "Notes" };

  it("parses, with or without the Shared Drive it lives in", () => {
    expect(WorkspaceRefSchema.parse(ref)).toEqual(ref);
    expect(WorkspaceRefSchema.parse({ ...ref, driveId: "0AbcDEF" })).toEqual({ ...ref, driveId: "0AbcDEF" });
  });

  // Ids reach a Drive query string; the schema is the boundary that keeps them ids.
  it("refuses an id that is not a Drive id, and an unknown field", () => {
    expect(WorkspaceRefSchema.safeParse({ ...ref, folderId: "a' or 'b" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, driveId: "../x" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, name: "" }).success).toBe(false);
    expect(WorkspaceRefSchema.safeParse({ ...ref, extra: 1 }).success).toBe(false);
  });

  it("is named, keyed, labelled and marked as a Drive folder", () => {
    expect(workspaceRefName(ref)).toBe("Notes");
    expect(workspaceRefKey(ref)).toBe("google-drive:1H60yEnI5d4");
    expect(workspaceRefLabel(ref)).toBe("Google Drive / Notes");
    expect(workspaceRefMark(ref)).toBe("google-drive");
    expect(PROVIDER_KINDS).toContain("google-drive");
  });

  // The id is the folder; the name is only what it was called. A rename in Drive is the same folder.
  it("is the same workspace whatever it was called when chosen", () => {
    expect(sameWorkspaceRef(ref, { ...ref, name: "Renamed" })).toBe(true);
    expect(sameWorkspaceRef(ref, { ...ref, folderId: "1H60yEnI5d5" })).toBe(false);
  });
});
```

In `packages/domain/src/settings.test.ts`, add:

```ts
describe("version 23", () => {
  it("remembers a Google Drive folder", () => {
    const drive = { kind: "google-drive" as const, folderId: "1H60yEnI5d4", name: "Notes" };
    const settings = loadSettings({ ...DEFAULT_SETTINGS, workspaces: [drive] });
    expect(settings.workspaces).toEqual([drive]);
  });

  it("leaves the workspaces remembered before version 23 exactly as they were", () => {
    const before = { ...DEFAULT_SETTINGS, schemaVersion: 22, workspaces: [{ kind: "local" as const, root: "/v/Notes" }] };
    const loaded = loadSettings(before);
    expect(loaded.schemaVersion).toBe(SETTINGS_VERSION);
    expect(SETTINGS_VERSION).toBe(23);
    expect(loaded.workspaces).toEqual([{ kind: "local", root: "/v/Notes" }]);
  });
});
```

In `apps/desktop/test/providers.test.js`, add (the file's existing "every provider kind the domain names can be opened" test now also requires the new opener):

```js
const { openWorkspaceFor } = require("../src/providers");

test("opens a Google Drive folder through the Drive client, under its current name", async () => {
  const drive = {
    fileMeta: async () => ({ ok: true, file: { id: "rootAAA", name: "Notes now", mimeType: "application/vnd.google-apps.folder" } }),
    listChildren: async () => ({ ok: true, files: [] }),
  };
  const opened = await openWorkspaceFor({ kind: "google-drive", folderId: "rootAAA", name: "Notes then" }, { drive });

  assert.equal(opened.ok, true);
  assert.equal(opened.workspace.name, "Notes now");
  assert.equal(opened.workspace.root, null);
  assert.equal(opened.workspace.vault, false);
  assert.equal(opened.workspace.provider.kind, "google-drive");
});

test("a Drive folder in a build without Google answers not configured", async () => {
  assert.deepEqual(await openWorkspaceFor({ kind: "google-drive", folderId: "rootAAA", name: "Notes" }, {}), {
    ok: false,
    reason: "not-configured",
  });
});
```

(If `openWorkspaceFor` is already imported at the top of that file, do not import it twice.)

Create `apps/desktop/test/googleDriveIpc.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers } = require("../src/ipcHandlers");

/// A Drive folder through the real handlers: opened by reference, listed and read through the same
/// channels as every other workspace, and refused a write.

const FOLDER = "application/vnd.google-apps.folder";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  };
}

/// The Drive client factory, as `main.js` passes it: built over an access-token supplier.
function fakeDriveFactory(seen = {}) {
  return (accessToken) => {
    seen.accessToken = accessToken;
    return {
      fileMeta: async () => ({ ok: true, file: { id: "rootAAA", name: "Notes", mimeType: FOLDER } }),
      listChildren: async (id) =>
        id === "rootAAA"
          ? { ok: true, files: [{ id: "mdCCC", name: "Plan.md", mimeType: "text/markdown", size: "5", headRevisionId: "rev1" }] }
          : { ok: false, reason: "not-found" },
      download: async () => ({ ok: true, bytes: Buffer.from("hello") }),
      exportMarkdown: async () => ({ ok: false, reason: "not-found" }),
      sharedDrives: async () => ({ ok: true, drives: [] }),
    };
  };
}

async function withHandlers(body, { google = { accessToken: async () => ({ ok: true, token: "t" }) }, createGoogleDrive = fakeDriveFactory() } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-drive-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: { endpointsWithKeys: async () => [], setKey: async () => ({ ok: true }), deleteKey: async () => {}, retainOnly: async () => {} },
      accounts: null,
      google,
      createGoogleDrive,
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });
    await body({ ipcMain });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("opens a Drive folder by reference and reads it like any other workspace", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootAAA", name: "Notes" } });
    assert.equal(opened.ok, true);
    assert.equal(opened.workspace.name, "Notes");
    assert.deepEqual(opened.workspace.ref, { kind: "google-drive", folderId: "rootAAA", name: "Notes" });

    const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
    assert.deepEqual(listed.nodes.map((node) => node.id), [`${opened.workspace.id}/Plan.md`]);

    const read = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/Plan.md` });
    assert.equal(read.content, "hello");

    const written = await ipcMain.invoke("file:write", {
      path: `${opened.workspace.id}/Plan.md`,
      content: "changed",
      expectedRevision: { id: "rev1" },
      message: null,
    });
    assert.deepEqual(written, { ok: false, reason: "read-only" });
  });
});

test("the Drive client is built over the Google account's access token", async () => {
  const seen = {};
  const google = { accessToken: async (options) => ({ ok: true, token: options?.force ? "forced" : "plain" }) };
  await withHandlers(async () => {
    assert.equal(typeof seen.accessToken, "function");
    assert.deepEqual(await seen.accessToken(), { ok: true, token: "plain" });
    assert.deepEqual(await seen.accessToken({ force: true }), { ok: true, token: "forced" });
  }, { google, createGoogleDrive: fakeDriveFactory(seen) });
});

test("a build without Google cannot open a Drive folder", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "google-drive", folderId: "rootAAA", name: "Notes" } });
      assert.deepEqual(opened, { ok: false, reason: "not-configured" });
    },
    { google: null },
  );
});
```

In the renderer, find the existing `WorkspacePanel` test file (`apps/app/src/components/WorkspacePanel.test.tsx`) and add, following the file's own render helper for a workspace row:

```tsx
it("marks a Google Drive folder with Drive's glyph and colour", async () => {
  // Use the file's existing helper to render one workspace row, with
  // ref: { kind: "google-drive", folderId: "1H60yEnI5d4", name: "Notes" }, name "Notes".
  // Then:
  const mark = container.querySelector('[data-mark="google-drive"]');
  expect(mark).not.toBeNull();
  expect(mark!.getAttribute("class") ?? "").toContain("text-drive");
});
```

Write it against the helper the file already uses for the GitHub/Obsidian mark tests (search the file for `data-mark`); the assertions above are the requirement.

- [ ] **Step 2: Run the tests to verify they fail**

Run: from `packages/domain` `node ../../node_modules/vitest/vitest.mjs run workspaceRef settings`; `npm test --workspace trypthos-desktop`; from `apps/app` `node ../../node_modules/vitest/vitest.mjs run WorkspacePanel`
Expected: FAIL - the ref does not parse, settings version is 22, the opener is missing, the IPC test cannot open the ref, no `google-drive` mark.

- [ ] **Step 3: Write the implementation**

**`packages/domain/src/workspaceRef.ts`:**
- Add `import { DriveIdSchema } from "./googleDrive";`
- Add, after `GitHubWorkspaceRefSchema`:

```ts
export const GoogleDriveWorkspaceRefSchema = z
  .object({
    kind: z.literal("google-drive"),
    /// The folder's Drive id. Opaque, and stable across a rename or a move.
    folderId: DriveIdSchema,
    /// The Shared Drive the folder lives in, or absent for My Drive.
    driveId: DriveIdSchema.optional(),
    /// What the folder was called when it was chosen. Display only - a rename in Drive makes it
    /// stale, and the shell reads the real name when the folder opens.
    name: z.string().min(1),
  })
  .strict();
```

- Add it to `WorkspaceRefSchema`'s union list, and change `PROVIDER_KINDS` to `["local", "github", "google-drive"]`.
- Replace `workspaceRefName`, `workspaceRefKey` and `workspaceRefLabel` bodies with exhaustive switches (keep their doc comments, and add one line to `workspaceRefKey`'s saying a Drive folder is keyed by its id, unfolded, because Drive ids are case-sensitive):

```ts
export function workspaceRefName(ref: WorkspaceRef): string {
  switch (ref.kind) {
    case "github":
      return ref.repo;
    case "google-drive":
      return ref.name;
    case "local":
      // A drive root has no segment to take, and an empty name would leave the workspace called
      // "Folder" - which says less than "D:\" does.
      return lastSegment(ref.root) || ref.root;
  }
}

export function workspaceRefKey(ref: WorkspaceRef): string {
  switch (ref.kind) {
    case "github":
      return `github:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`;
    case "google-drive":
      return `google-drive:${ref.folderId}`;
    case "local":
      return `local:${ref.root}`;
  }
}

export function workspaceRefLabel(ref: WorkspaceRef): string {
  switch (ref.kind) {
    case "github":
      return `${ref.owner}/${ref.repo}`;
    case "google-drive":
      return `Google Drive / ${ref.name}`;
    case "local":
      return ref.root;
  }
}
```

- Export `GoogleDriveWorkspaceRefSchema` from `index.ts` beside the other ref schemas.

**`packages/domain/src/settings.ts`:** `SETTINGS_VERSION = 23`, and at the top of `SETTINGS_MIGRATIONS`:

```ts
  {
    to: 23,
    // Version 23 lets a remembered workspace be a Google Drive folder. Nothing already remembered
    // changes. The version is for the OTHER direction, as with 18: the reference is strict, so a file
    // naming a Drive folder, read by the previous build, would fail to parse and take every
    // remembered workspace with it - this makes that build refuse the file instead.
    migrate: (input) => input,
  },
```

**`apps/desktop/src/providers.js`:** require `openGoogleDriveWorkspace` from `./googleDriveWorkspace`, add the opener, register it, and add a row to the record-contract doc comment if it lists providers:

```js
/// A Google Drive folder. Read through the Drive client the handlers built over the Google account;
/// a build without a Google OAuth client has none, which is "not configured" rather than
/// "unsupported" - the interface words that as a build without Google Drive.
async function openGoogleDrive(ref, { drive }) {
  if (!drive) return { ok: false, reason: "not-configured" };
  const opened = await openGoogleDriveWorkspace({ ref, api: drive });
  if (!opened.ok) return opened;
  return {
    ok: true,
    workspace: { ref, name: opened.name, root: null, guard: null, provider: opened.provider, vault: false },
  };
}

const OPENERS = { local: openLocal, github: openGitHub, "google-drive": openGoogleDrive };
```

Check `openWorkspaceFor`: it spreads `opened.workspace` after `name: workspaceRefName(ref)`, so the opener's current `name` wins - confirm by reading it; if the order is the other way round, swap it so the opener's name wins.

**`apps/desktop/src/ipcHandlers.js`:** add a parameter directly after `google = null,`:

```js
  /// Builds the Google Drive client over an access-token supplier - `googleDriveApi.js` in the app.
  /// A factory, like `createGitHub`, so a test can hand in a fake. No client without `google`: a
  /// build with no OAuth client has no token to make one with.
  createGoogleDrive = null,
```

and replace `const providerDeps = { github };` with:

```js
  const drive =
    google === null || createGoogleDrive === null
      ? null
      : createGoogleDrive((options) => google.accessToken(options));

  /// The dependencies a provider is opened with. Built once, so `workspace:open`, `workspace:openRef`
  /// and anything after them cannot end up holding different clients.
  const providerDeps = { github, drive };
```

(The `github` client is created a few lines above `providerDeps`; `google` is a parameter, so the order works. If `providerDeps`'s existing comment is already there, keep one copy.)

**`apps/desktop/src/main.js`:** require `createGoogleDriveApi` from `./googleDriveApi`, and in the `registerIpcHandlers({...})` call directly after `google,` add:

```js
      // Every Drive call is made here, with the token googleAuth holds - net.fetch for the same proxy
      // and certificate reasons as GitHub.
      createGoogleDrive: (accessToken) =>
        createGoogleDriveApi({ accessToken, fetch: (url, options) => net.fetch(url, options) }),
```

**`apps/app/src/index.css`:** wherever `obsidian` appears (the `@theme inline` mapping and the three theme blocks), add a `drive` line beside it:
- `@theme inline`: `--color-drive: var(--tp-drive);`
- light block: `--tp-drive: #1a73e8;`
- both dark blocks (the media-query one and `[data-theme="dark"]`): `--tp-drive: #8ab4f8;`

**`apps/app/src/components/WorkspacePanel.tsx`:** add to `sourceColour`:

```ts
    case "google-drive":
      return "text-drive";
```

and to `SourceGlyph`:

```tsx
    case "google-drive":
      // Drive's triangle, as an outline with its three folds.
      return (
        <Glyph className={className} mark="google-drive">
          <path d="M8 3h8l6 11-3 6H5l-3-6Z" />
          <path d="m8 3 7 11H2m14-11-7 11-4 6m17-6H9" />
        </Glyph>
      );
```

**`apps/app/src/components/WorkspaceHome.tsx`:** replace the kind line's expression (currently `workspace.ref.kind === "github" ? t("home.kindRepository") : \`...${workspace.ref.root}\``) with:

```tsx
          {workspace.ref.kind === "github"
            ? t("home.kindRepository")
            : workspace.ref.kind === "google-drive"
              ? `${t("home.kindDrive")} - ${workspace.name}`
              : `${workspace.vault === true ? t("home.kindVault") : t("home.kindFolder")} - ${workspace.ref.root}`}
```

**`apps/app/src/locales/en.json`:** in `"home"`, after `"kindRepository"`, add `"kindDrive": "Google Drive folder",`.

**`apps/app/src/hooks/useWorkspace.test.ts`:** the fake `openWorkspaceRef` near the top branches `ref.kind === "github" ? ... : ref.root...`. Make it handle `"google-drive"` (name = `ref.name`) so it type-checks; follow its existing shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck`, `npm run lint`, `npm test`
Expected: all PASS, pristine. `theme.browser.test.tsx` (run in Task 7's full verification) checks every token is answered in each theme - the three `--tp-drive` lines are what it needs.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/workspaceRef.ts packages/domain/src/workspaceRef.test.ts packages/domain/src/settings.ts packages/domain/src/settings.test.ts packages/domain/src/index.ts apps/desktop/src/providers.js apps/desktop/test/providers.test.js apps/desktop/src/ipcHandlers.js apps/desktop/src/main.js apps/desktop/test/googleDriveIpc.test.js apps/app/src/index.css apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspaceHome.tsx apps/app/src/hooks/useWorkspace.test.ts apps/app/src/locales/en.json
git add -u apps/app/src/components
git commit -m "A Google Drive folder is a workspace kind: ref, settings v23, opener, mark"
```

---

### Task 5: Renderer - Drive files open read-only, and Drive failures name Google

**Files:**
- Modify: `apps/app/src/hooks/useWorkspace.ts` (+ `useWorkspace.test.ts`), `apps/app/src/hooks/useGoogle.ts`, `apps/app/src/locales/en.json`

**Interfaces:**
- Consumes: the `google-drive` kind (Task 4).
- Produces:
  - `export function providerFailureKey(kind: ProviderKind | null, reason: string): string | null` in `useWorkspace.ts`
  - `failureKey("read-only") === "errors.readOnly"`
  - A text document opened from a `google-drive` workspace has `readOnly: true`.

- [ ] **Step 1: Write the failing tests**

In `apps/app/src/hooks/useWorkspace.test.ts`, add (import `providerFailureKey` beside `failureKey`; use the file's `fakeClient` helper and its existing pattern for opening a workspace and a file - search for an existing `openPath` test and mirror it):

```ts
describe("providerFailureKey", () => {
  // The shared keys for these three name GitHub. A Drive failure must name Google.
  it("words a Drive workspace's connection failures for Google", () => {
    expect(providerFailureKey("google-drive", "offline")).toBe("errors.googleOffline");
    expect(providerFailureKey("google-drive", "rate-limited")).toBe("errors.googleRateLimited");
    expect(providerFailureKey("google-drive", "not-connected")).toBe("errors.googleNotConnected");
    expect(providerFailureKey("google-drive", "not-found")).toBe("errors.notFound");
  });

  it("leaves every other provider to failureKey", () => {
    expect(providerFailureKey("github", "offline")).toBe("errors.offline");
    expect(providerFailureKey(null, "offline")).toBe("errors.offline");
  });

  it("names a refused write", () => {
    expect(failureKey("read-only")).toBe("errors.readOnly");
  });
});
```

and two hook tests:

```ts
it("opens a file from a Google Drive folder read-only", async () => {
  // fakeClient whose openWorkspaceRef answers a workspace with
  // ref { kind: "google-drive", folderId: "1H60yEnI5d4", name: "Notes" } (id e.g. "Notes"),
  // and whose readFile answers { ok: true, content: "hello", revision: { id: "rev1" } }.
  // openRef(that ref), then openPath("Notes/Plan.md"). Then:
  expect(activeDocument.readOnly).toBe(true);
});

it("says a Drive folder could not be reached in Google's words", async () => {
  // fakeClient whose openWorkspaceRef answers { ok: false, reason: "offline" }.
  // openRef({ kind: "google-drive", folderId: "1H60yEnI5d4", name: "Notes" }). Then:
  expect(result.current.errorKey).toBe("errors.googleOffline");
});
```

Express "activeDocument" with whatever the file's existing tests use to read the open document (search for `readOnly` in the test file for the image case and mirror it). A local-folder file must still open with `readOnly: false` - assert that in the first test too, by opening a local file through the same client.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/app`): `node ../../node_modules/vitest/vitest.mjs run useWorkspace useGoogle`
Expected: FAIL - `providerFailureKey` is not exported; `read-only` maps to `errors.unknown`; the Drive file opens editable; the open failure says `errors.offline`.

- [ ] **Step 3: Write the implementation**

In `apps/app/src/hooks/useWorkspace.ts`:

1. In `failureKey`, before `default:`:

```ts
    // A provider that can be read and not written. Its own key, because the file is fine and so is
    // the user - Trypthos cannot save there yet.
    case "read-only":
      return "errors.readOnly";
```

2. Directly after `failureKey`, add (import `type ProviderKind` from `@trypthos/domain` if not already imported):

```ts
/// `failureKey`, worded for the provider the failure came from.
///
/// The shared keys for offline, rate-limited and not-connected name GitHub, which is the wrong
/// provider for a Google Drive folder or the Google account. Everything else is provider-neutral.
/// Null `kind` is a failure with no workspace to name.
export function providerFailureKey(kind: ProviderKind | null, reason: string): string | null {
  if (kind === "google-drive") {
    switch (reason) {
      case "offline":
        return "errors.googleOffline";
      case "rate-limited":
        return "errors.googleRateLimited";
      case "not-connected":
        return "errors.googleNotConnected";
    }
  }
  return failureKey(reason);
}
```

3. Add a helper beside `isKnownNonLocal`:

```ts
/// The provider a qualified path's workspace belongs to, or null when no open workspace claims it.
function kindOf(workspaces: readonly WorkspaceInfo[], qualified: string): ProviderKind | null {
  const workspaceId = splitQualified(qualified)?.workspaceId;
  return workspaces.find((candidate) => candidate.id === workspaceId)?.ref.kind ?? null;
}
```

4. Give `fail` an optional kind:

```ts
  const fail = useCallback(
    (result: { reason: string; sizeBytes?: number; limitBytes?: number }, kind: ProviderKind | null = null) => {
      setInternal((prev) => ({
        ...prev,
        busy: false,
        errorKey: providerFailureKey(kind, result.reason),
        errorParams: failureParams(result),
      }));
    },
    [],
  );
```

5. In `openRef`: `if (!result.ok) return fail(result, ref.kind);`
6. In `openPath`'s text branch: `if (!result.ok) return fail(result, kindOf(stateRef.current.workspaces, path));` and pass `readOnly` to `openDocument`:

```ts
        documents: openDocument(prev.documents, {
          path,
          content: result.content,
          revision: result.revision,
          // Saving to Google Drive is the next release; until then the editor does not let a user
          // type into a file it cannot save.
          readOnly: kindOf(stateRef.current.workspaces, path) === "google-drive",
        }),
```

   (Check `openDocument`'s parameter type accepts `readOnly` - the image branch already passes it. If the text call site's object type is narrower, widen it the way the image branch does.)

In `apps/app/src/hooks/useGoogle.ts`: delete the local `googleFailureKey` function and its comment; import `providerFailureKey` from `./useWorkspace` (replacing the `failureKey` import if nothing else uses it) and replace every `googleFailureKey(x)` with `providerFailureKey("google-drive", x)`.

In `apps/app/src/locales/en.json` `"errors"`, after `"notConfigured"`:

```json
    "readOnly": "Trypthos opens Google Drive folders read-only in this release, so this file cannot be saved there yet.",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck`, `npm run lint`, `npm test`
Expected: PASS, pristine, `i18nKeys` happy (the new key is referenced by `failureKey`'s literal).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/hooks/useWorkspace.ts apps/app/src/hooks/useWorkspace.test.ts apps/app/src/hooks/useGoogle.ts apps/app/src/locales/en.json
git commit -m "app: Drive files open read-only, and Drive failures are worded for Google"
```

---

### Task 6: The folder picker - `google:folders`, `OpenDriveDialog`, and the panel button

**Files:**
- Modify: `packages/domain/src/ipc.ts` (+ `ipc.test.ts`), `packages/domain/src/index.ts`
- Modify: `apps/desktop/src/ipcHandlers.js`, `apps/desktop/src/preload.js`, `apps/desktop/test/googleDriveIpc.test.js`, `apps/desktop/test/preloadBridge.test.js`
- Modify: `apps/app/src/lib/workspaceClient.ts`, `apps/app/src/components/GoogleAccountSection.tsx` (+ test), `apps/app/src/components/WorkspacePanel.tsx` (+ test), `apps/app/src/App.tsx`, `apps/app/src/locales/en.json`
- Create: `apps/app/src/components/OpenDriveDialog.tsx`, `apps/app/src/components/OpenDriveDialog.test.tsx`

**Interfaces:**
- Consumes: `DriveIdSchema`, `foldersOf` (Task 1); Drive client `listChildren(id, { foldersOnly: true })`, `sharedDrives()` (Task 2); `providerDeps.drive` (Task 4); `providerFailureKey` (Task 5).
- Produces:
  - `GoogleFoldersRequest = { parentId: DriveId | null }` strict; channel `"google:folders"` appended to `IPC_CHANNELS` after `"google:disconnect"`
  - Answer: `{ ok: true, folders: { id, name }[], drives: { id, name }[] }` (drives non-empty only when `parentId` is null) or `{ ok: false, reason }`
  - Bridge: `listDriveFolders(parentId: string | null): Promise<DriveFoldersResult>` on `GoogleBridge`
  - `GoogleAccountSection` prop `onConnected?: () => void`
  - `<OpenDriveDialog bridge onCancel onOpen />` where `onOpen(ref: WorkspaceRef)`
  - `WorkspacePanel` prop `onOpenDrive: () => void`

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/ipc.test.ts`: append `"google:folders",` after `"google:disconnect",` in the closed-list expectation, and add:

```ts
describe("GoogleFoldersRequest", () => {
  it("names a parent folder by Drive id, or null for the top level", () => {
    expect(GoogleFoldersRequest.parse({ parentId: null })).toEqual({ parentId: null });
    expect(GoogleFoldersRequest.parse({ parentId: "1H60yEnI5d4" })).toEqual({ parentId: "1H60yEnI5d4" });
  });

  it("refuses an id that is not a Drive id, and anything extra", () => {
    expect(GoogleFoldersRequest.safeParse({ parentId: "a' or 'b" }).success).toBe(false);
    expect(GoogleFoldersRequest.safeParse({ parentId: null, extra: 1 }).success).toBe(false);
    expect(GoogleFoldersRequest.safeParse({}).success).toBe(false);
  });
});
```

`apps/desktop/test/googleDriveIpc.test.js`: extend `fakeDriveFactory` so `listChildren(id, options)` records `options` and answers folders for `"root"` and for `"sharedDDD"`; then add:

```js
test("google:folders lists My Drive's folders and the Shared Drives at the top level", async () => {
  const calls = [];
  const factory = () => ({
    listChildren: async (id, options) => {
      calls.push([id, options]);
      return { ok: true, files: [
        { id: "dirBBB", name: "Projects", mimeType: "application/vnd.google-apps.folder" },
        { id: "mdCCC", name: "Plan.md", mimeType: "text/markdown" },
      ] };
    },
    sharedDrives: async () => ({ ok: true, drives: [{ id: "sharedDDD", name: "Team" }] }),
  });

  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("google:folders", { parentId: null }), {
      ok: true,
      folders: [{ id: "dirBBB", name: "Projects" }],
      drives: [{ id: "sharedDDD", name: "Team" }],
    });
    assert.deepEqual(await ipcMain.invoke("google:folders", { parentId: "dirBBB" }), {
      ok: true,
      folders: [{ id: "dirBBB", name: "Projects" }],
      drives: [],
    });
    assert.deepEqual(calls, [["root", { foldersOnly: true }], ["dirBBB", { foldersOnly: true }]]);
  }, { createGoogleDrive: factory });
});

test("google:folders refuses a malformed request and answers not configured without Google", async () => {
  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("google:folders", { parentId: "a' or 'b" }), { ok: false, reason: "bad-request" });
  });
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("google:folders", { parentId: null }), { ok: false, reason: "not-configured" });
    },
    { google: null },
  );
});
```

`apps/desktop/test/preloadBridge.test.js`, append:

```js
test("listing Drive folders sends the parent id and nothing else", async () => {
  const { bridge, ipcMain } = loadBridge();
  const received = [];
  ipcMain.handle("google:folders", async (_event, payload) => {
    received.push(payload);
    return { ok: true, folders: [], drives: [] };
  });

  await bridge.listDriveFolders(null);
  await bridge.listDriveFolders("1H60yEnI5d4");

  assert.deepEqual(received, [{ parentId: null }, { parentId: "1H60yEnI5d4" }]);
});
```

`apps/app/src/components/GoogleAccountSection.test.tsx`, add:

```tsx
it("tells its owner when an account has been connected", async () => {
  const onConnected = vi.fn();
  render(<GoogleAccountSection bridge={fakeBridge()} onConnected={onConnected} />);
  await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
  await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
});

it("does not report a sign-in that did not connect", async () => {
  const onConnected = vi.fn();
  const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "cancelled" })) });
  render(<GoogleAccountSection bridge={bridge} onConnected={onConnected} />);
  await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
  await waitFor(() => expect(bridge.connectGoogle).toHaveBeenCalled());
  expect(onConnected).not.toHaveBeenCalled();
});
```

(Its `fakeBridge` must gain `listDriveFolders: vi.fn(async () => ({ ok: true as const, folders: [], drives: [] }))` once `GoogleBridge` has the member - do the same in `useGoogle.test.ts`'s and `SettingsDialog.test.tsx`'s fakes if they `satisfies GoogleBridge`.)

Create `apps/app/src/components/OpenDriveDialog.test.tsx` (match the neighbouring tests' `userEvent` import and assertion style - the repo has no jest-dom, so use `toBeDefined()`/`textContent`/`queryBy...toBeNull()`):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenDriveDialog from "./OpenDriveDialog";
import type { DriveFoldersResult, GoogleBridge } from "../lib/workspaceClient";

const TOP: DriveFoldersResult = {
  ok: true,
  folders: [{ id: "dirBBB", name: "Projects" }],
  drives: [{ id: "sharedDDD", name: "Team" }],
};

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    connectGoogle: vi.fn(async () => ({ ok: true as const, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    listDriveFolders: vi.fn(async (parentId: string | null): Promise<DriveFoldersResult> =>
      parentId === null ? TOP : { ok: true, folders: [{ id: "dirEEE", name: "2026" }], drives: [] },
    ),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("OpenDriveDialog", () => {
  it("shows My Drive's folders and the Shared Drives, with nothing to open at the top", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Team" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
  });

  it("opens the folder it was taken into, under the name it showed", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", { name: "2026" })).toBeDefined();
    expect(bridge.listDriveFolders).toHaveBeenLastCalledWith("dirBBB");

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirBBB", name: "Projects" });
  });

  it("opens a Shared Drive folder with the drive it lives in", async () => {
    const onOpen = vi.fn();
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(await screen.findByRole("button", { name: "2026" }));
    await screen.findByRole("button", { name: "Open this folder" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open this folder" })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirEEE", driveId: "sharedDDD", name: "2026" });
  });

  it("goes back up through the breadcrumb", async () => {
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "2026" });
    await userEvent.click(screen.getByRole("button", { name: "Google Drive" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
  });

  it("asks to connect when no account is connected, and reloads once one is", async () => {
    let connected = false;
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected, email: connected ? "ada@example.com" : null, reason: null })),
      connectGoogle: vi.fn(async () => {
        connected = true;
        return { ok: true as const, email: "ada@example.com" };
      }),
      listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => (connected ? TOP : { ok: false, reason: "not-connected" })),
    });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
  });

  it("names a failed listing in Google's words", async () => {
    const bridge = fakeBridge({ listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => ({ ok: false, reason: "offline" })) });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Google");
    expect(alert.textContent).not.toContain("GitHub");
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={onCancel} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

`apps/app/src/components/WorkspacePanel.test.tsx`: add a test that the header has a button named "Open Google Drive folder" which calls `onOpenDrive`, and that the empty-space source menu has the same entry (mirror the existing GitHub button/menu tests).

- [ ] **Step 2: Run the tests to verify they fail**

Run: from `packages/domain` the `ipc` tests; `npm test --workspace trypthos-desktop`; from `apps/app` `node ../../node_modules/vitest/vitest.mjs run OpenDriveDialog GoogleAccountSection WorkspacePanel bridgeSurface`
Expected: FAIL across the new tests.

- [ ] **Step 3: Write the implementation**

**`packages/domain/src/ipc.ts`:** import `DriveIdSchema` from `./googleDrive`; append `"google:folders",` after `"google:disconnect",` in `IPC_CHANNELS`; add:

```ts
/// The Drive folder picker asking what is inside a folder. Folders only, ids and names only.
///
/// Null is the top level: My Drive's folders and the Shared Drives. The id is a Drive id or nothing -
/// it reaches a Drive query string, so the schema is what keeps it one.
export const GoogleFoldersRequest = z.object({ parentId: DriveIdSchema.nullable() }).strict();

export type GoogleFoldersRequest = z.infer<typeof GoogleFoldersRequest>;
```

and export `GoogleFoldersRequest` from `index.ts` beside the other request schemas.

**`apps/desktop/src/ipcHandlers.js`:** destructure `GoogleFoldersRequest` and `foldersOf` from `@trypthos/domain`; add after the `google:disconnect` handler:

```js
  /// The Drive folder picker's only window onto Drive: the folders inside one folder, by id and name.
  /// Opening one goes through `workspace:openRef` like every other workspace.
  ipcMain.handle("google:folders", async (_event, payload) => {
    const parsed = GoogleFoldersRequest.safeParse(payload);
    if (!parsed.success) {
      console.error("Rejected a malformed Drive folder request.");
      return { ok: false, reason: "bad-request" };
    }
    if (drive === null) return { ok: false, reason: "not-configured" };

    const { parentId } = parsed.data;
    const listed = await drive.listChildren(parentId ?? "root", { foldersOnly: true });
    if (!listed.ok) return listed;
    if (parentId !== null) return { ok: true, folders: foldersOf(listed.files), drives: [] };

    const shared = await drive.sharedDrives();
    if (!shared.ok) return shared;
    return { ok: true, folders: foldersOf(listed.files), drives: shared.drives };
  });
```

Note the malformed-payload test will print that `console.error` line; in `googleDriveIpc.test.js` wrap that one invocation with a collecting `console.error` stub restored in `finally` and assert it was called once - output must stay pristine.

**`apps/desktop/src/preload.js`,** after `disconnectGoogle`:

```js
  /// The folders inside one Drive folder, or the top level when `parentId` is null. Ids and names
  /// only - the picker chooses a folder, and opening it goes through `openWorkspaceRef`.
  listDriveFolders: (parentId) => ipcRenderer.invoke("google:folders", { parentId }),
```

**`apps/app/src/lib/workspaceClient.ts`:** add

```ts
export type DriveFoldersResult =
  | { ok: true; folders: { id: string; name: string }[]; drives: { id: string; name: string }[] }
  | { ok: false; reason: string };
```

add `listDriveFolders(parentId: string | null): Promise<DriveFoldersResult>;` to `GoogleBridge`, and `listDriveFolders: bridge.listDriveFolders,` to `googleBridge()`.

**`apps/app/src/components/GoogleAccountSection.tsx`:** add to `Props`:

```ts
  /// Told when a Connect succeeds, so a picker that showed this because nothing was connected can
  /// carry on. Not told about a cancelled or refused sign-in.
  onConnected?: () => void;
```

destructure it, and change the Connect button's handler to:

```tsx
            onClick={() =>
              void google.connect().then((connected) => {
                if (connected) onConnected?.();
              })
            }
```

**`apps/app/src/locales/en.json`:** in `"workspace"`, after `"openRepo"`, add `"openDrive": "Open Google Drive folder",`; add a top-level block after `"google"`:

```json
  "drive": {
    "title": "Open a Google Drive folder",
    "root": "Google Drive",
    "myDrive": "My Drive",
    "sharedDrives": "Shared drives",
    "loading": "Loading folders...",
    "empty": "No folders here.",
    "openThis": "Open this folder",
    "cancel": "Cancel",
    "readOnlyNote": "A Drive folder opens read-only in this release. Saving to Drive arrives in a later one."
  },
```

**Create `apps/app/src/components/OpenDriveDialog.tsx`:**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceRef } from "@trypthos/domain";
import GoogleAccountSection from "./GoogleAccountSection";
import { attempt } from "../hooks/useGitHub";
import { providerFailureKey } from "../hooks/useWorkspace";
import type { DriveFoldersResult, GoogleBridge } from "../lib/workspaceClient";

interface Props {
  /// The Google half of the shell, or null in the browser preview.
  bridge: GoogleBridge | null;
  onCancel: () => void;
  onOpen: (ref: WorkspaceRef) => void;
}

/// One step of the breadcrumb: a folder the user went into, and the Shared Drive it is in.
interface Place {
  id: string;
  name: string;
  driveId: string | null;
}

type Listing =
  | { state: "loading" }
  | { state: "connect" }
  | { state: "failed"; errorKey: string | null }
  | { state: "loaded"; folders: { id: string; name: string }[]; drives: { id: string; name: string }[] };

/// Choosing a Google Drive folder to open as a workspace.
///
/// Browses folders only, through `google:folders`, from the top level (My Drive's folders, then the
/// Shared Drives) down. "Open this folder" is offered inside any folder - the top level is not a
/// folder, and a whole-My-Drive workspace is deferred. With no account connected, it shows the same
/// connect control as Settings, and carries on once one is.
export default function OpenDriveDialog({ bridge, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<Place[]>([]);
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [reloads, setReloads] = useState(0);
  const here = trail.at(-1) ?? null;

  useEffect(() => {
    if (bridge === null) return;
    let live = true;
    setListing({ state: "loading" });
    void (async () => {
      const result: DriveFoldersResult | { ok: false; reason: string } = await attempt(() =>
        bridge.listDriveFolders(here?.id ?? null),
      );
      if (!live) return;
      if (result.ok) {
        setListing({ state: "loaded", folders: result.folders, drives: result.drives });
      } else if (result.reason === "not-connected" || result.reason === "not-configured") {
        setListing({ state: "connect" });
      } else {
        setListing({ state: "failed", errorKey: providerFailureKey("google-drive", result.reason) });
      }
    })();
    return () => {
      live = false;
    };
  }, [bridge, here, reloads]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const enter = useCallback((place: Place) => setTrail((previous) => [...previous, place]), []);

  const open = () => {
    if (here === null) return;
    onOpen({
      kind: "google-drive",
      folderId: here.id,
      ...(here.driveId === null ? {} : { driveId: here.driveId }),
      name: here.name,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("drive.title")}
        className="flex max-h-[80vh] w-[28rem] flex-col rounded-lg border border-rule bg-app p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{t("drive.title")}</h2>

        {bridge === null || listing.state === "connect" ? (
          <GoogleAccountSection bridge={bridge} onConnected={() => setReloads((count) => count + 1)} />
        ) : (
          <>
            <nav className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              <button type="button" className="rounded px-1 hover:bg-hover" onClick={() => setTrail([])}>
                {t("drive.root")}
              </button>
              {trail.map((place, index) => (
                <span key={place.id} className="flex items-center gap-1">
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    className="rounded px-1 hover:bg-hover"
                    onClick={() => setTrail((previous) => previous.slice(0, index + 1))}
                  >
                    {place.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="mt-2 min-h-32 flex-1 overflow-y-auto rounded border border-rule">
              {listing.state === "loading" && <p className="p-2 text-xs text-ink-3">{t("drive.loading")}</p>}
              {listing.state === "failed" && listing.errorKey !== null && (
                <p role="alert" className="m-2 rounded border border-rule bg-panel p-2 text-xs text-ink-2">
                  {t(listing.errorKey)}
                </p>
              )}
              {listing.state === "loaded" && (
                <>
                  {here === null && listing.folders.length > 0 && (
                    <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t("drive.myDrive")}</h3>
                  )}
                  <ul>
                    {listing.folders.map((folder) => (
                      <li key={folder.id}>
                        <button
                          type="button"
                          className="w-full truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover"
                          onClick={() => enter({ id: folder.id, name: folder.name, driveId: here?.driveId ?? null })}
                        >
                          {folder.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {listing.drives.length > 0 && (
                    <>
                      <h3 className="px-2 pt-2 text-xs font-medium text-ink-4">{t("drive.sharedDrives")}</h3>
                      <ul>
                        {listing.drives.map((drive) => (
                          <li key={drive.id}>
                            <button
                              type="button"
                              className="w-full truncate px-2 py-1 text-left text-ui text-ink hover:bg-hover"
                              onClick={() => enter({ id: drive.id, name: drive.name, driveId: drive.id })}
                            >
                              {drive.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {listing.folders.length === 0 && listing.drives.length === 0 && (
                    <p className="p-2 text-xs text-ink-3">{t("drive.empty")}</p>
                  )}
                </>
              )}
            </div>

            <p className="mt-2 text-xs text-ink-4">{t("drive.readOnlyNote")}</p>
          </>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-rule px-3 py-1 text-ui text-ink hover:bg-hover">
            {t("drive.cancel")}
          </button>
          {here !== null && listing.state !== "connect" && (
            <button type="button" onClick={open} className="rounded bg-accent px-3 py-1 text-ui text-on-accent">
              {t("drive.openThis")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

Before finalising, open `OpenRepoDialog.tsx` and align the overlay/dialog wrapper classes, Esc handling and backdrop handling with it (it is the house style for these dialogs); keep the behaviour above. If the `attempt` result type does not narrow cleanly, type the awaited value as `DriveFoldersResult` (attempt returns `T | { ok: false; reason: string }`, which `DriveFoldersResult` already covers).

**`apps/app/src/components/WorkspacePanel.tsx`:** add prop

```ts
  /// Opens the Google Drive folder picker.
  onOpenDrive: () => void;
```

a header button directly after the GitHub one:

```tsx
          <button
            type="button"
            onClick={onOpenDrive}
            aria-label={t("workspace.openDrive")}
            title={t("workspace.openDrive")}
            className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
          >
            <SourceGlyph mark="google-drive" className="size-4" />
          </button>
```

and a source-menu entry directly after the GitHub one:

```tsx
            <ContextMenuItem
              onClick={() => {
                setSourceMenu(null);
                onOpenDrive();
              }}
            >
              {t("workspace.openDrive")}
            </ContextMenuItem>
```

Update every place that renders `WorkspacePanel` (App.tsx and the panel's tests) to pass `onOpenDrive`.

**`apps/app/src/App.tsx`:** beside `pickingRepo`: `const [pickingDrive, setPickingDrive] = useState(false);`; pass `onOpenDrive={() => setPickingDrive(true)}` to `WorkspacePanel`; beside the `OpenRepoDialog` block:

```tsx
      {pickingDrive && (
        <OpenDriveDialog
          bridge={google}
          onCancel={() => setPickingDrive(false)}
          onOpen={(ref) => {
            setPickingDrive(false);
            void actions.openRef(ref);
          }}
        />
      )}
```

(import `OpenDriveDialog` the way `OpenRepoDialog` is imported.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck`, `npm run lint`, `npm test`
Expected: PASS, pristine (`bridgeSurface` sees `listDriveFolders` on the preload; `i18nKeys` sees every new key used).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ipc.ts packages/domain/src/ipc.test.ts packages/domain/src/index.ts apps/desktop/src/ipcHandlers.js apps/desktop/src/preload.js apps/desktop/test/googleDriveIpc.test.js apps/desktop/test/preloadBridge.test.js apps/app/src/lib/workspaceClient.ts apps/app/src/components/GoogleAccountSection.tsx apps/app/src/components/GoogleAccountSection.test.tsx apps/app/src/components/OpenDriveDialog.tsx apps/app/src/components/OpenDriveDialog.test.tsx apps/app/src/components/WorkspacePanel.tsx apps/app/src/components/WorkspacePanel.test.tsx apps/app/src/App.tsx apps/app/src/locales/en.json
git add -u apps/app/src
git commit -m "app: pick a Google Drive folder and open it as a workspace"
```

---

### Task 7: Release and docs (controller does the manual check, line endings, push and PR)

**Files:**
- Modify: `version.json`, `package.json`, `apps/app/package.json`, `apps/desktop/package.json`, `packages/domain/package.json`, `package-lock.json` (exactly five entries), `apps/app/src/lib/releaseNotes/current.ts`, `apps/app/src/lib/appInfo.ts`, `README.md`, `docs/features.md`, `docs/Architecture.md`

- [ ] **Step 1: Version 0.96.0 -> 0.97.0**

Edit `version.json` and the four `package.json` files. In `package-lock.json` change exactly five `"version": "0.96.0"` entries - top-level, `packages[""]`, `packages["apps/app"]`, `packages["apps/desktop"]`, `packages["packages/domain"]` - matched by the workspace `name` above each, never a file-wide replace. Count them.

- [ ] **Step 2: Release notes**

The controller gives you the PR number and date. Add at the top of `RECENT` in `apps/app/src/lib/releaseNotes/current.ts`:

```ts
  {
    version: "0.97.0",
    date: "<given>",
    pr: <given>,
    headline: "Open a Google Drive folder beside your other folders",
    summary:
      "With a Google account connected, the folder browser has a Google Drive button. It opens a picker over your Drive: My Drive's folders, then your shared drives, with a breadcrumb to go back up. Choose a folder and it opens as another tree beside your local folders and repositories, marked with Drive's logo, and comes back the next time you start Trypthos. Markdown and text files open as they do anywhere else, Google Docs open as markdown, and pictures a note embeds are shown. Folders are read as you open them, so a large Drive is not read all at once, and right-click Refresh asks Drive again. This release opens Drive folders read-only: the editor does not let you type into a Drive file, and saving to Drive arrives in the next release. Shortcuts, Sheets and Slides are not listed.",
    added: [
      "Google Drive folders as workspaces: pick a folder in My Drive or a shared drive and browse it beside your other folders, read-only for now.",
      "Google Docs open as markdown, and pictures embedded in a Drive note are shown.",
    ],
  },
```

- [ ] **Step 3: About box, README, features, Architecture**

`apps/app/src/lib/appInfo.ts`:
- "Workspace browser" row: change "on this machine or on GitHub" to "on this machine, on GitHub or in Google Drive", and replace `Google Drive folders follow in the next release, OneDrive and Dropbox later.` with `OneDrive and Dropbox follow in a later release.`
- "Google Drive" row: replace with `| Google Drive | Connect your Google account from Settings > Accounts, through Google's sign-in page in your browser, then open a folder from My Drive or a shared drive as another tree. Google Docs open as markdown and embedded pictures are shown. Drive folders open read-only for now; saving to Drive follows in the next release. |`

`README.md`: the Workspace browser row and the Google Drive row, in lockstep with the two About rows above; any "Not built yet" / roadmap line that says Drive folders are coming.

`docs/features.md`: extend the Google Drive section with a paragraph matching the release summary.

`docs/Architecture.md`: in the Google Drive section, add "Drive folders as workspaces" covering - with the spec's reasons - `googleDriveApi.js` (token from googleAuth, one refresh retry on 401, one backoff retry on rate limit, ids validated before any URL, logs carry no URL), `googleDriveWorkspace.js` (path-to-id map built from listings by `childrenToEntries`, on-demand walk for unlisted paths, re-listing replaces direct children only, refresh clears it, guard root `/drive`, read-only `write`), the `google-drive` ref and settings v23, the `google:folders` channel, and that Drive is excluded from the vault graph. Update the "As of 0.96.0 this is sign-in only" line.

- [ ] **Step 4: Full verification**

Run: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:browser` - all clean, pristine.

- [ ] **Step 5: Commit**

```bash
git add version.json package.json apps/app/package.json apps/desktop/package.json packages/domain/package.json package-lock.json apps/app/src/lib/releaseNotes/current.ts apps/app/src/lib/appInfo.ts README.md docs/features.md docs/Architecture.md
git commit -m "release: 0.97.0 - open a Google Drive folder"
```

The controller then runs the manual check with the user, repairs line endings against `main`, pushes and opens the PR.
