# Spec: OneDrive workspaces (personal accounts)

**Status: PR 1 delivered (0.102.0).** It is the design the work is measured against, agreed before the first line of it.

Trypthos opens local folders, Obsidian vaults, GitHub repositories and Google Drive folders. This
specifies the fifth source: **a folder in a personal OneDrive** - the whole OneDrive, any folder in
it, or a folder someone shared with you - opened as a workspace, browsed in the same tree, read and
edited in the same editor, and saved back with conflict detection. It matches Google Drive's
capability and look, and reuses what the Drive series built (media streaming, unavailable rows,
rename, Open in the provider).

**Personal Microsoft accounts only.** Work and school accounts (OneDrive for Business, SharePoint)
are out of scope; the app registration is set to personal accounts and nothing here is tested
against a business tenant.

## What the spike established

A throwaway spike (not committed) ran against a personal account on 2026-10-07, with a public-client
app registration (personal accounts only, redirect `http://localhost`, delegated
`Files.ReadWrite.All`, `offline_access`, `User.Read`). Each finding is a fact about Microsoft
Graph, not a guess.

| Question | Finding |
|---|---|
| Loopback sign-in with PKCE, no secret, `consumers` authority | **Works.** Token exchange 200, refresh token returned, access token lives 3599 s. |
| Granted scopes | `Files.ReadWrite.All User.Read`. `offline_access` is not echoed back but a refresh token is issued. |
| Refresh | 200, and **the refresh token rotates on every refresh**. |
| Who the account is | `/me` 200 with `mail` and `userPrincipalName`; `/me/drive` is `driveType=personal`. |
| Root and listings | Root has an `eTag` and no `cTag`. Children page with `$top` and `@odata.nextLink`. |
| Addressing by path | `items/{id}:/a/b.md` answers 200, **case-insensitively**. A missing path is 404 `itemNotFound`. An encoded `../` segment is 400. |
| Duplicate names | **Refused**, including a case-only difference: 409 `nameAlreadyExists`. A case-only rename succeeds. |
| Upload | `PUT items/{id}:/path:/content` into an existing folder creates the file and answers 201 with `eTag` and `cTag`. `.md` is `text/markdown`. |
| **Conditional write** | **Honoured.** A current `If-Match` writes (200). A stale `eTag`, a stale `cTag` and a fabricated value are all refused with **412**, and the content is untouched. |
| What changes the tags | A content write changes both `eTag` and `cTag`. A rename changes `eTag` only. |
| Creating without overwriting | `?@microsoft.graph.conflictBehavior=fail` on a content PUT onto an existing name answers 409. **`If-None-Match: *` is ignored** - it answered 200 and overwrote. |
| Rename | `PATCH {name}` 200. Onto an existing sibling, with or without a case difference: 409. |
| Downloads | `GET /content` answers **302** to a pre-authenticated URL on `microsoftpersonalcontent.com`. A `Range` request to that URL **without a token** answers 206 with `Content-Range`. `$select=@microsoft.graph.downloadUrl` returned nothing. |
| Delta | Works on a non-root folder of a personal drive (200 with a `deltaLink`). |
| Web addresses | `webUrl` on items, on `onedrive.live.com`. |
| Shared with me | `/me/drive/sharedWithMe` answers 200. The test account had one shared file and **no shared folder**, so listing a shared folder is **not yet verified** - see "Open questions". |

## Decisions taken, and why

