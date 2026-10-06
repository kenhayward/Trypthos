# Google Drive - PR 5: New file, new folder, rename, Open in Google Drive - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google Drive workspace's right-click menu offers New File, New Folder and Rename as a local folder's does, plus Open in Google Drive (the Drive counterpart of Reveal), which opens the file or folder on drive.google.com in the default browser. A Google Doc can be renamed: the dialog shows its title and Drive gets the new title.

**Architecture:** The Drive client gains `createFolder` (metadata POST) and `renameFile` (metadata PATCH). The provider gains `createDirectory(path)`, `rename(path, name)` and `webAddress(path)`. `createDirectory` follows the same fresh-relist, clash-check, write, relist pattern as PR 3's `create`. `rename` re-keys the entry map and every known descendant. The IPC gates for create-folder and rename stop requiring a filesystem root: having the provider method is the gate. `workspace:reveal` opens `webAddress` through `openExternal` when the provider has no `locate`. The renderer replaces its `kind === "local"` checks for these items with a capability rule (local or google-drive), and adds the Open in Google Drive item.

**Tech Stack:** TypeScript + zod (domain), Electron CommonJS + `net.fetch` (shell), React 19 (renderer), vitest, `node --test`.

**Spec:** `docs/specs/google-drive-workspace.md` delivery row 5.

**Delivery:** ONE PR from branch `claude/google-drive-pr5`, version `0.99.0` -> `0.100.0`. Commit after every task; the controller does the manual check, line endings, push and PR.

## Decisions taken with the user (2026-10-06)

| Decision | Choice | Reason |
|---|---|---|
| Scope | New File, New Folder, Rename from the right-click menu, plus Open in Google Drive | The spec's row 5, plus the Reveal counterpart. |
| Save As into Drive | **Not in PR 5** | Save As uses the OS dialog, which cannot see Drive; a Drive save picker is its own piece of work. |
| Google Doc rename | **Allowed**: the dialog shows the title (no `.md`) and Drive gets the new title | The Doc stays read-only for editing; its name is metadata. |
| Open in Google Drive | **Added** for Drive files, folders and the workspace row | Sharing and version history live in Drive's UI. |

## Decisions taken while planning (controller)

