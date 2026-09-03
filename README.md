# Trypthos

A desktop markdown editor for Windows and macOS, with a folder browser and an AI chat panel.

Trypthos is **wholly local**. There is no server and no account: your files stay on your machine,
chat talks directly to an endpoint you configure, and chats are stored locally.

## Features

| Feature | Description |
| --- | --- |
| Workspace browser | Open a local folder and browse it. OneDrive, Google Drive, Dropbox and GitHub follow. |
| Markdown editor | Live, Source and Preview views over one document. A mode is a view, never a transform. |
| AI chat | Ask about your document, a selection, attached files or the whole folder. Apply proposed changes, and keep the conversation. |
| Editing files | Open, edit and save, with a save refused if the file changed on disk since you opened it. |
| Appearance | Light, dark, or follow your system, from Preferences. The window draws its own title bar. |
| Layout | Resize or hide the side panels. Panel sizes and your open folder are remembered between launches. |
| Menus and shortcuts | Native File, Edit, Tools and Help menus, and a right-click menu with spelling suggestions. |
| Updates | Checks GitHub for a newer release on startup, or on demand from the menu or the tray icon. |
| Local by default | No server, no account, no telemetry. Chats and settings live on your machine. |

Full prose descriptions: [docs/features.md](docs/features.md).

## Status

Usable for real work on local files. Open a folder, browse it, edit and save, with a save refused if
the file changed underneath you. The editor has Live, Source and Preview views over one document.

**Chat works.** Configure any OpenAI-compatible endpoint - a hosted provider, or a local model
through Ollama or LM Studio - and ask questions about the document you have open, or about a passage
you have selected. Replies stream in. Ask for a change rather than an answer and the reply comes back
as a card showing exactly what would be written and where; nothing reaches your document until you
press Apply, and one undo takes it back. Your API key is encrypted by the operating system and stored
outside your settings file.

**Not built yet:** cloud folders (OneDrive, Google Drive, Dropbox, GitHub), chat history that
survives closing the app, and giving chat access to the wider folder rather than one document.

Run it in a browser tab and there is no filesystem and no chat, so those panels say so - that is a
supported way to work on the interface, not a broken state.

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

1. **Editor** - Live, Source and Preview are in. Tables, images and footnotes still render as
   source in Live mode; each gets a decoration in turn.
2. **Local workspace** - open, browse, edit and save are in. Still to come: a proper tree, file
   watching, and creating or renaming files.
3. **Chat** - asking, streaming and applying proposed changes are in. Still to come: the wider
   folder as context, saved conversations, and attachments.
4. **Cloud providers** - OneDrive, then Google Drive, Dropbox and GitHub.
5. **Signing** - Developer ID and notarization, so installs stop warning.

## Licence

Not yet chosen.
