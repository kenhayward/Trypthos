# Trypthos

A desktop markdown editor for Windows and macOS, with a folder browser and an AI chat panel.

Trypthos is **wholly local**. There is no server and no account: your files stay on your machine,
chat talks directly to an endpoint you configure, and chats are stored locally.

## Features

| Feature | Description |
| --- | --- |
| Workspace browser | Browse a folder as a tree. Local now; OneDrive, Google Drive, Dropbox and GitHub follow. |
| Markdown editor | Source and Preview views over one document. A mode is a view, never a transform. Live is next. |
| AI chat | Ask about the open document and the wider folder, using an endpoint and model you configure. |
| Local by default | No server, no account, no telemetry. Chats and settings live on your machine. |

Full prose descriptions: [docs/features.md](docs/features.md).

## Status

Early. The markdown editor works: Source and Preview views over one document. The folder backends
and the chat client are not built yet, so there is nothing to open or save - the editor opens on an
in-memory scratch buffer. See the roadmap below.

**Builds are unsigned.** Windows SmartScreen will warn on first install, and macOS needs
right-click then Open. Developer ID signing and notarization are outstanding work.

## Getting started

```bash
npm ci
npm run app
```

That starts the interface and the desktop window together, with hot reload - edit anything under
`apps/app/src` and the running window updates. The window retries while the dev server is still
starting, so the order they come up in does not matter.

To run just the interface in a browser tab instead:

```bash
npm run dev --workspace trypthos-app     # http://localhost:5173
```

Checks, all of which CI runs on every pull request:

```bash
npm run lint && npm run typecheck && npm run build && npm test
```

## Architecture

| Component | Stack | Path |
| --- | --- | --- |
| Desktop shell | Electron - windows, filesystem, provider calls, credential storage | `apps/desktop` |
| Renderer | React 19, TypeScript, Vite, Tailwind v4 | `apps/app` |
| Domain | Pure TypeScript - no React, no Electron, no filesystem | `packages/domain` |

More detail: [docs/Architecture.md](docs/Architecture.md).

## Roadmap

1. **Editor** - Source and Preview are in. Live decorations next: markers hidden except on the
   caret line.
2. **Local workspace** - real folder tree, file watching, open and save.
3. **Chat** - provider calls from the main process, streamed to the panel.
4. **Cloud providers** - OneDrive, then Google Drive, Dropbox and GitHub.
5. **Signing** - Developer ID and notarization, so installs stop warning.

## Licence

Not yet chosen.
