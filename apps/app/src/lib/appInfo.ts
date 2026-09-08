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
| Workspace browser | Open as many local folders as you like, each with its own tree, collapsible from its own row, and its own close button. They reopen next time you start. The filter box searches every open folder by name, however deep, and takes * and ? wildcards. Cloud accounts follow in a later release. |
| File types | Choose which kinds of file Trypthos opens: markdown, plain text, and thirty-odd data formats and languages, all on to begin with. Shell, PowerShell and batch scripts included. A file no enabled type covers is listed in grey and cannot be opened. |
| Images | PNG, JPEG, GIF, WebP, BMP, AVIF and ICO open in a tab, shown at their own size and zoomed with Shift and the wheel. Nothing to edit and nothing written back, and never sent to a chat model. |
| Syntax colouring | Each type is coloured by role, from the same palette as the rest of the app, in both themes. Fenced code is coloured by the language on the fence, in every view and in chat replies. Grammars load only when a file needs one. |
| Markdown editor | Live, Source and Preview views over one document, opening in the view you choose. Switching view never changes your file. |
| Find | Ctrl+F, or Edit > Find. Find marks every match in the open document and steps through them; Find in Files searches the selected folder and everything below it, opening each hit in a tab. Plain text or a regular expression, with or without matching case. Drag the panel by its tab strip to move it out of the way. |
| Zoom and pan | Hold Shift and turn the wheel to zoom, Shift and drag to move around, or press Ctrl with plus, minus and 0. Text grows in size, a picture is scaled for real. Each document keeps its own level, in every view. |
| Formatting toolbar | In Source view, a button for every markdown construct. Headings act on the current line, character formatting wraps your selection, and a second press removes what the first added. |
| Tabs | Open as many files as you like. Each has its own tab, keeps its own unsaved changes, and comes back where you left it. A list at the end of the strip reaches any of them. Right-click a tab for the five ways of closing: this one, everything to its right, all, others, or the saved ones. |
| Links | A link to a markdown file in your folder opens it here; a web address opens in your browser. Hover to see where a link goes. |
| AI chat | Appears once you configure a model, and can be switched off. Ask about your document, a selection, attached files or a folder you pick in the browser, apply proposed changes, and watch how full the context is. The model is told what kind of file it is looking at, and a model with a reasoning mode can be asked to think first. A reply says which files it read, and shows the model's thinking behind a fold. Reading a file works with or without tool calling. Type /commands or /tools in the chat box to see what it can do. A file path a reply mentions is a link that opens it. With a folder attached it can list, search and compare files inside it. It can open a file it found, and create a new one - never replacing an existing file. |
| Editing files | Open a file, edit it, and save with Ctrl+S. A save is refused if the file changed on disk, and unsaved changes are never discarded without asking. |
| New file | File > New, or Ctrl+N: name a file, pick its type from what you have turned on, and start writing. Where it goes is asked the first time you save. |
| Save As | Save the document somewhere else, from the File menu or Ctrl+Shift+S. The tab follows the new file, and the original is left as it was. Inside the folder you have open. |
| Appearance | Light, dark, or follow your system. The window draws its own title bar. |
| Settings | One window, a page per subject: appearance, window behaviour, chat models, the system prompt, the editor and file types. |
| Layout | Resize or hide the side panels. Trypthos remembers how you left them, and reopens your folder. |
| File Explorer | On Windows, right-click a folder or a markdown file to open it here. Switched on from Settings. |
| Recent files | Open Recent on the File menu lists the last ten files you opened, each with the folder it was in. Choosing one opens both, asking about unsaved work first. |
| Menus | File, Edit, Tools and Help, plus a right-click menu with editing and spelling corrections in every text field. Settings, About and the release notes are reached from the menus - on macOS, from the Trypthos menu. |
| Release notes | Help > Release Notes: what changed in each release, in full. Earlier releases are grouped into chapters; open one and every release in it is listed as it was written. |
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
