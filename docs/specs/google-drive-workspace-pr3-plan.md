# Google Drive - PR 3: Save to Drive - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordinary files in a Google Drive workspace can be edited and saved, with a conflict reported instead of an overwrite; Google Docs stay read-only; the chat's "create file" tool creates files on Drive; plus two carried fixes (a refresh racing an in-flight listing, and My Drive pinned to the account that opened it).

**Architecture:** The domain gains the upload addresses, a multipart body builder and a text mime-type rule. The Drive client gains `uploadContent` and `createFile` over a request core that now takes a method, headers and a body. The provider's `write` becomes check -> write -> confirm (and create for a new path); `read` fetches a fresh revision before downloading, remembers the file's BOM, and marks a Google Doc read-only in its answer. The renderer takes read-only from the read answer instead of from the workspace kind.

**Tech Stack:** TypeScript + zod (domain), Electron CommonJS + `net.fetch` (shell), React 19 (renderer), vitest, `node --test`.

**Spec:** `docs/specs/google-drive-workspace.md` - "Saving (PR 3)", "Decisions taken", "PR 2 decisions taken while planning".

**Delivery:** ONE PR from branch `claude/google-drive-pr3`. Commit after every task; the controller does the manual check, line endings, push and PR.

## Decisions taken with the user (2026-10-06)