| Decision | Choice | Reason |
|---|---|---|
| Scope | **`Files.ReadWrite.All offline_access User.Read`** | `Files.ReadWrite` cannot reach items shared with you; the user chose "mine + shared with me". All three are user-consentable for personal accounts. |
| Sign-in | **System browser, loopback redirect `http://localhost:<ephemeral>`, PKCE (S256), `state` check, `consumers` authority** | Microsoft's documented flow for public desktop clients, proven by the spike. No secret, no custom URI scheme. |
| Shared sign-in code | **`loopbackOAuth.js`**, extracted from `googleAuth.js` (listener, PKCE pair, state check) | Two providers, one implementation of the part that is easy to get subtly wrong. |
| What is stored | **The refresh token only**, in `accountStore` under `"onedrive"` | Same file and rules as GitHub and Google. The access token lives in main-process memory. |
| Rotating refresh token | **Every refresh writes the new refresh token before the access token is used; refreshes are single-flight** | The old token may stop working once a new one is issued. Two concurrent refreshes would race to store, and the loser's token could be the one kept. |
| Who the account is | **Asked of Graph** (`/me` `mail`, falling back to `userPrincipalName`) on every status check | As GitHub and Google: a stored name goes stale the moment consent is revoked. |
| Consent check | **A grant missing `Files.ReadWrite.All` or `User.Read` is refused** with `scope-denied` and not stored | As Google's granular-consent check. |
| Client ID | **Injected at build time** from the CI secret `ONEDRIVE_CLIENT_ID`; read from `.secrets/onedrive-client.json` (`TRYPTHOS_ONEDRIVE_CLIENT`) in development | Not a secret, but a committed ID would tie every fork's users, sign-in logs and rate limits to this registration. A build without it reports `not-configured` and offers no OneDrive source, as Google does. |
| API client | **Hand-rolled over Electron `net.fetch`** | As Drive: keeps the system proxy and certificate store, and a handful of endpoints do not need the Graph SDK or MSAL (which would bring a second HTTP stack and its own token cache). |
| Paths | **Name paths, addressed by path in Graph** (`/drives/{driveId}/items/{itemId}:/{encoded path}`) | OneDrive addresses by path and forbids duplicate names, so the Drive provider's id map, duplicate suffix and rename re-keying are not needed. Our path guard still runs first. |
| Path encoding | **Each segment `encodeURIComponent`-ed and joined with `/`** | A `#`, `?` or `%` in a name must not end the path or start a query. |
| Case | **Treated as case-insensitive within a folder** | OneDrive is. The rename dialog's sibling check already compares case-insensitively. |
| Revision | **`cTag`** | Changes on a content write, not on a rename - so renaming an open file does not make its tab look changed elsewhere. Accepted by `If-Match` (spike). |
| Save | **One conditional write: `PUT .../content` with `If-Match: <cTag>`; 412 is `conflict`** | OneDrive honours `If-Match`, so Drive's check-write-confirm sequence and its race window do not apply. |
| Create (chat, New File) | **`?@microsoft.graph.conflictBehavior=fail`; 409 is `exists`** | `If-None-Match: *` was ignored by the server in the spike and overwrote a file. |
| Large uploads | **Single PUT only; a file over 4 MB is refused as `too-large`** | Graph's simple upload limit. Text files are already capped below it by `MAX_TEXT_FILE_BYTES`; upload sessions are not needed. |
| Media | **The tp-media byte source asks Graph for the 302 location per playback, then fetches ranges from that URL without a token** | The URL is pre-authenticated and short-lived. It stays in main; the renderer still sees only `tp-media://`. An expired URL (401/403) is fetched again once. |
| Office files | **Listed like any other file of their type**; Open in OneDrive opens them in Office on the web | There is no export to markdown as there is for Google Docs, and nothing here should pretend a `.docx` is text. |
| Workspace root | **The whole OneDrive, any folder in it, or a folder shared with you**, chosen in the shared folder picker | Matches Drive. Personal OneDrive has no shared drives. |
| Workspace ref | **`{ kind: "onedrive", driveId, itemId, name }`**, settings version 24 -> 25 | `driveId` is needed because a shared folder lives in another person's drive. The strict union means an older build would otherwise drop every remembered workspace. |
| Another account | **A remembered own-drive ref whose `driveId` is not the connected account's drive answers `other-account`** | As My Drive: the workspace shows greyed out and the banner names the problem. A shared folder's `driveId` is someone else's by design and is not checked this way. |
| Freshness | **Manual refresh** | As Drive. Delta is a later improvement. |
| Graph index | **Not indexed** | One request per file against a rate limit, as Drive and GitHub. |
| Picker and settings UI | **Shared components**: `GoogleAccountSection` becomes a provider-neutral account section; `OpenDriveDialog` becomes a provider-neutral folder picker | Same look and feel by construction, rather than a copy that drifts. |

