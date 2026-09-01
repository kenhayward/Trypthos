# Architecture

Internal reference. Carries no version number; must be accurate. Update it in the same PR whenever a
component, cross-process contract, external dependency, stored-data shape or packaging detail changes.

## Components

| Component | Stack | Path |
| --- | --- | --- |
| Desktop shell (main process) | Electron, CommonJS | `apps/desktop` |
| Renderer | React 19, TypeScript, Vite, Tailwind v4 | `apps/app` |
| Domain | Pure TypeScript, zod | `packages/domain` |

One npm workspace, one lock file, one `npm ci`.

There is **no server**. Chat calls the provider directly from the main process, and everything the
app stores is a local file. That is the fact most other decisions here follow from.

## Process split, and why the boundary sits where it does

The renderer is untrusted: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no `webview`
tag, `webSecurity` on. Those five flags are asserted by `apps/desktop/test/windowOptions.test.js`
rather than left to review - each is one word, each defaults the unsafe way in older guides, and a
window with the wrong value behaves identically until a page it loads is hostile.

The preload exposes a **narrow, enumerated** bridge. There is deliberately no general "invoke any
channel" or "run this fs call" helper, because one would make the enumeration decorative. Every IPC
handler validates its own arguments in the main process; the renderer having already checked is not
a check.

**Provider calls live in the main process.** The renderer sends a turn and receives streamed tokens
over IPC. It never holds an API key and never opens a socket to a provider, because a key in the
renderer is a key in devtools, in the network panel, and in any renderer crash dump.

## The domain package

`packages/domain` imports nothing from React, Electron or `fs`. It is types plus logic, usable from
both processes and testable without booting either.

- `workspacePath.ts` - the workspace boundary check, in one place. **Lexical only**: it cannot see
  symlinks, because the package has no filesystem access. The main process must resolve a candidate
  to its real path first. A lexical check alone is satisfied by `notes.md` when `notes.md` is a
  symlink to `/etc/passwd`.
- `persisted.ts` - reading anything previously written. Every persisted document carries a
  `schemaVersion`; a reader never guesses one, and an unversioned or future-versioned document is
  refused rather than tolerated.
- `chat.ts` - chat profiles. The schema is `strict()` so an `apiKey` reaching a settings file is a
  loud parse failure, not a silently stripped field that gets written back out.
- `provider.ts` - the storage contract. A write **returns a revision, never void**, and a conflict is
  a **result, not an exception** - both shaped for GitHub, where a save is a commit, before any cloud
  backend exists.

## Storage providers

Order: local (now), OneDrive, Google Drive, Dropbox, GitHub.

The first three share a shape: OAuth, a mutable file at a stable id, delta sync, last-writer-wins.
GitHub does not - there is no mutable path, and a save is a commit on a branch with history and merge
conflicts. The interface is shaped for that from the start, because retrofitting a return value
through every call site later is the expensive version of the same change.

## Release notes and the bundle boundary

`apps/app/src/lib/releaseNotes/` is split five ways so the archive - which grows without bound - never
reaches the initial bundle. `current.ts` is the file every PR edits; `archive.ts` may be imported only
by the epoch drill-down page, and the barrel must not re-export `ARCHIVE`.

Nothing enforces that but who imports what, so `bundleBoundary.test.ts` asserts the module graph
directly: an eager `import { ARCHIVE }` type-checks, renders correctly, and passes every other test
while putting the whole history on every page load.

The About box reads `lib/appInfo.ts` instead, which is why the capability table lives there.

## Packaging

`electron-builder` on a `v*` tag builds the Windows installer and the macOS `.dmg` and publishes them
to GitHub Releases. Builds are **unsigned**: Developer ID signing, notarization and a working
Squirrel.Mac update path are outstanding.

Because there is no server, **every user-facing change needs a release** to reach anyone.