| Decision | Choice | Reason |
|---|---|---|
| Save sequence | **Check** (`fileMeta` -> `headRevisionId` must equal the editor's revision), **write** (media upload to the same id, BOM kept), **confirm** (the revision in Drive's answer is what the editor gets) | Drive ignores `If-Match` (spike). The race between check and write is one request long; Drive's version history recovers the overwritten version. Documented, not hidden. |
| Read-only | **Per file**: a Google Doc's read answers `readOnly: true`; every other Drive file is editable | Writing markdown back would turn a Doc into a different thing. |
| Revision at read | `fileMeta` **before** download | A listing's revision can be a minute old (the cache). Meta first means any skew errs toward a false conflict, never a silent overwrite. |
| Write contract | Same as a local folder: `expected === null` on a missing path **creates** the file in its folder; `expected === null` on an existing file is a conflict; `expected` set on a missing file is a conflict (`theirs: null`) | The chat's create-file tool relies on it. File > New / Save As / new folder / rename into Drive stay in PR 5. |
| New file name | Must survive `displayNameFor` unchanged, else `bad-request` | Otherwise the file would land under a different path than the one asked for. |
| Retries on a write | 401 (after refresh) and rate-limit retries stay - both mean the request was not processed; a **timeout is not retried** and answers `offline` | A timed-out write may have landed; the next save's check then reports the conflict honestly. |
| Refresh race | A generation counter: a listing that started before `refresh()` is never cached, never joined, and is asked again by `listInto` | Parked in PR 2. |
| My Drive | The ref gains optional `rootId` (My Drive's real id), filled at first open; a later open whose real root differs answers `other-account` | A My Drive workspace must not silently follow a different connected account. `folderId` stays `"root"`, so the key and dedup are unchanged. |
| Settings | `SETTINGS_VERSION` 23 -> 24 (no-op migration) | The ref is strict; an older build must refuse rather than drop every workspace. |

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine (jsdom fails on `console.error`; shell tests inject a collecting `logger`).
- Commands from the repo root. `npm ci`, never `npm install`. No new dependencies. Renderer tests: `npm test` at root, or vitest.mjs from `apps/app` (find where it lives).
- Domain: no React, Electron, `fs` or `node:*`. Shell: CommonJS, `node:test` + `node:assert/strict`; every domain name a shell file destructures is exported from `packages/domain/src/index.ts`.
- Failures cross IPC as results, never throws. Shell modules never throw outward. Log lines: step + `error.code ?? error.name` only - never a URL, a file name, a token or `error.message`.
- Every Drive id is checked with `isDriveId` before it reaches a URL.
- Every user-facing string in `apps/app/src/locales/en.json` via literal `t("...")`; plain hyphens only in user-facing text, release notes, README and features.md.
- Files with regex escapes are written with the editor tools, not a heredoc. Do not repair line endings (the controller does, against `main`). Do not push.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Version: `0.97.0` -> `0.98.0`. `SETTINGS_VERSION` `23` -> `24`.

## File Map

| File | Responsibility |
|---|---|
| `packages/domain/src/googleDrive.ts` (+test) | `DRIVE_UPLOAD_API`, `uploadUrl`, `createUrl`, `multipartRelated`, `textMimeFor` |
| `packages/domain/src/workspaceRef.ts` (+test), `settings.ts` (+test), `index.ts` | `rootId`; v24 |
| `apps/desktop/src/googleDriveApi.js` (+test) | request core with method/headers/body; `uploadContent`, `createFile` |
| `apps/desktop/src/googleDriveWorkspace.js` (+test) | read (fresh revision, BOM, `readOnly`), write (check/write/confirm, create), generation counter, `rootId` |
| `apps/desktop/src/providers.js` (+test) | the opener's ref wins |
| `apps/desktop/test/googleDriveIpc.test.js` | save, conflict, create through the real handlers |
| `apps/app/src/lib/workspaceClient.ts`, `hooks/useWorkspace.ts` (+test), `locales/en.json` | read-only from the read answer; wording |
| Docs / release | version + mirrors, release notes, About, README, features.md, Architecture.md, spec |

---

### Task 1: Domain - upload addresses, multipart body, `rootId`, settings v24

**Files:** `packages/domain/src/googleDrive.ts` (+ `googleDrive.test.ts`), `packages/domain/src/workspaceRef.ts` (+ test), `packages/domain/src/settings.ts` (+ test), `packages/domain/src/index.ts`

**Produces:** `DRIVE_UPLOAD_API`, `uploadUrl(id)`, `createUrl()`, `multipartRelated(metadata, content: Uint8Array, contentType, boundary): Uint8Array`, `textMimeFor(name): string`; `GoogleDriveWorkspaceRefSchema` gains `rootId: DriveIdSchema.optional()`; `SETTINGS_VERSION = 24`.

- [ ] **Step 1: Failing tests** - add to `googleDrive.test.ts`:

```ts
describe("upload addresses", () => {
  it("uploads new content to one file, answering its fields", () => {
    const url = new URL(uploadUrl("f1"));
    expect(`${url.origin}${url.pathname}`).toBe(`${DRIVE_UPLOAD_API}/files/f1`);
    expect(url.searchParams.get("uploadType")).toBe("media");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toContain("headRevisionId");
  });

  it("creates a file with a multipart upload", () => {
    const url = new URL(createUrl());
    expect(`${url.origin}${url.pathname}`).toBe(`${DRIVE_UPLOAD_API}/files`);
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(url.searchParams.get("fields")).toContain("headRevisionId");
  });
});

describe("multipartRelated", () => {
  it("puts the metadata part first and the content bytes second, between the boundaries", () => {
    const body = multipartRelated({ name: "a.md", parents: ["p1"] }, new TextEncoder().encode("# Hi"), "text/markdown", "B0UND");
    const text = new TextDecoder().decode(body);
    expect(text).toBe(
      '--B0UND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.md","parents":["p1"]}\r\n' +
        "--B0UND\r\nContent-Type: text/markdown\r\n\r\n# Hi\r\n--B0UND--",
    );
  });

  it("carries content bytes exactly, including a byte-order mark", () => {
    const content = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    const body = multipartRelated({}, content, "text/plain", "B");
    const head = new TextEncoder().encode('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--B\r\nContent-Type: text/plain\r\n\r\n');
    expect([...body.slice(head.length, head.length + 4)]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
  });
});

describe("textMimeFor", () => {
  it("names markdown as markdown and everything else as plain text", () => {
    expect(textMimeFor("Notes.md")).toBe("text/markdown");
    expect(textMimeFor("Notes.MARKDOWN")).toBe("text/markdown");
    expect(textMimeFor("data.json")).toBe("text/plain");
    expect(textMimeFor("README")).toBe("text/plain");
  });
});
```

Add to `workspaceRef.test.ts` (inside the Google Drive describe):

```ts
  it("remembers My Drive's real id beside the alias, and is still one workspace", () => {
    const pinned = { kind: "google-drive" as const, folderId: "root", rootId: "0ARealRootId", name: "My Drive" };
    expect(WorkspaceRefSchema.parse(pinned)).toEqual(pinned);
    expect(WorkspaceRefSchema.safeParse({ ...pinned, rootId: "a' or 'b" }).success).toBe(false);
    expect(sameWorkspaceRef(pinned, { kind: "google-drive", folderId: "root", name: "My Drive" })).toBe(true);
  });
```

Add to `settings.test.ts`:

```ts
describe("version 24", () => {
  it("remembers My Drive with its real id", () => {
    const drive = { kind: "google-drive" as const, folderId: "root", rootId: "0ARealRootId", name: "My Drive" };
    expect(loadSettings({ ...DEFAULT_SETTINGS, workspaces: [drive] }).workspaces).toEqual([drive]);
  });

  it("leaves workspaces remembered at version 23 exactly as they were", () => {
    const before = { ...DEFAULT_SETTINGS, schemaVersion: 23, workspaces: [{ kind: "google-drive" as const, folderId: "root", name: "My Drive" }] };
    const loaded = loadSettings(before);
    expect(SETTINGS_VERSION).toBe(24);
    expect(loaded.schemaVersion).toBe(24);
    expect(loaded.workspaces).toEqual(before.workspaces);
  });
});
```

- [ ] **Step 2: Run, see them fail** (from `packages/domain`: `node ../../node_modules/vitest/vitest.mjs run googleDrive workspaceRef settings`, or the path that exists).

- [ ] **Step 3: Implement.** In `googleDrive.ts` (reuse the existing private `FILE_FIELDS`):

```ts
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/// New content for one existing file. Drive answers the file's fields, so the save learns its new
/// revision from the same request that wrote it.
export function uploadUrl(id: string): string {
  const params = new URLSearchParams({ uploadType: "media", fields: FILE_FIELDS, supportsAllDrives: "true" });
  return `${DRIVE_UPLOAD_API}/files/${id}?${params.toString()}`;
}

/// A new file, metadata and content in one multipart request.
export function createUrl(): string {
  const params = new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS, supportsAllDrives: "true" });
  return `${DRIVE_UPLOAD_API}/files?${params.toString()}`;
}

/// The body of a `multipart/related` upload: the metadata as JSON, then the content's bytes as they
/// are - a byte-order mark included. The caller chooses a boundary that cannot occur in either.
export function multipartRelated(
  metadata: unknown,
  content: Uint8Array,
  contentType: string,
  boundary: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + content.length + tail.length);
  body.set(head, 0);
  body.set(content, head.length);
  body.set(tail, head.length + content.length);
  return body;
}

/// The type a new text file is created as. Drive shows `text/markdown` as markdown; everything else
/// the app writes is text.
export function textMimeFor(name: string): string {
  return /\.(md|markdown)$/i.test(name) ? "text/markdown" : "text/plain";
}
```

In `workspaceRef.ts`, add to `GoogleDriveWorkspaceRefSchema` after `driveId`:

```ts
    /// My Drive's real id, when `folderId` is the alias "root". Filled the first time it opens, so a
    /// later open under a different Google account is refused rather than showing that account's
    /// Drive under the same row.
    rootId: DriveIdSchema.optional(),
```

In `settings.ts`: `SETTINGS_VERSION = 24` and at the top of `SETTINGS_MIGRATIONS`:

```ts
  {
    to: 24,
    // Version 24 lets a remembered My Drive carry its real id. Nothing already remembered changes;
    // the version is for the other direction - the reference is strict, so the previous build must
    // refuse this file rather than fail to parse it and lose every remembered workspace.
    migrate: (input) => input,
  },
```

Export `DRIVE_UPLOAD_API`, `uploadUrl`, `createUrl`, `multipartRelated`, `textMimeFor` from `index.ts`.

- [ ] **Step 4: Run, see them pass;** `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** - "domain: Drive upload addresses, a multipart body, and My Drive's real id"

---

### Task 2: Shell - the Drive client writes

**Files:** `apps/desktop/src/googleDriveApi.js` (+ `test/googleDriveApi.test.js`)

**Consumes:** Task 1. **Produces:** `uploadContent(id, bytes: Uint8Array, mimeType)` -> `{ ok: true, file: DriveFile }` or failure; `createFile(parentId, name, bytes, mimeType)` -> `{ ok: true, file }` or failure; factory option `boundary = () => crypto.randomBytes(16).toString("hex")`.

- [ ] **Step 1: Failing tests** (extend the file's `setup`/`answer` helpers so the fake `fetch` records `init.method`, `init.headers` and `init.body`):

```js
test("uploads new content to a file with PATCH, its type, and the bytes", async () => {
  const { api, calls } = setup({ routes: [answer(200, { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r2" })] });
  const bytes = new TextEncoder().encode("# Hi");

  const uploaded = await api.uploadContent("f1", bytes, "text/markdown");
  assert.deepEqual(uploaded, { ok: true, file: { id: "f1", name: "a.md", mimeType: "text/markdown", headRevisionId: "r2" } });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].headers["Content-Type"], "text/markdown");
  assert.equal(calls[0].headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(new URL(calls[0].url).searchParams.get("uploadType"), "media");
  assert.deepEqual([...calls[0].body], [...bytes]);
});

test("creates a file with one multipart POST into its folder", async () => {
  const { api, calls } = setup({
    routes: [answer(200, { id: "n1", name: "new.md", mimeType: "text/markdown", headRevisionId: "r1" })],
    boundary: () => "B0UND",
  });

  const created = await api.createFile("folderAAA111", "new.md", new TextEncoder().encode("x"), "text/markdown");
  assert.equal(created.ok, true);
  assert.equal(created.file.id, "n1");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["Content-Type"], "multipart/related; boundary=B0UND");
  const body = new TextDecoder().decode(calls[0].body);
  assert.match(body, /"name":"new\.md"/);
  assert.match(body, /"parents":\["folderAAA111"\]/);
});

test("refuses a write to an id that is not a Drive id, without a request", async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.uploadContent("a' or 'b", new Uint8Array(), "text/plain"), { ok: false, reason: "not-found" });
  assert.deepEqual(await api.createFile("../x", "a.md", new Uint8Array(), "text/plain"), { ok: false, reason: "not-found" });
  assert.equal(calls.length, 0);
});

// 401 and 429 mean Drive did not process the request, so the write is repeated once.
test("a write is repeated after an expired token, with the same body", async () => {
  const { api, calls } = setup({
    tokens: [{ ok: true, token: "stale" }, { ok: true, token: ACCESS }],
    routes: [answer(401, {}), answer(200, { id: "f1", name: "a.md", mimeType: "text/plain", headRevisionId: "r2" })],
  });
  assert.equal((await api.uploadContent("f1", new TextEncoder().encode("x"), "text/plain")).ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[1].body], [...new TextEncoder().encode("x")]);
});

// A timed-out write may have landed. It is not repeated; the next save's check reports what Drive has.
test("a write that times out is not repeated, and answers offline", async () => {
  const { api, calls } = setup({ routes: [() => new Promise(() => {})], timeoutMs: 20 });
  assert.deepEqual(await api.uploadContent("f1", new Uint8Array([1]), "text/plain"), { ok: false, reason: "offline" });
  assert.equal(calls.length, 1);
});
```

(The existing `setup` takes no `timeoutMs`/`boundary` - add both as pass-through options.)

- [ ] **Step 2: Run, see them fail** (`npm test --workspace trypthos-desktop`).

- [ ] **Step 3: Implement.** Destructure `createUrl`, `multipartRelated`, `uploadUrl` from the domain; `const crypto = require("node:crypto");`; add factory option `boundary = () => crypto.randomBytes(16).toString("hex")`.

- `attempt(url, token, read, init = {})`: `fetch(url, { method: init.method ?? "GET", signal: controller.signal, headers: { Authorization: \`Bearer ${token}\`, ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: init.body }) })`.
- `get(url, read)` becomes `send(url, read, init = {})`, passing `init` to every `attempt`; keep its retry rules (both are safe for a write - 401 and 429 are answered before Drive processes the request). `attempt` answering `null` (timeout or network failure) stays `failure("offline")` with no retry - that is what makes a timed-out write safe. Update `getJson`/`getBytes` to call `send`; add `sendJson(url, schema, init)` (the shared parse of `getJson`).

```js
  /// New content for an existing file. 401 and rate limits are repeated (Drive did not process the
  /// request); a timeout is not - it may have landed, and the next save's check will say so.
  async function uploadContent(id, bytes, mimeType) {
    if (!isDriveId(id)) return failure("not-found");
    const answer = await sendJson(uploadUrl(id), DriveFileSchema, {
      method: "PATCH",
      headers: { "Content-Type": mimeType },
      body: bytes,
    });
    return answer.ok ? { ok: true, file: answer.value } : answer;
  }

  /// A new file in a folder, metadata and content in one request.
  async function createFile(parentId, name, bytes, mimeType) {
    if (!isDriveId(parentId)) return failure("not-found");
    const separator = `trypthos-${boundary()}`;
    const body = multipartRelated({ name, parents: [parentId], mimeType }, bytes, mimeType, separator);
    const answer = await sendJson(createUrl(), DriveFileSchema, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${separator}` },
      body,
    });
    return answer.ok ? { ok: true, file: answer.value } : answer;
  }
