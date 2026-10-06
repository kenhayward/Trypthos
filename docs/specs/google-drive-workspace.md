# Spec: Google Drive workspaces

**Status: PRs 1-3 delivered (0.96.0, 0.97.0, 0.98.0); PRs 4-5 pending.** It is the design the work is measured against, agreed before the first line of it.

Trypthos opens local folders, Obsidian vaults and GitHub repositories. This specifies the fourth
source: **a folder in Google Drive** - in My Drive or a Shared Drive - opened as a workspace, browsed
in the same tree, read and edited in the same editor, and saved back with conflict detection.

Google Drive comes before OneDrive. CLAUDE.md's planned order (OneDrive, Google Drive, Dropbox) is
amended in the first PR to read Google Drive, OneDrive, Dropbox.

## What the spike established

A throwaway spike (not committed) ran against a Workspace account on 2026-10-05. Its findings are the
ground this design stands on; each is a fact about Google's API, not a guess.

| Question | Finding |
|---|---|
| Does `drive.file` + the desktop Picker let us browse a chosen folder? | **No.** Picking a folder grants the folder and nothing in it: 0 children listed, against 7 under `drive`. |
| Does loopback OAuth with PKCE work for a Desktop client? | Yes. A refresh token is returned; `hd` is present for a Workspace account. |
| Revision fields | `headRevisionId` and `md5Checksum` are present on every binary file. `version` jumps by more than one per write (1 -> 3 -> 6), so it is not a per-save counter. |
| Conditional write (`If-Match`) | **Ignored.** A stale and a fabricated `If-Match` were both accepted with 200 and overwrote the file. Media reads carry no `ETag`. |
| `.md` mime type | `text/markdown` for uploaded files. |
| Native Google Doc -> markdown | `files.export?mimeType=text/markdown` answers 200. |
| Shared Drives | Listed by `drives.list`; children need `supportsAllDrives` + `includeItemsFromAllDrives`. |

## Decisions taken, and why

| Decision | Choice | Reason |
|---|---|---|
| Scope | **`https://www.googleapis.com/auth/drive`** plus `openid email` | The only scope that can list a folder the app did not create (spike). Restricted: a public release needs Google verification - see "Distribution". |
| Sign-in | **System browser, loopback redirect on `127.0.0.1:<ephemeral>`, PKCE (S256), `state` check** | Google's documented flow for desktop apps. Embedded webviews are blocked by Google. No custom URI scheme to register on two platforms. |
| What is stored | **The refresh token only**, in `accountStore` under `"google-drive"` | Same file and rules as the GitHub token. The access token lives in main-process memory and is re-minted from the refresh token. |
| Who the account is | **Asked of Google** (`openidconnect` userinfo `email`) on every status check | Same rule as GitHub's login: a stored name goes stale the moment the grant is revoked. |
| Granular consent | **Checked.** A grant without the `drive` scope is refused with `scope-denied` and not stored | Google's consent screen lets a user untick Drive; a token that cannot read Drive must not read as "connected". |
| OAuth client | **Shipped in the installer**, injected at build time from a CI secret; read from a local file in development | Google treats a Desktop client secret as non-confidential, but it still does not belong in a public repository. A build without it reports `not-configured` and offers no Google source. |
| API client | **Hand-rolled over Electron `net.fetch`**, like `githubApi.js` | `googleapis` is very large and brings its own HTTP stack, which loses the proxy and certificate store `net.fetch` gives us. Five endpoints do not need a SDK. |
| Workspace root | **Any folder in My Drive or a Shared Drive**, chosen in our own folder-picker dialog | Workspaces are folders everywhere else. My Drive whole, folders shared with you and shared drives are all openable (PR 2). |
| Paths | **Name paths** (`Notes/Daily/2026-10-05.md`), mapped to Drive ids by a per-workspace map filled as folders are listed | Every existing seam - path guard, qualified ids, recent files, wiki-link resolution - is path-shaped. An id-shaped tree would fork all of them. |
| Duplicate names | **Second and later siblings get a suffix `name~<6 chars of id>.ext`** (extension kept so the file type still resolves) | Drive allows identical siblings; a path must name exactly one file. The first sibling (by `createdTime`, then id) keeps its plain name so the common case is untouched. |
| Revision | **`headRevisionId`** | Changes on every content write, present on every binary file. `version` is not per-save; `md5Checksum` cannot tell a revert from no change. |
| Save | **Check, then write, then confirm** (see "Saving") | Drive has no conditional write. The race window is documented and tested, not hidden. |
| Native Google Docs | **Listed and opened read-only, as exported markdown** | Export works; writing back would convert a Google Doc into a different thing. Sheets, Slides, Forms and other `vnd.google-apps.*` types are hidden. |
| Shortcuts | **Hidden in the first release** | A shortcut's target can be outside the workspace, which makes it a boundary question rather than a listing one. Revisit with a test for the escape case. |
| Freshness | **Manual refresh**, as GitHub | The app has never watched the disk. Drive's Changes API is a later improvement. |
| Picker UI | **A fourth header button** in `WorkspacePanel` | The column source browser is its own project. |
| Graph | **Not indexed** | Indexing reads every note: one request per file, against a quota. Same reason GitHub is excluded. |