## Distribution

Personal accounts consent for themselves; no admin consent and no restricted-scope review apply.
Microsoft's consent page shows the app as **unverified** until the registration has a verified
publisher (a Microsoft Partner Network account). That is a release choice, not a build one.

The README gains a short section telling anyone who builds Trypthos themselves to register their own
app (personal accounts only, `http://localhost`, public client flows on, the three delegated
permissions) and set `ONEDRIVE_CLIENT_ID`.

## What already exists, and where the seams are

- **`googleAuth.js`** holds the loopback listener (`listenOnce`) and PKCE; both move to
  `loopbackOAuth.js` in PR 1 with Google's tests still passing unchanged.
- **`googleClient.js`** is the pattern for `microsoftClient.js`: packaged file under
  `resources/build/`, development file named by an environment variable.
- **`desktop-release.yml`** writes `google-oauth-client.json` from a secret;
  `electron-builder.config.cjs` copies it via `extraResources`. OneDrive adds
  `onedrive-client.json` the same way.
- **`accountStore.js`** keeps one encrypted string per provider kind.
- **`registerIpcHandlers`** takes provider factories as dependencies; OneDrive adds
  `microsoft` (the auth instance) and `createOneDrive` (the API factory).
- **`providers.js` `OPENERS`** and **`PROVIDER_KINDS`**; `providers.test.js` fails if a kind has
  no opener.
- **`createPathGuard`** is lexical and already serves GitHub (`/repo`) and Drive (`/drive`).
  OneDrive uses it over `/onedrive`.
- **`mediaProtocol.js` / `locateMedia`** serve a byte source `{ ok, size, open(start, end, signal) }`.
  OneDrive supplies one.
- **Optional provider members are feature-detected** (`createDirectory`, `rename`, `webAddress`,
  `mediaSource`), so each PR's capabilities light up as their methods arrive.
- **`useWorkspace.unavailable`**, the saving spinner and the conflict prompt are provider-neutral.
- **The leak guards** - the channel walk in `githubIpc.test.js` / `googleIpc.test.js` and the log
  checks - extend to the Microsoft access and refresh tokens.

## Architecture

### Domain (`packages/domain/src`, pure)

- **`workspaceRef.ts`**: the `onedrive` variant; `workspaceRefKey` is
  `onedrive:<driveId>:<itemId>`, not case-folded (Graph ids are case-sensitive); `workspaceRefName` is `name`; `workspaceRefMark` is
  `"onedrive"`; `workspaceRefLabel` is `OneDrive: <name>`.
- **`settings.ts`**: version 25 and a migration that changes nothing but the number (the new kind is
  additive), written in the PR that adds the kind.
- **`oneDrive.ts`**:
  - Zod schemas for a driveItem (`id`, `name`, `size`, `folder`, `file.mimeType`, `eTag`, `cTag`,
    `webUrl`, `parentReference.driveId`, `remoteItem`), a children page (`value`, `@odata.nextLink`),
    `/me`, `/me/drive`, the token response and Graph's error body (`error.code`).
  - Address builders: `itemUrl(driveId, itemId)`, `pathUrl(driveId, itemId, path)` (per-segment
    encoding), `childrenUrl`, `contentUrl`, `createUrl` (with `conflictBehavior=fail`),
    `sharedWithMeUrl`, the authorize and token URLs.
  - `oneDriveFailure(status, code)` - one mapping from HTTP status and Graph code to the app's
    failure reasons, shared by API and provider.

### Shell (`apps/desktop/src`, CommonJS)