```

Return them from the factory.

- [ ] **Step 4: Run, see them pass** (whole desktop suite + lint).
- [ ] **Step 5: Commit** - "desktop: the Drive client uploads new content and creates files"

---

### Task 3: Shell - the provider saves, creates, reads fresh, and pins My Drive

**Files:** `apps/desktop/src/googleDriveWorkspace.js` (+ test), `apps/desktop/src/providers.js` (+ test), `apps/desktop/test/googleDriveIpc.test.js`

**Consumes:** Tasks 1-2. **Produces:**
- `read` -> `{ ok, content, revision: { id }, readOnly?: true }` (`readOnly` only for a Google Doc); revision from `fileMeta` fetched **before** the download.
- `write(path, content, expected)` -> `{ ok: true, revision: { id } }` | `{ ok: false, reason: "conflict", theirs: { id } | null }` | `{ ok: false, reason: "read-only" | "bad-request" | ... }`.
- `openGoogleDriveWorkspace` answers `ref` too (with `rootId` filled for My Drive) and refuses `other-account`; the Drive opener in `providers.js` puts `ref: opened.ref` on the workspace record.

- [ ] **Step 1: Failing tests** in `googleDriveWorkspace.test.js` - extend `fakeApi` with `fileMeta` answers per id (`{ id, name, mimeType, headRevisionId }`, mutable so a test can change a file "in Drive"), `uploadContent` and `createFile` recorders (answering `{ ok: true, file: { id, name, mimeType, headRevisionId: "rev-new" } }`), and a way to make `listChildren` include a created file. Cover:
  1. **read** answers the revision from `fileMeta` (not the listing's), calls `fileMeta` before `download`, and a Google Doc's read has `readOnly: true` while a `.md` read has no `readOnly` key.
  2. **save, happy path:** after a read (revision `rev1`), `write("Plan.md", "changed", { id: "rev1" })` calls `fileMeta`, then `uploadContent(fileId, bytes, "text/markdown")`, and answers `{ ok: true, revision: { id: "rev-new" } }`; the bytes decode to "changed".
  3. **BOM kept:** a file whose downloaded bytes start with `EF BB BF` is uploaded with the BOM after an edit.
  4. **conflict, changed in Drive:** `fileMeta` now answers `rev9` -> `{ ok: false, reason: "conflict", theirs: { id: "rev9" } }`, and `uploadContent` is never called.
  5. **conflict, deleted in Drive:** `fileMeta` answers not-found (or `trashed: true`) -> conflict with `theirs: null`, nothing uploaded.
  6. **a Google Doc refuses** with `read-only`, no `fileMeta`, no upload.
  7. **create:** `write("Notes/new.md", "# New", null)` on a missing path calls `createFile(<Notes folder id>, "new.md", bytes, "text/markdown")` and answers `{ ok: true, revision: { id: <created headRevisionId> } }`; a following `read("Notes/new.md")` works (the folder was re-listed).
  8. **create refuses:** `expected` set on a missing path -> conflict `theirs: null`; `expected === null` on an existing file -> conflict with its current revision, nothing uploaded; a name `displayNameFor` would change (e.g. `"a:b.md"`) -> `bad-request`; a missing parent folder -> `not-found`.
  9. **refresh race:** with a `listChildren` that resolves on demand, start `list("")`, call `refresh()`, then let the old listing answer - the provider asks Drive again (a second `listChildren` call for the root) and the stale answer is never served from the cache afterwards.
  10. **My Drive pinning:** opening `{ folderId: "root", name: "My Drive" }` (fake `fileMeta("root")` answers `{ id: "0ARealRootId", ... }`) answers `ref.rootId === "0ARealRootId"`; opening `{ folderId: "root", rootId: "0AOtherRoot", name: "My Drive" }` answers `{ ok: false, reason: "other-account" }`; a non-root folder's ref is returned unchanged.

  In `googleDriveIpc.test.js`, through the real handlers: open a Drive folder, `file:read` then `file:write` with the read's revision -> `{ ok: true, revision }`; `file:write` with a stale revision -> conflict; `file:read` of a Google Doc answers `readOnly: true`. In `providers.test.js`: the Drive opener's workspace record carries the opener's `ref` (with `rootId`).

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement** in `googleDriveWorkspace.js` (destructure `displayNameFor`, `encodeTextFile`, `textMimeFor` from the domain):

```js
  /// Bumped by `refresh()`. A listing that started under an older generation is never cached, never
  /// joined, and `listInto` asks again - so a Refresh pressed mid-listing cannot be undone by it.
  let generation = 0;
  /// Drive file id -> whether its text began with a byte-order mark when last read, so a save keeps it.
  const boms = new Map();

  async function filesOf(folderId) {
    const cached = listings.get(folderId);
    if (cached !== undefined && cached.generation === generation && now() - cached.at < ttlMs) {
      return { ok: true, files: cached.files };
    }
    const joined = inFlight.get(folderId);
    if (joined !== undefined && joined.generation === generation) return joined.promise;

    const started = generation;
    const pending = { generation: started, promise: null };
    pending.promise = (async () => {
      try {
        const listed = await api.listChildren(folderId);
        if (listed.ok && started === generation) {
          listings.set(folderId, { at: now(), files: listed.files, generation: started });
        }
        return listed;
      } finally {
        if (inFlight.get(folderId) === pending) inFlight.delete(folderId);
      }
    })();
    inFlight.set(folderId, pending);
    return pending.promise;
  }