## Distribution

Under an **Internal** consent screen (a Cloud project owned by the Workspace organisation) every user
in that organisation can sign in with the `drive` scope, unverified, and refresh tokens do not
expire. That is enough to build and test everything here.

A public release needs the app to be **verified for a restricted scope**. Google's documentation
attaches a third-party security assessment to restricted-scope data that is stored on or transmitted
to servers. Trypthos has no server, but the chat panel can send file contents to a user-configured AI
endpoint, and whether that counts is Google's call during review. **This is a release decision, not a
build decision**: nothing in this design changes with the answer, and the feature ships behind the
`not-configured` gate until the client id is present in the build.

## What already exists, and where the seams are

- **`accountStore.js`** keeps one encrypted string per provider kind. A refresh token is one string.
- **`registerIpcHandlers`** takes provider factories as dependencies (`createGitHub`), which is how
  the GitHub tests inject a fake. Google gets `createGoogleAuth` and, later, `createGoogleDrive`.
- **`openExternal`** is already a dependency of the handlers and is `shell.openExternal` in
  `main.js`. The consent URL is opened through it from the main process; the renderer never sees it.
- **`githubIpc.test.js` "no channel answers with the stored token"** walks every handler. The same
  test, extended to the Google refresh and access tokens, is the leak guard CLAUDE.md asks for.
- **`providers.js` `OPENERS`** and **`PROVIDER_KINDS`** are the registry a new kind joins;
  `providers.test.js` fails if a kind has no opener.
- **`WorkspaceRef`** is a strict discriminated union, so a new kind needs a **settings version bump**
  (22 -> 23) or an older build would discard every remembered workspace.
- **`createPathGuard`** is lexical and already serves GitHub over a fake root `/repo`. Drive uses the
  same guard over `/drive`.
- **`useWorkspace` `folders[path].status`** already carries loading and error per folder.
- **Optional provider members are feature-detected** (`typeof provider.rename === "function"`), and
  `root === null` already disables Save As, reveal, media streaming and open-in-new-window.

## Architecture

### Domain (`packages/domain/src`, pure)

**`googleAuth.ts`** (PR 1)

