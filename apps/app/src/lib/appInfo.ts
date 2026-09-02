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
| Markdown editor | Live, Source and Preview views over one document. Switching view never changes your file. |
| AI chat | Ask about the open document and the wider folder, using an endpoint and model you configure. |
| Editing files | Open a file, edit it, and save with Ctrl+S. A save is refused if the file changed on disk. |
| Appearance | Follows your system light or dark theme, with the window drawing its own title bar. |
| Layout | Resize or hide the side panels. Trypthos remembers how you left them, and reopens your folder. |
| Local by default | No server and no account. Your files stay on your machine; chats are stored locally. |
`.trim();

/// Third-party components a user should know are involved. Add a row when a new library, model or AI
/// provider is introduced.
export const DISCLAIMERS: readonly string[] = [
  "Built with Electron and React.",
  "Editing is provided by CodeMirror 6. Preview is rendered with marked and sanitised with DOMPurify.",
  "Chat requests go directly from this app to the endpoint you configure. No Trypthos server is involved.",
];