```

At the top of `listInto`, capture `const started = generation;` and after `const listed = await filesOf(folderId); if (!listed.ok) return listed;` add:

```js
    // A refresh while this listing was in flight: what arrived predates it, so ask again.
    if (generation !== started) return listInto(path, folderId);
```

`refresh()` adds `generation += 1;` and `boms.clear();`.

Add a helper and rewrite `read` / `write`:

```js
  /// The Drive id of a folder by its workspace path ("" is the workspace's own folder).
  async function folderIdAt(path) {
    if (path === "") return { ok: true, id: ref.folderId };
    const found = await ensure(path);
    if (!found.ok) return found;
    return found.entry.kind === "directory" ? { ok: true, id: found.entry.fileId } : failure("not-found");
  }

  function conflict(current) {
    return { ok: false, reason: "conflict", theirs: current === null ? null : { id: current } };
  }

  /// A new file at a path nobody has: created in its folder, under exactly the name the path gives.
  async function create(path, content, expected) {
    if (expected !== null) return conflict(null);
    const parent = parentOf(path);
    const folder = await folderIdAt(parent);
    if (!folder.ok) return folder;

    const name = parent === "" ? path : path.slice(parent.length + 1);
    const mimeType = textMimeFor(name);
    // A name the tree would show differently would land the file under another path than the one
    // asked for.
    if (displayNameFor({ name, mimeType }) !== name) return failure("bad-request");

    const created = await api.createFile(folder.id, name, encodeTextFile(content, { bom: false }), mimeType);
    if (!created.ok) return created;
    listings.delete(folder.id);
    // Re-listed so the new file has its path in the map; the file landed whatever this answers.
    await listInto(parent, folder.id);
    return { ok: true, revision: { id: created.file.headRevisionId ?? created.file.id } };
  }
