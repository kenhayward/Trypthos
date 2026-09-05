/// What the app is, for the About box and the help pages.
///
/// Lives here rather than beside the release notes so the eager About box does not drag the release
/// history into the initial bundle.
export const APP_NAME = "Trypthos";

export const APP_VERSION = __APP_VERSION__;

/// A concise two-column markdown table, one line per feature. Add or edit a row when the app's scope
/// changes - do not reintroduce long prose; the About box renders this directly.
export const CAPABILITIES = `
| Feature | Description |
| --- | --- |
| Workspace browser | Open a local folder and browse it. Cloud accounts follow in a later release. |
| File types | Choose which kinds of file Trypthos shows: markdown, plain text, and thirty-odd data formats and languages, each off until you turn it on. A type that is off is not listed, not opened, and not offered to chat. |
| Syntax colouring | Each type is coloured by role, from the same palette as the rest of the app, in both themes. Fenced code in a markdown document is coloured by the language on the fence. Grammars load only when a file needs one. |
| Markdown editor | Live, Source and Preview views over one document, opening in the view you choose. Switching view never changes your file. |
| Formatting toolbar | In Source view, a button for every markdown construct. Headings act on the current line, character formatting wraps your selection, and a second press removes what the first added. |
| Tabs | Open as many files as you like. Each has its own tab, keeps its own unsaved changes, and comes back where you left it. A list at the end of the strip reaches any of them. |
| Links | A link to a markdown file in your folder opens it here; a web address opens in your browser. Hover to see where a link goes. |
| AI chat | Appears once you configure a model, and can be switched off. Ask about your document, a selection, attached files or the folder, apply proposed changes, and watch how full the context is. The model is told what kind of file it is looking at. |
| Editing files | Open a file, edit it, and save with Ctrl+S. A save is refused if the file changed on disk, and unsaved changes are never discarded without asking. |
| Appearance | Light, dark, or follow your system. The window draws its own title bar. |
| Settings | One window, a page per subject: appearance, window behaviour, chat models, the system prompt, the editor and file types. |
| Layout | Resize or hide the side panels. Trypthos remembers how you left them, and reopens your folder. |
| File Explorer | On Windows, right-click a folder or a markdown file to open it here. Switched on from Settings. |
| Menus | File, Edit, Tools and Help, plus a right-click menu with editing and spelling corrections in every text field. |
| Markdown guide | A syntax guide on the Help menu, opening in a read-only tab: every construct Trypthos renders, with examples, and the flavour of markdown named. |
| Updates | Checks for a newer version on startup, or on demand from the Help menu or the tray icon. |
| Local by default | No server and no account. Your files stay on your machine; chats are stored locally. |
`.trim();

/// Third-party components a user should know are involved. Add a row when a new library, model or AI
/// provider is introduced.
export const DISCLAIMERS: readonly string[] = [
  "Built with Electron and React.",
  "Editing is provided by CodeMirror 6. Preview is rendered with marked and sanitised with DOMPurify.",
  "Updates are checked against this project's public GitHub releases. Nothing else is sent.",
  "Chat requests go directly from this app to the endpoint you configure. No Trypthos server is involved.",
];