| Decision | Choice | Reason |
|---|---|---|
| Name rule | The same dialogs and domain rules as local (`newFolderName`, `newFileName`, `renameTarget`); the shell additionally requires `displayNameFor({ name: driveName, mimeType })` to equal the requested name, else `bad-request` | The tree path must be the name asked for. `renameTarget` already refuses separators, Windows-forbidden and control characters. |
| Name taken | The shell re-lists the parent fresh (cache dropped) and refuses an existing sibling of the same display name (case-insensitive, excluding the entry itself) with `conflict` | Drive allows duplicate names; the app does not, as for local. A case-only rename is allowed. |
| Google Doc name mapping | The renderer sends the PATH name (`Title.md` for a Doc). The shell strips one trailing `.md` from a Google Doc's requested name to get its Drive name; a Doc rename whose requested name does not end in `.md` is `bad-request` | The renderer keeps one meaning for a path everywhere; the Doc's `.md` is only the app's suffix. |
| Rename re-keys | After the PATCH: every `entries` key equal to the old path or under `old/` moves to the new path (entry `path` and `name` updated), likewise `listedPaths`; then the parent's listing cache is dropped and the parent re-listed | Re-listing alone would drop the renamed folder's known subtree (`listInto` deletes the descendants of a child it no longer sees), collapsing what the user had expanded. |
| Rename limits | The workspace root is `permission-denied` (as local). A shortcut is never listed, so never renamed | Same as local. |
| New folder | `createDirectory(path)`: parent must be a known folder; fresh re-list; an existing entry of that name is `conflict`; `api.createFolder(parentId, name)`; then re-list the parent so the folder is in `entries` (not in `listedPaths` until expanded). Answers `{ ok: true }` | Mirrors `create` from PR 3. |
| New file | Already works through `write(path, "", null)` (PR 3). Only the renderer gates change | No shell change. |
| IPC gates | `workspace:createDirectory` and `workspace:rename` answer `unsupported` only when the provider lacks the method (the `workspace.root === null` clause goes). GitHub still lacks both | The provider is the capability. |
| Reveal | `workspace:reveal`: a provider with `locate` reveals as today; else a provider with `webAddress` opens the answered `https:` URL through the injected `openExternal`; else `unsupported`. The URL never crosses IPC | One channel, one meaning: show me this entry where it lives. |
| Web addresses | Domain `driveWebUrl({ kind, fileId, googleDoc })`: folder -> `https://drive.google.com/drive/folders/<id>`; Google Doc -> `https://docs.google.com/document/d/<id>/edit`; other file -> `https://drive.google.com/file/d/<id>/view`. The workspace root: My Drive (`folderId === "root"`) -> `https://drive.google.com/drive/my-drive`; otherwise the folder URL of `folderId` (a shared drive's root id is its drive id, which the same URL opens) | Built from ids that passed `isDriveId`; no new API field. |
| Recent files | Not recorded for Drive (unchanged: `reportIfLocal`) | Recent files reopen local paths. |
| Open in New Window | Stays local only | Its window is built from a filesystem root. |

## Global Constraints

- TDD: every production change is preceded by a failing test that was run and seen to fail. Test output must be pristine (jsdom fails on `console.error`; shell tests inject a collecting `logger`).
- Commands from the repo root. `npm ci`, never `npm install`. No new dependencies. Renderer tests: from `apps/app`, `npx vitest run <file>`; browser suite `npm run test:browser`.
- Domain: no React, Electron, `fs` or `node:*`. Shell: CommonJS, `node:test` + `node:assert/strict`; every domain name a shell file destructures is exported from `packages/domain/src/index.ts`.
- Failures cross IPC as results, never throws. Log lines: step + `error.code ?? error.name` only - never a URL, a file name, a token or `error.message`.
- Every Drive id is checked with `isDriveId` before it reaches a URL. The token never leaves main. The boundary check is the shared path guard (`drivePath`).
- Every user-facing string in `apps/app/src/locales/en.json` via literal `t("...")`; plain hyphens only in user-facing text.
- Edit files with the editor tools; do not rewrite whole files. Do not repair line endings (the controller does, against `main`). Do not push.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `packages/domain/src/googleDrive.ts` (+test), `index.ts` | `folderCreateUrl()`, `renameUrl(id)`, `driveWebUrl(...)`, `driveRootWebUrl(folderId)` |
| `apps/desktop/src/googleDriveApi.js` (+test) | `createFolder(parentId, name)`, `renameFile(id, name)` |
| `apps/desktop/src/googleDriveWorkspace.js` (+test) | `createDirectory`, `rename`, `webAddress` |
| `apps/desktop/src/ipcHandlers.js` (+ `googleDriveIpc.test.js`, `workspacesIpc.test.js`) | gates; reveal opens a web address |
| `apps/app/src/components/WorkspacePanel.tsx` (+test), `hooks/useWorkspace.ts` (+test), `App.tsx`, `locales/en.json` | menu items, actions, Doc title in the rename dialog |
| Docs / release | version + mirrors, release notes, About, README, features.md, Architecture.md, spec |

---

### Task 1: Domain addresses and the Drive client's folder and rename calls

**Files:** `packages/domain/src/googleDrive.ts` (+ `googleDrive.test.ts`), `packages/domain/src/index.ts`, `apps/desktop/src/googleDriveApi.js` (+ `apps/desktop/test/googleDriveApi.test.js`)

**Produces:**
- `folderCreateUrl()` -> `` `${DRIVE_API}/files?fields=${FILE_FIELDS}&supportsAllDrives=true` `` (metadata endpoint, not the upload one; encode `fields` the way `fileUrl` does).
- `renameUrl(id)` -> the same shape as `fileUrl(id)` (PATCH target). Reuse `fileUrl` if it already carries `fields` and `supportsAllDrives`; then export no new name and say so in the report.
- `driveWebUrl({ kind, fileId, googleDoc })` and `driveRootWebUrl(folderId)` per the decisions table.
- `api.createFolder(parentId, name)` -> POST `folderCreateUrl()`, JSON body `{ name, mimeType: FOLDER_MIME, parents: [parentId] }`, `Content-Type: application/json`, answer parsed by `DriveFileSchema` -> `{ ok: true, file }` or a failure.
- `api.renameFile(id, name)` -> PATCH `renameUrl(id)` with JSON body `{ name }` -> `{ ok: true, file }` or a failure.

- [ ] Domain tests first: exact URLs, `supportsAllDrives=true` present, the three web URL shapes and both root cases; an id is interpolated unencoded only after the callers' `isDriveId` (state which in a comment).
- [ ] Client tests first: method, URL, headers and JSON body of each call; `isDriveId` refusal (`not-found`, no fetch) for `parentId` and `id`; 401 refresh retry and rate-limit retry resend the same body; 403 -> `permission-denied`; no log line holds the URL, the name or the token. Note: a write that timed out is not retried (as `uploadContent`) - follow `send`'s existing behaviour and test it.
- [ ] Commit "Create and rename on Drive: addresses and client calls".

### Task 2: Shell - the provider creates folders, renames, and answers a web address; IPC gates

**Files:** `apps/desktop/src/googleDriveWorkspace.js` (+test), `apps/desktop/src/ipcHandlers.js`, `apps/desktop/test/googleDriveIpc.test.js`, `apps/desktop/test/workspacesIpc.test.js`

**Produces:** provider `createDirectory(candidate)` -> `{ ok: true }` | failure; `rename(candidate, name)` -> `{ ok: true, path }` | failure (`path` workspace-relative); `webAddress(candidate)` -> `{ ok: true, url }` | failure.

- [ ] Provider tests first (`googleDriveWorkspace.test.js`, fake api with `createFolder`/`renameFile` recording calls):
  - `createDirectory("Archive/New")`: re-lists `Archive` fresh, POSTs with Archive's id and `"New"`, re-lists, then `list("Archive")` shows `New` as a directory. An existing `New` (file or folder) -> `conflict`, nothing created. A name failing the `displayNameFor` round trip -> `bad-request`. Unknown parent -> `not-found`. Outside the workspace -> `permission-denied` before Drive is asked. The root (`""`) -> `permission-denied`.
  - `rename("Plan.md", "Roadmap.md")`: PATCHes Plan's id with `"Roadmap.md"`, answers `{ ok: true, path: "Roadmap.md" }`; `read("Roadmap.md")` works and `read("Plan.md")` is `not-found`.
  - Renaming an expanded folder `Archive` -> `Old`: the PATCH carries Archive's id; afterwards `listKnown("Old")` answers the children known before (now under `Old/`), and a known grandchild path reads without new listing calls (assert call counts).
  - A taken name (existing sibling, case-insensitive) -> `conflict`, no PATCH; a case-only rename (`Plan.md` -> `plan.md`) PATCHes.
  - A Google Doc `Meeting.md` renamed to `Minutes.md` PATCHes the name `"Minutes"`; to `Minutes.txt` -> `bad-request`.
  - The root -> `permission-denied`; an unknown path -> `not-found`; a path outside -> `permission-denied`; a Drive 403 -> `permission-denied`.
  - `webAddress` for a file, a folder, a Google Doc, and `""` (both a `"root"` ref and an id ref) matches the domain helpers; an unknown path -> `not-found`.
- [ ] Implement beside `create`/`write`. The rename's re-key helper is a pure function over the `entries` Map and `listedPaths` Set (old prefix -> new prefix), unit-tested on its own.
- [ ] IPC (tests first, through the real handlers):
  - `workspace:createDirectory` and `workspace:rename` drop the `workspace.root === null` clause (gate on the method only). A Drive workspace creates and renames; a GitHub workspace still answers `unsupported` (add that test).
  - `workspace:reveal`: if the provider has `locate`, unchanged; else if it has `webAddress`, call the injected `openExternal(url)` with the answered URL and answer `{ ok: true }`; else `unsupported`. Test: a Drive entry calls `openExternal` once with the expected `https://drive.google.com/...` URL; no log holds it; a local entry still reveals; GitHub is `unsupported`.
- [ ] Run the shell suite; commit "Drive folders: new folder, rename, open in Google Drive".

### Task 3: Renderer - the menu, the actions and the Doc title

**Files:** `apps/app/src/components/WorkspacePanel.tsx` (+test), `apps/app/src/hooks/useWorkspace.ts` (+test), `apps/app/src/App.tsx` (+ `App.test.tsx` where the rename dialog is covered), `apps/app/src/locales/en.json`

- [ ] Tests first:
  - `WorkspacePanel`: for a Drive workspace (`ref.kind === "google-drive"`), the folder, file and workspace menus offer New File (selected-folder rule unchanged), New Folder, Rename (never on the workspace row) and **Open in Google Drive** (on files, folders and the workspace row); they do NOT offer Reveal or Open in New Window. A local workspace is unchanged (Reveal, Open in New Window, no Open in Google Drive). A GitHub repository still offers none of the create/rename items.
  - `useWorkspace`: `createEmptyFile` and `createDirectory` succeed in a Drive workspace (they call the client and add the child); `renameEntry` renames in a Drive workspace (tree and open tabs follow, as for local); a GitHub workspace still answers `unsupported` for each; `revealEntry` in a Drive workspace calls `client.revealEntry`.
  - Rename dialog for a Google Doc (`node.googleDoc`): it opens with the title (`Meeting`, no `.md`), the siblings it checks against are display titles where siblings are Docs, and submitting `Minutes` sends `renameEntry(path, "Minutes.md")`.
- [ ] Implementation:
  - A small exported predicate (in `useWorkspace.ts` or a lib beside it) `canEditTree(ref)` -> `ref.kind === "local" || ref.kind === "google-drive"`, used by the panel and the three actions in place of the `kind === "local"` checks for create and rename only. Reveal stays local; a separate `opensInBrowser(ref)` -> `ref.kind === "google-drive"` drives the new item. `rootOf` / `reportIfLocal` / `canOpenInNewWindow` are untouched.
  - The menu item label `workspace.openInDrive` ("Open in Google Drive"), wired to the existing `onReveal` handler (the shell decides between revealing and opening).
  - `App.tsx`'s rename dialog: for a Google Doc entry, `current` and the sibling names it compares are titles (`googleDocTitle` / the `.md` stripped for Doc siblings), and the submitted name gets `.md` appended before `renameEntry`.
- [ ] Run the renderer suite (and the i18n guard); commit "New file, new folder, rename and Open in Google Drive in a Drive workspace".

### Task 4: Release and docs (the controller does the manual check, line endings, push and PR)

- [ ] `0.100.0` in `version.json` and every mirror (exactly five `package-lock.json` entries).
- [ ] `RECENT[0]` (PR number confirmed before `gh pr create`): headline, prose summary, added bullets.
- [ ] README, `docs/features.md` and the About box in lockstep: the Google Drive row/bullet gains new file, new folder, rename (a Doc's title too) and Open in Google Drive; say Save As into Drive is not available.
- [ ] `docs/Architecture.md`: the Drive provider's `createDirectory`/`rename`/`webAddress`, the re-key, the IPC gate change (method, not root), and reveal opening a web address.
- [ ] Spec: PR 5 delivered (all rows).
- [ ] Manual check (controller, dev build): New File and New Folder in My Drive and a shared drive, appearing in Drive's web UI; rename a file, an expanded folder (its children stay), a Google Doc (title changes in Drive), a case-only rename; a taken name is refused; Open in Google Drive on a file, a folder, a Doc and the workspace row; a GitHub repository still offers none of these.