```

```js
    async read(candidate) {
      const found = await fileAt(candidate);
      if (!found.ok) return found;
      const entry = found.entry;

      // The revision is asked for BEFORE the bytes, so any skew between them errs toward a conflict
      // the user is told about, never toward overwriting a change they have not seen.
      let revision = entry.revision ?? entry.fileId;
      if (!entry.googleDoc) {
        const meta = await api.fileMeta(entry.fileId);
        if (!meta.ok) return meta;
        if (meta.file.trashed === true) return failure("not-found");
        revision = meta.file.headRevisionId ?? revision;
      }

      const fetched = await bytesOf(entry, MAX_TEXT_FILE_BYTES);
      if (!fetched.ok) return fetched;
      const decoded = decodeTextFile(fetched.bytes);
      if (!decoded.ok) return failure(decoded.reason);
      boms.set(entry.fileId, decoded.bom);
      return {
        ok: true,
        content: decoded.content,
        revision: { id: revision },
        // A Google Doc is read as exported markdown; writing that back would turn it into another kind
        // of file.
        ...(entry.googleDoc ? { readOnly: true } : {}),
      };
    },
```

```js
    /// Check, write, confirm. Drive has no conditional write, so the check is a request of its own: a
    /// save landing between the check and the write is overwritten. That window is one request long,
    /// and Drive's version history keeps what it replaced.
    async write(candidate, content, expected) {
      const path = drivePath(candidate);
      if (path === null || path === "") return failure("permission-denied");

      const found = await ensure(path);
      if (!found.ok) return found.reason === "not-found" ? create(path, content, expected) : found;
      const entry = found.entry;
      if (entry.kind !== "file") return failure("permission-denied");
      if (entry.googleDoc) return failure("read-only");

      // 1. Check.
      const meta = await api.fileMeta(entry.fileId);
      if (!meta.ok && meta.reason !== "not-found") return meta;
      const current = !meta.ok || meta.file.trashed === true ? null : (meta.file.headRevisionId ?? null);
      if (expected === null || current === null || current !== expected.id) return conflict(current);

      // 2. Write.
      const bytes = encodeTextFile(content, { bom: boms.get(entry.fileId) === true });
      const uploaded = await api.uploadContent(entry.fileId, bytes, entry.mimeType);
      if (!uploaded.ok) return uploaded;

      // 3. Confirm: the revision is Drive's answer to the write, never a guess.
      let revision = uploaded.file.headRevisionId;
      if (revision === undefined) {
        const after = await api.fileMeta(entry.fileId);
        revision = after.ok ? after.file.headRevisionId : undefined;
      }
      // The content landed but Drive will not say as what; reporting success with a made-up revision
      // would let the next save overwrite blindly, so it is reported as unknown instead.
      if (revision === undefined) return failure("unknown");

      entries.set(path, { ...entry, revision, sizeBytes: bytes.length });
      const parent = await folderIdAt(parentOf(path));
      if (parent.ok) listings.delete(parent.id);
      return { ok: true, revision: { id: revision } };
    },