- Endpoint constants: authorisation, token, revoke, userinfo.
- `DRIVE_SCOPE`, `GOOGLE_SCOPES` (`drive openid email`), `grantsDrive(scope: string): boolean`.
- `GoogleClientConfigSchema` - parses the JSON Google's console downloads (`{ installed: { client_id,
  client_secret, ... } }`) into `{ clientId, clientSecret }`. Rejects a `web` client: the loopback
  flow needs a Desktop client.
- `authorizationUrl({ clientId, redirectUri, state, codeChallenge })` - `response_type=code`,
  `access_type=offline`, `prompt=consent` (so a refresh token is always returned, including on a
  reconnect), `code_challenge_method=S256`.
- `readRedirect(url, expectedState)` -> `{ ok: true, code } | { ok: false, reason }` where reason is
  `cancelled` (Google's `error=access_denied`), `bad-request` (state mismatch, no code, or any other
  error). A state mismatch is never reported as anything that suggests retrying silently.
- `GoogleTokenSchema` (`access_token`, `expires_in`, `scope`, `token_type`, optional `refresh_token`,
  optional `id_token`) and `GoogleUserInfoSchema` (`email`).
- `googleAuthErrorFor(status, body)` - `invalid_grant` -> `not-connected` (revoked or expired grant),
  401 -> `permission-denied`, 429 -> `rate-limited`, anything else -> `offline`.

**`googleDrive.ts`** (PR 2 onward)

- URL builders for `files.list`, `files.get`, `files.get?alt=media`, `files.export`, `drives.list`,
  `upload/drive/v3/files/<id>?uploadType=media`, multipart create.
- `DriveFileSchema`, `DriveFileListSchema`, `DriveListSchema` - every field the code reads, nothing it
  does not.
- `driveErrorFor(status, reason)` - 401 -> `not-connected` (after one refresh retry in the shell),
  403 `userRateLimitExceeded`/`rateLimitExceeded` and 429 -> `rate-limited`, 403 otherwise ->
  `permission-denied`, 404 -> `not-found`, else `offline`.
- `childrenToNodes(parentPath, files)` - **the one function that decides what a listing shows**:
  hides trashed items, shortcuts and non-Docs `vnd.google-apps.*`; marks Google Docs read-only;
  applies the duplicate-name suffix; returns `{ nodes, ids }` where `ids` maps each child path to its
  Drive id, mime type and `headRevisionId`.
- `GOOGLE_DOC_MIME`, `FOLDER_MIME`.

**`workspaceRef.ts`** (PR 2)

```ts
export const GoogleDriveWorkspaceRefSchema = z
  .object({
    kind: z.literal("google-drive"),
    /// The folder's Drive id. Opaque, stable across renames and moves.
    folderId: z.string().min(1),
    /// The Shared Drive it lives in, or absent for My Drive.
    driveId: z.string().min(1).optional(),
    /// The folder's name when it was chosen. Display only - a rename in Drive makes it stale, and
    /// the workspace re-reads the real name when it opens.
    name: z.string().min(1),
  })
  .strict();
