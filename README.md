# Trypthos

A desktop markdown editor for Windows and macOS, with a folder browser and an AI chat panel.

Trypthos is **wholly local**. There is no server and no account: your files stay on your machine,
chat talks directly to an endpoint you configure, and chats are stored locally.

## Features

| Feature | Description |
| --- | --- |
| Workspace browser | Open a local folder and browse it. OneDrive, Google Drive, Dropbox and GitHub follow. |
| File types | Choose which kinds of file Trypthos takes an interest in - markdown, plain text, thirty-odd data formats and languages, grouped and each off until you turn it on. A type that is off does not appear in the browser, cannot be opened, and is not offered to chat. |
| Syntax colouring | Every type is coloured by role - keywords, strings, comments, numbers, types and names - from the same palette as the rest of the app, in light and dark. Fenced code blocks inside a markdown document are coloured by the language on the fence, in all three views and in chat replies. Grammars load only when a file needs one. |
| Markdown editor | Live, Source and Preview views over one document, opening in the view you choose. A mode is a view, never a transform. |
| Formatting toolbar | Source view has a button for every markdown construct Trypthos renders. Headings toggle on the line you are on; bold, italic and the rest wrap what you have selected, and press again to remove. |
| Markdown guide | A syntax guide on the Help menu, opening in a read-only tab: every construct with an example, and the flavour of markdown named. |
| Tabs | Several files open at once, each with its own tab, its own unsaved changes and its own place in the document. Clicking a file already open goes to it rather than reloading it, and a list at the end of the strip reaches any tab that has scrolled out of sight. |
| Links | A link to a markdown file in the open folder opens it in the editor; a web address opens in your browser, never over the app. Hover shows the target. |
| AI chat | Appears once you configure a model, and can be switched off in Settings. Ask about your document, a selection, attached files or the whole folder, apply proposed changes, and watch how full the model's context is. The model is told what kind of file it is looking at, so a source file gets an answer about code rather than about prose. |
| Editing files | Open, edit and save, with a save refused if the file changed on disk since you opened it. Unsaved changes are never discarded without asking. |
| Appearance | Light, dark, or follow your system, from Settings. The window draws its own title bar. |
| Settings | One window with a page per subject: appearance, window behaviour, chat models, the system prompt, the editor, file types and About. |
| Layout | Resize or hide the side panels. Panel sizes and your open folder are remembered between launches. |
| File Explorer | On Windows, right-click a folder or a markdown file to open it in Trypthos. Switched on from Settings, and off again the same way. |
| Menus and shortcuts | Native File, Edit, Tools and Help menus, and a right-click menu with editing and spelling suggestions in every text field. |
| Updates | Checks GitHub for a newer release on startup, or on demand from the menu or the tray icon. |
| Local by default | No server, no account, no telemetry. Chats and settings live on your machine. |

Full prose descriptions: [docs/features.md](docs/features.md).

## Status

Usable for real work on local files. Open a folder, browse it, edit and save, with a save refused if
the file changed underneath you. The editor has Live, Source and Preview views over one document.

**Chat works**, once you have set it up: the panel is not in the window until you configure your
first model, and appears as soon as you do. Configure any OpenAI-compatible endpoint - a hosted provider, or a local model
through Ollama or LM Studio - and ask questions about the document you have open, or about a passage
you have selected. Replies stream in. Ask for a change rather than an answer and the reply comes back
as a card showing exactly what would be written and where; nothing reaches your document until you
press Apply, and one undo takes it back. Your API key is encrypted by the operating system and stored
outside your settings file.

**Not built yet:** cloud folders (OneDrive, Google Drive, Dropbox, GitHub), chat history that
survives closing the app, and giving chat access to the wider folder rather than one document.

Run it in a browser tab and there is no filesystem and nowhere to keep an API key, so the workspace
panel says so and the chat panel is not drawn at all - that is a supported way to work on the
interface, not a broken state.

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
