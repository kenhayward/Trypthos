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
| Markdown editor | Live, Source and Preview views over one document, opening in the view you choose. Switching view never changes your file. |
| Links | A link to a markdown file in your folder opens it here; a web address opens in your browser. Hover to see where a link goes. |
| AI chat | Appears once you configure a model, and can be switched off. Ask about your document, a selection, attached files or the folder, apply proposed changes, and watch how full the context is. |
| Editing files | Open a file, edit it, and save with Ctrl+S. A save is refused if the file changed on disk, and unsaved changes are never discarded without asking. |
| Appearance | Light, dark, or follow your system. The window draws its own title bar. |
| Settings | One window, a page per subject: appearance, window behaviour, chat models, the system prompt and the editor. |
| Layout | Resize or hide the side panels. Trypthos remembers how you left them, and reopens your folder. |
| Menus | File, Edit, Tools and Help, plus a right-click menu with editing and spelling corrections in every text field. |
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