```

- `workspaceRefKey` -> `google-drive:<folderId>` (Drive ids are case-sensitive; no folding).
- `workspaceRefName` -> `name`; `workspaceRefLabel` -> `Google Drive / <name>`.
- `PROVIDER_KINDS` gains `"google-drive"`; `WorkspaceMark` gains it by derivation.

**`settings.ts`** (PR 2) - `SETTINGS_VERSION` 22 -> 23, with a no-op migration whose bump exists so
that a 0.96 build refuses a file holding a Drive workspace rather than discarding every workspace.
Same pattern and comment as v18.

**`ipc.ts`** - new channels, each with a strict schema:

| Channel | PR | Request | Answer |
|---|---|---|---|
| `google:status` | 1 | none | `{ ok, configured, connected, email \| null, reason \| null }` |
| `google:connect` | 1 | none | `{ ok: true, email } \| { ok: false, reason }` |
| `google:cancelConnect` | 1 | none | `{ ok: true }` |
| `google:disconnect` | 1 | none | `{ ok: true }` |
| `google:folders` | 2 | `{ parentId: string \| null, driveId: string \| null }` | `{ ok, folders: [{ id, name, driveId }], drives?: [...] }` |

`google:folders` is the picker's only window onto Drive, and it returns **folders only** - id and
name. It is the renderer's way to choose a root; opening one goes through the existing
`workspace:openRef` with a `google-drive` ref, and every listing after that through `workspace:list`.

### Shell (`apps/desktop/src`, CommonJS)

**`googleClient.js`** (PR 1) - `loadGoogleClient({ packaged, resourcesPath, env, readFile })` returns
the parsed client config or `null`.

- Packaged: `<resourcesPath>/build/google-oauth-client.json`, written by the release workflow from the
  `GOOGLE_OAUTH_CLIENT_JSON` repository secret before `electron-builder` runs.
- Development: the file named by `TRYPTHOS_GOOGLE_CLIENT` (a path to the JSON the console downloaded,
  kept outside the repository).
- Anything missing or malformed -> `null`, logged once without the file's contents.

**`googleAuth.js`** (PR 1) - `createGoogleAuth({ client, accounts, fetch, openExternal, listen,
now, logger, timeoutMs, consentTimeoutMs })`:

- `connect()` - opens a loopback listener on `127.0.0.1:0`, builds the PKCE pair and `state` with
  `node:crypto`, opens the consent URL with `openExternal`, waits for **one** request to `/` (any
  other path is 404), answers it with a short plain page telling the user to return to Trypthos, and
  closes the listener. Then exchanges the code, checks `grantsDrive`, asks userinfo for the email,
  stores the refresh token, keeps the access token and its expiry in memory, and answers `{ ok: true,
  email }`. **The refresh token is stored only after every step has succeeded** - the GitHub rule
  that a credential is verified before it reaches disk.
- **One sign-in at a time.** A second `connect()` cancels the first (closes its listener; the first
  answers `cancelled`). A user who closed the browser tab and clicks Connect again must not be left
  with two listeners and a dead one.
- `cancelConnect()` - the same cancellation, from the dialog's Cancel button.
- Consent timeout: 5 minutes, then `timed-out`.
- `accessToken()` - the in-memory token while it has more than 60 s left; otherwise one refresh with
  the stored refresh token. Concurrent callers share one in-flight refresh. `invalid_grant` answers
  `not-connected` and **leaves the stored token in place** (status then reports the reason, as a
  revoked GitHub token does).
- `status()` - no stored token -> not connected; otherwise `accessToken()` then userinfo -> email.
- `disconnect()` - best-effort revoke at Google (a failure is logged, not surfaced), then delete the
  stored token and forget the access token.
- **Logging rule:** no URL that carries a code, token, `state` or verifier is ever logged; error
  messages name the step ("token exchange", "refresh"), never the payload.

**`googleDriveApi.js`** (PR 2) - mirrors `githubApi.js`: one `request()` that takes the access token
from `googleAuth.accessToken()`, 30 s timeout, zod-parses every JSON answer, maps statuses through
`driveErrorFor`, never throws. **One retry** on 401 (after forcing a refresh) and **one retry with
backoff** (1 s plus jitter) on `rate-limited`; nothing more. Methods: `listChildren(folderId, driveId,
pageToken)`, `folderMeta(id)`, `fileMeta(id)`, `download(id)`, `exportMarkdown(id)`,
`uploadContent(id, bytes)`, `createFile(parentId, name, bytes)`, `createFolder(parentId, name)`,
`rename(id, name)`, `sharedDrives()`.

**`googleDriveWorkspace.js`** (PR 2-4) - the provider object, same contract as `githubWorkspace.js`:

- `list(relPath)` - resolves `relPath` through the path guard (root `/drive`), looks up the folder's
  id in the map (the root's id is the ref's `folderId`), pages through `listChildren` until done,
  runs `childrenToNodes`, records the child ids, returns nodes. A path not yet in the map answers
  `not-found`: every path the renderer can name was produced by a listing of its parent.
- `read(relPath)` - size check from metadata against the existing read limit, then `download` (or
  `exportMarkdown` for a Google Doc), decode through the same text rules as local; revision is
  `headRevisionId` (for a Google Doc, `modifiedTime`, and the file is read-only).
- `readBytes(relPath, limitBytes)` - for images referenced by a note.
- `write(...)`, `createDirectory`, `rename` - see below.
- `refresh()` - forgets the id map below the root, so the next listings re-read Drive.

**`providers.js`** - `OPENERS["google-drive"]`: checks the account is connected, fetches
`folderMeta(folderId)` (must be a folder, not trashed), and answers the usual record with
`root: null`, `vault: false`, and the folder's **current** name.

### Saving (PR 3)

Drive cannot refuse a stale write, so the shell does it in three steps:

1. **Check.** `fileMeta(id)` -> `headRevisionId`. If it differs from the editor's expected revision,
   answer `{ ok: false, reason: "conflict", theirs: { id: current } }` and write nothing.
2. **Write.** `uploadContent(id, bytes)` (BOM preserved as on GitHub).
3. **Confirm.** The upload's answer carries the new `headRevisionId`; that is the revision returned
   to the editor. The save indicator goes green on this answer and not before.

**The race this leaves:** another writer saving between steps 1 and 2 is overwritten. The window is
one round trip. It is recorded in Architecture.md and covered by a test that asserts the order of
calls, so a refactor cannot silently widen it (for example by moving the check before a slow encode).
Drive keeps revision history, so the overwritten version is recoverable from Drive's own UI - the
help article says so.

A write to a path not in the map (a new file) is a **create** in the parent folder (shipped in PR 3, 0.98.0). A Google
Doc answers `read-only`.

### Renderer (`apps/app/src`)

**PR 1**

- `workspaceClient.ts` - `GoogleBridge { googleStatus, connectGoogle, cancelGoogleConnect,
  disconnectGoogle }` and `googleBridge()`; added to `bridgeSurface.test.ts`'s `SURFACES`.
- `hooks/useGoogle.ts` - the `useGitHub` shape: `supported`, `configured`, `checking`, `connected`,
  `email`, `connecting`, `errorKey`; `connect()`, `cancel()`, `disconnect()`.
- `SettingsAccounts.tsx` - a Google Drive section beside GitHub: status line, Connect (which shows
  "Waiting for your browser..." and a Cancel button while consent is open), Disconnect, and a
  `not-configured` line for builds without a client.
- `failureKey` gains `scope-denied`, `timed-out` and `not-configured` (and `read-only` in PR 3).

**PR 2**

- `components/OpenDriveDialog.tsx` - not connected: the same connect control as Settings; connected:
  a folder browser over `google:folders` (My Drive, then Shared Drives, breadcrumb, Open this folder).
- `WorkspacePanel.tsx` - the fourth header button and source-menu entry; `SourceGlyph` and
  `sourceColour` cases for `"google-drive"` (the switches are exhaustive, so the compiler enforces it).
- Restoring at launch needs nothing new: `reopen` already opens refs sequentially and drops failures.

### PR 2 decisions taken while planning

These settle details the sections above left open. Where they differ from the text above, these win.

| Decision | Choice | Reason |
|---|---|---|
| Drive id shape | `DriveIdSchema` = `^[A-Za-z0-9_-]{1,256}$`, in `workspaceRef.ts`, used by the ref and by `google:folders` | Every Drive id is that alphabet. Validating it at the boundary means an id from settings or the renderer can never be spliced into a Drive query string as anything but an id. |
| A Google Doc's name in the tree | `<title>.md` (unless the title already ends in `.md`) | The renderer decides what it can open by extension. A bare title would be greyed out as an unknown type. |
| Characters a path cannot hold | `/`, `\`, `:` and control characters in a Drive name become `_`; an empty, `.` or `..` name becomes `_` | Drive allows all of them in a name; the path guard reads `/` as a separator and `C:` as drive-qualified. Renaming for display only - nothing is written. |
| Duplicate suffix | `stem~<first 6 of id>.ext`, applied after the two rules above | As in "Decisions taken"; applied to the final display name. |
| Read-only in PR 2 | The provider's `write` answers `read-only`; the renderer opens every text file from a Drive workspace with `readOnly: true` | The editor should not let a user type into a file it cannot save. `failureKey("read-only")` -> `errors.readOnly`. **Superseded in PR 3:** read-only is per file (Google Docs only) and Drive files are editable. |
| Provider-specific wording | `providerFailureKey(kind, reason)` in `useWorkspace.ts`: for `google-drive`, offline / rate-limited / not-connected use the `errors.google*` keys; everything else is `failureKey`. `useGoogle` uses it too | One mapping both the account section and the workspace use, so a Drive failure never names GitHub. |
| Re-listing a folder | Replaces that folder's direct children in the id map only | A refresh lists the root before the folders under it; dropping grandchildren would make an open file under an expanded folder briefly unreadable. |
| Folder picker top level | My Drive's folders, then Shared Drives. "Open this folder" is offered inside any folder and at a Shared Drive's root, not at the top level | Whole-My-Drive roots stay deferred. |
| Colour | A `drive` token (`--tp-drive`, `--color-drive`) defined in all three theme blocks | Same rule as every other source mark. |
| Connect from the picker | `GoogleAccountSection` gains `onConnected`; the picker shows it when a listing answers `not-connected` / `not-configured`, and reloads after connecting | No second connect control. |

## Error handling

| Situation | Where it shows |
|---|---|
| Not configured (no client in the build) | Settings and the open dialog say Google Drive is not available in this build. No button. |
| Consent cancelled or tab closed | Connect returns to idle; no error banner for `cancelled`, a message for `timed-out`. |
| Drive scope unticked at consent | `errors.scopeDenied`: explains that Trypthos needs Drive access to open folders. |
| Grant revoked in the Google account | Status shows not connected with the reason; opening a Drive workspace answers `not-connected`. |
| Offline / rate-limited while listing | On the folder row (`folders[path].status = "error"`), as GitHub. |
| Conflict on save | Existing `errors.conflict` banner; the user's text is kept and the revision is not advanced. **Superseded in PR 3:** worded for Google as `errors.driveConflict`. |
| Google Doc save attempted | `errors.readOnly`. The editor should not offer it; the shell refuses regardless. **Superseded in PR 3:** worded for Google as `errors.driveReadOnly`. |

## Testing

- **Domain (vitest):** URL builders; `readRedirect` (cancelled, state mismatch, missing code);
  `grantsDrive`; client config parsing (desktop accepted, web refused, junk refused); token and
  userinfo schemas; `childrenToNodes` (hidden types, Google Doc marked read-only, duplicate suffix is
  deterministic by `createdTime` then id, extension kept); error mapping; ref key/name/label; settings
  v22 -> v23 migration and a v23 file holding a Drive ref.
- **Shell (`node --test`):** `googleAuth` against a fake fetch, a fake `openExternal` that drives the
  loopback redirect with a real HTTP request, and an in-memory account store - happy path; refresh
  token stored only after success; state mismatch; scope denied; second connect cancels the first;
  timeout; refresh shared between concurrent callers; `invalid_grant`; disconnect revokes and deletes.
  IPC tests through the real `registerIpcHandlers`, including **the leak guard**: no channel's answer
  contains the refresh token or the access token. `googleClient` with and without the file.
  `googleDriveApi` with an `apiWith(routes)` fake fetch. `googleDriveWorkspace` with a fake API:
  listing, paging, the id map, `not-found` for an unlisted path, the save order (check -> write ->
  confirm), conflict writes nothing.
- **Renderer (vitest/jsdom):** `useGoogle` state machine; Settings section; open dialog; panel button;
  `i18nKeys` and dash guards cover the new strings automatically.
- **Manual (each PR):** against the Internal test project and a test folder, with
  `TRYPTHOS_GOOGLE_CLIENT` set.

## Delivery

| PR | Ships | Version |
|---|---|---|
| 1 | Connect a Google account in Settings -> Accounts. Client config + CI injection. CLAUDE.md order amended. | 0.96.0 |
| 2 | Open a Drive folder as a workspace (read-only until PR 3): picker over My Drive / Shared with me / shared drives, tree with spinners while folders load, read, images, Google Docs as markdown, refresh, reopen at launch, filter and Find in Files over the folders already opened. Settings v23. | 0.97.0 |
| 3 | Save with check-write-confirm and conflict as a result. **Delivered in 0.98.0:** Drive files are editable and Google Docs stay read-only; the chat's create-file tool can create a file in a Drive folder; My Drive is pinned to the account that opened it (`rootId`); a Refresh wins over a listing in flight. | 0.98.0 |
| 4 | Video and audio streamed from Drive (the media protocol forwards the player's byte ranges to Drive's download endpoint with `Range`, token held in main), and image viewing with Fit, 100% and zoom/pan by the usual gestures (Ctrl/Cmd + wheel and trackpad pinch to zoom about the pointer, drag to pan, double-click to toggle Fit and 100%) - for every source, not only Drive. Requested after the PR 2 manual check. | 0.99.0 |
| 5 | New file, new folder, rename in a Drive workspace. | 0.100.0 |

Each PR runs the CLAUDE.md release checklist. Architecture.md gains a Google Drive section in PR 1
(sign-in, token storage, client injection) and grows with each PR. The app has no help system yet, so
help articles (including one on Drive) land when one exists.

## Out of scope

Shortcuts; Sheets and Slides; the Changes API and live
refresh; offline caching; graph indexing of Drive folders; multiple Google accounts; the column
source browser; Google verification for a public release.

A My Drive workspace is stored as the alias `root`, not as a folder id, so it follows whichever Google
account is connected rather than a particular one.