- **`loopbackOAuth.js`** (PR 1): `listenOnce`, `pkcePair`, `checkState` - moved, not rewritten.
- **`microsoftClient.js`** (PR 1): `loadMicrosoftClient({ packaged, resourcesPath, env })` answers
  `{ clientId }` or `null`.
- **`microsoftAuth.js`** (PR 1): `createMicrosoftAuth({ client, accounts, openExternal, fetch })` with
  `status()`, `connect()`, `cancelConnect()`, `disconnect()`, `accessToken()`.
  - `connect` opens the authorize URL through `openExternal`, waits on the loopback, exchanges the
    code, checks scopes, stores the refresh token, then reads `/me`.
  - `accessToken` returns the cached token until 60 s before expiry, then refreshes. A refresh is
    single-flight (one promise shared by concurrent callers) and stores the rotated refresh token
    before resolving.
  - `invalid_grant` on refresh clears the stored token and reports `not-connected`.
  - `disconnect` forgets the stored token. Personal-account tokens cannot be revoked by the app;
    the Settings text says to remove the app's access at account.live.com if the user wants that too.
- **`oneDriveApi.js`** (PR 1 for `/me` and `/me/drive`; PR 2 for reads; PR 3 for writes):
  `createOneDriveApi({ accessToken, fetch })`. Each call: one retry after a 401 (with a fresh
  token), one after 429/503 honouring `Retry-After` up to 10 s, a deadline on headers.
  - Reads: `me`, `drive`, `children(driveId, itemId, path)` (all pages, capped at the tree's
    listing limit), `item(driveId, itemId, path)`, `readText(..., limitBytes)`,
    `downloadLocation(...)` (302 `Location`, never followed with the token), `sharedWithMe`.
  - Writes: `writeText(..., cTag)`, `createText(...)`, `createFolder(...)`, `rename(..., newName)`.
  - A ranged read from the pre-authenticated URL accepts 206 with a `Content-Range` matching the
    request, or 200 only for a whole-file range - the same rule as Drive's `downloadRange`.