```

Update the module's doc comment ("Read-only in this release" -> Google Docs only; describe check/write/confirm).

In `openGoogleDriveWorkspace`, after the folder check:

```js
  // My Drive is opened by the alias "root", which means whichever account is connected. Its real id
  // is remembered on first open, and a later open whose real root differs is a different account.
  let openedRef = ref;
  if (ref.folderId === "root") {
    if (ref.rootId !== undefined && ref.rootId !== meta.file.id) return failure("other-account");
    openedRef = { ...ref, rootId: meta.file.id };
  }
```

and answer `{ ok: true, name, variant, ref: openedRef, provider: createGoogleDriveProvider({ ref: openedRef, api, now, ttlMs }) }`. In `providers.js`'s Drive opener put `ref: opened.ref` in the workspace record.

- [ ] **Step 4: Run, see them pass** (desktop suite, several runs of the provider file for flakiness; lint).
- [ ] **Step 5: Commit** - "desktop: save to Drive with check, write and confirm; create from the chat; pin My Drive to its account"

---

### Task 4: Renderer - read-only per file, and the wording for saving

**Files:** `apps/app/src/lib/workspaceClient.ts`, `apps/app/src/hooks/useWorkspace.ts` (+ test), `apps/app/src/locales/en.json`

- `ReadResult`'s success variant gains `readOnly?: boolean`.
- `openPath`'s text branch: `readOnly: result.readOnly === true` (replacing `kindOf(...) === "google-drive"`), with a comment that the shell decides per file (a Google Doc).
- `providerFailureKey("google-drive", "other-account")` -> `"errors.driveOtherAccount"`.
- `en.json` `errors`: `"driveReadOnly"` -> "Google Docs open read-only in Trypthos, so this one cannot be saved."; add `"driveOtherAccount"`: "This My Drive belongs to a different Google account from the one connected now. Connect that account, or open My Drive again."; `drive.readOnlyNote` -> "Google Docs open read-only. Other files can be edited and saved."

**Tests first, seen failing (`useWorkspace.test.ts`):** a Drive text file whose read has no `readOnly` opens editable; one whose read answers `readOnly: true` opens read-only; a local file is unchanged; saving an edited Drive file calls `writeFile` with the read's revision and, on `{ ok: true, revision }`, the document is clean with the new revision; a conflict answer keeps the edited text, stays dirty, and shows `errors.conflict`; `providerFailureKey("google-drive", "other-account")` is `errors.driveOtherAccount`. Update the PR 2 test that expected every Drive file to open read-only.

Commit - "app: Drive files are editable, Google Docs stay read-only"

---

### Task 5: Release and docs (the controller does the manual check, line endings, push and PR)

- Version `0.97.0` -> `0.98.0` in `version.json`, the four `package.json` files and exactly five `package-lock.json` entries (matched by workspace name).
- Release notes: a new 0.98.0 entry at the top of `RECENT` (date and PR number from the controller): headline "Save to Google Drive"; summary covering editing and saving Drive files, the conflict check (a file changed in Drive since you opened it is not overwritten - your text stays and you are told), Google Docs staying read-only, the chat able to create files in a Drive folder, My Drive tied to the account that opened it, and Refresh no longer undone by a listing already in flight. `added` and `fixed` lists accordingly. Plain hyphens.
- `appInfo.ts` About Google Drive row, `README.md` Google Drive row and features list, `docs/features.md`: Drive files open and save; Google Docs read-only; the conflict rule. Remove every "read-only for now" / "saving arrives in the next release".
- `docs/Architecture.md` Drive section: the save sequence and its one-request race; meta-before-download at read; per-file read-only; the write contract and create; why a timed-out write is not retried; the generation counter; `rootId`.
- `docs/specs/google-drive-workspace.md`: mark PR 3 delivered in the delivery table's notes column if there is one, and fix any line still saying Drive is read-only.
- `npm run lint`, `typecheck`, `build`, `test`, `test:browser` - all clean.

Commit - "release: 0.98.0 - save to Google Drive"