- **`oneDriveWorkspace.js`** (PR 2, extended in PR 3): the provider. `GUARD_ROOT = "/onedrive"`.
  `list`, `read` (revision `{ id: cTag }`), `mediaSource`, `webAddress`; then `write`, `create`,
  `createDirectory`, `rename`. A short listing cache (as Drive's TTL) is kept for the tree and
  dropped for a folder on any write into it.
- **`ipcHandlers.js`**: `onedrive:status`, `onedrive:connect`, `onedrive:cancelConnect`,
  `onedrive:disconnect` (PR 1); `onedrive:folders` (PR 2) answering
  `{ ok, folders: [{ driveId, itemId, name, shared }] }` for the picker, never a token or a URL.
- **`providers.js`**: the `onedrive` opener (PR 2), which checks the connected account's drive id
  for an own-drive ref and answers `other-account` on a mismatch.
- **Release**: `desktop-release.yml` writes `apps/desktop/build/onedrive-client.json` from
  `ONEDRIVE_CLIENT_ID`; `electron-builder.config.cjs` includes it.

### Renderer (`apps/app/src`)

- **`CloudAccountSection`** (PR 1): `GoogleAccountSection` generalised over a provider description
  (name, glyph, the four calls, the "remove access" help text). Google's tests keep passing.
- **`OpenCloudFolderDialog`** (PR 2): `OpenDriveDialog` generalised over a folder source. OneDrive's
  tabs are **My files** and **Shared with me**.
- **Header button** with OneDrive's mark (PR 2), shown only when the shell reports OneDrive
  configured and connected - as Google's is.
- **`SourceGlyph`**: an `onedrive` mark and colour token in `index.css`, light and dark.
- **`workspaceCapabilities.ts`**: `canEditTree` and `opensInBrowser` include `onedrive` (PR 3 for
  editing, PR 2 for opening in the browser).
- **Strings**: `workspace.openInOneDrive`, `settings.onedrive.*`, `errors.onedrive*` - all through the
  catalogue, no em or en dashes.

## Error handling

| Graph answer | App result |
|---|---|
| 401 | Refresh once and retry; then `not-connected` |
| `invalid_grant` on refresh | Forget the token, `not-connected` |
| 403 `accessDenied` | `permission-denied` (e.g. saving into a view-only shared folder) |
| 404 `itemNotFound` | `not-found` |
| 409 `nameAlreadyExists` | `exists` |
| 412 | `conflict` (save) |
| 413, or a body over 4 MB | `too-large` |
| 429, 503 | Wait `Retry-After` (at most 10 s), retry once, then `busy` |
| Network failure or deadline | `offline` / `unknown` - **never** `not-found` |
| Own-drive ref, different account | `other-account` |

Logs carry a step name and `error.code ?? error.name` only: never a token, a URL, a file name or a path.

## Testing

TDD throughout. Every Graph and login response comes from a hand-written fake `fetch`.

- **Domain**: schemas accept the spike's shapes and reject malformed ones; `pathUrl` encodes `#`,
  `%`, `?`, spaces and non-ASCII per segment; the failure mapping table above, row by row; the
  settings migration 24 -> 25 keeps every existing workspace.
- **`loopbackOAuth`**: Google's existing tests pass after the move.
- **`microsoftAuth`**: state mismatch, cancel, scope refusal, the rotated refresh token is stored on
  every refresh, two concurrent `accessToken()` calls make one refresh request, `invalid_grant`
  clears the store.
- **`oneDriveApi`**: 401 retry, `Retry-After` cap, `If-Match` present on every write,
  `conflictBehavior=fail` on every create and absent `If-None-Match`, the 302 is never followed
  with the `Authorization` header, a ranged 200 is accepted only for a whole-file range.
- **Provider**: the guard refuses `..`, absolute, drive-letter and UNC paths before any request;
  listing across pages; read revision is `cTag`; save maps 412 to `conflict`; rename and create map
  409 to `exists`; media re-fetches an expired location once.
- **Leak guards**: the IPC walk and log capture assert the exact access and refresh token strings
  are absent (the CodeQL lesson: exact values, not host-name substrings).
- **Renderer**: Google's account and picker tests unchanged; OneDrive variants of each; the header
  button appears only when configured and connected.

## Delivery

Three PRs, each a Minor bump, each with the release checklist in CLAUDE.md:

1. **Connect a Microsoft account (0.102.0)** - `loopbackOAuth` extraction, `microsoftClient`,
   `microsoftAuth`, `oneDriveApi.me/drive`, the `onedrive:*` account channels, `CloudAccountSection`,
   the release workflow and builder config, README fork note, leak guards. CLAUDE.md's provider
   order becomes "OneDrive, Dropbox" remaining, and its status line mentions OneDrive.
2. **Browse OneDrive (0.103.0)** - the ref kind and settings 25, reads, `oneDriveWorkspace` (list,
   read, media, web address), `onedrive:folders`, `OpenCloudFolderDialog`, header button, glyph,
   Open in OneDrive, refresh, `other-account`. Read-only.
3. **Write to OneDrive (0.104.0)** - save with `If-Match`, chat create, New File, New Folder, rename.

## Open questions

- **Listing a shared folder** was not exercised: the test account had no folder shared with it.
  PR 2's manual check needs one (a second Microsoft account sharing a test folder is enough). If
  `sharedWithMe` or the cross-drive listing behaves differently, PR 2 records the finding here and
  the Shared with me tab may ship later.
- **`sharedWithMe` longevity**: not verified either way; Graph endpoints for shared items have
  changed before. PR 2 treats an error from it as "nothing shared" in the picker rather than failing the
  dialog.

## Out of scope

- Work and school accounts, SharePoint sites, and shared libraries.
- Save As into OneDrive (the operating system's dialog cannot see it - as Drive).
- Upload sessions for files over 4 MB.
- Delta-based refresh, and indexing OneDrive notes for the graph.
- Personal Vault (Microsoft hides it from Graph unless unlocked).
- Publisher verification of the app registration.
