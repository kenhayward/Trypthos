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
| Workspace browser | Open as many folders as you like - on this machine or on GitHub - each with its own tree, collapsible from its own row, and its own close button. They reopen next time you start. Right-click a local folder to make a file or folder there, or a file or its tab to open it in a focused document-only window, unsaved changes included. Right-click a local file or folder to rename it or show it in Explorer or Finder. Right-click one to refresh it. The filter box searches every open folder by name, however deep, and takes * and ? wildcards. With Obsidian installed, open one of its vaults from a list; it opens as a folder marked with Obsidian's logo. Right-click empty space in the panel for the same open choices as its header. The triangle on a row opens and closes it, and the space around the triangle counts as part of it; clicking a row's icon or name picks that folder for chat and leaves it as it was, and the Left and Right arrows open and close it. Where a vault has icons assigned with Obsidian's Iconic plugin, its folders and notes are drawn with those icons, in the colour chosen there. OneDrive, Google Drive and Dropbox follow in a later release. |
| GitHub repositories | Connect your GitHub account with a personal access token and open a repository as another tree beside your folders. Clicking a repository's name opens its home page: the owner, eight figures about it, what a fork came from and how far it has moved, the commit you are on and the latest update on its branch, and its README rendered below, with a Refresh that asks GitHub again. It lists the repositories you own, public and private, with a search box over them. A repository opens at the head of its default branch, pinned to the commit it was at when you opened it; right-click it and choose Refresh to move to the newest commit, which asks first. Saving makes a commit: the first save in a repository asks which branch it goes to, and every save after that commits straight there. Opening a pull request is not built yet. |
| File types | Choose which kinds of file Trypthos opens: markdown, plain text, and thirty-odd data formats and languages, all on to begin with. Shell, PowerShell and batch scripts included. A file no enabled type covers is listed in grey and cannot be opened. |
| Images | PNG, JPEG, GIF, WebP, BMP, AVIF and ICO open in a tab, shown at their own size and zoomed with Shift and the wheel. Nothing to edit and nothing written back, and never sent to a chat model. |
| Syntax colouring | Each type is coloured by role, from the same palette as the rest of the app, in both themes. Fenced code is coloured by the language on the fence, in every view and in chat replies. Grammars load only when a file needs one. |
| Markdown editor | Live, Source and Preview views over one document, opening in the view you choose. Switching view never changes your file. Pictures the document embeds are drawn in Preview, read from your folder rather than the web. Preview renders GFM with footnotes, alerts and front matter, and Obsidian notes with their wiki links, embedded notes and pictures, callouts, highlights, tags and math; a status bar chip says which, and lets you choose. Mermaid diagrams are drawn, and Live and Source understand Obsidian's marks. |
| Home page and graph | Click any workspace's name to open its home page: what it is, how many notes, links and attachments it holds, its README, and its graph, each given the whole page in turn. Any local folder whose notes link to each other has a graph, not only an Obsidian vault; build and dependency folders and whatever its .gitignore excludes are left out, and a graph stops at 5,000 notes and says so. Search it, filter it, double-click a note to open it or a missing note to create it. A local graph under the folder browser follows the note you are editing. Built when a folder opens and kept current as you save in Trypthos. |
| Find | Ctrl+F, or Edit > Find. Find marks every match in the open document and steps through them; Find in Files searches the selected folder and everything below it, opening each hit in a tab. Plain text or a regular expression, with or without matching case. Drag the panel by its tab strip to move it out of the way. |
| Zoom and pan | Hold Shift and turn the wheel to zoom, Shift and drag to move around, or press Ctrl with plus, minus and 0. Text grows in size, a picture is scaled for real. Each document keeps its own level, in every view. |
| Formatting toolbar | In Source view, a button for every markdown construct. Headings act on the current line, character formatting wraps your selection, and a second press removes what the first added. |
| Tabs | Open as many files as you like. Each has its own tab, keeps its own unsaved changes, and comes back where you left it. A list at the end of the strip reaches any of them. Right-click a tab for the five ways of closing: this one, everything to its right, all, others, or the saved ones. |
| Links | A link to a markdown file in your folder opens it here; a web address opens in your browser. Hover to see where a link goes. |
| AI chat | Appears once you configure a model, and can be switched off. The chat box grows as you type. Ask about your document, a selection, attached files (picked, or added or dragged from the browser) or a folder you pick in the browser, apply proposed changes, and watch how full the context is. The model is told what kind of file it is looking at, and a model with a reasoning mode can be asked to think first. A reply normally streams as it arrives, and each model can ask for a complete reply instead when its streamed tool calls are incomplete, and has its own reply timeout and tool call limit. A reply lists its tool calls and the model's thinking, each behind a fold. Reading a file works with or without tool calling. Save a conversation under a name, with its attached files' text and its folder's path, and reopen it as it was. See how the latest reply went - time to first token, response time, tokens per second, tokens and context used - open a log of every request and response, and copy a reply as markdown. Type /commands or /tools in the chat box to see what it can do. A file path a reply mentions is a link that opens it. With a folder attached it sees its files and subfolders, can list everything below a folder in one call, read any enabled file inside it at any depth, and search or compare files there. It can open a file it found, and create a new one - never replacing an existing file. |
| Editing files | Open a file, edit it, and save with Ctrl+S. A save is refused if the file changed on disk, and unsaved changes are never discarded without asking. |
| New file | File > New, or Ctrl+N: name a file, pick its type from what you have turned on, and start writing. Where it goes is asked the first time you save. |
| Save As | Save the document somewhere else, from the File menu or Ctrl+Shift+S. The tab follows the new file, and the original is left as it was. Inside the folder you have open. |
| Appearance | Light, dark, or follow your system. The window draws its own title bar. |
| Settings | One window, a page per subject: appearance, window behaviour, chat models, the system prompt, the editor and file types. |
| Layout | Resize or hide the side panels, or hide the editor to give the chat the room. Trypthos remembers how you left them, and reopens your folder. |
| File Explorer | On Windows, right-click a folder or a markdown file to open it here. Switched on from Settings. |
| Recent files | Open Recent on the File menu lists the last ten files you opened, each with the folder it was in. Choosing one opens both, asking about unsaved work first. |
| Menus | File, Edit, Tools and Help, plus a right-click menu with editing and spelling corrections in every text field. Settings, About and the release notes are reached from the menus - on macOS, from the Trypthos menu. |
| Release notes | Help > Release Notes: what changed in each release, in full. Earlier releases are grouped into chapters; open one and every release in it is listed as it was written. |
| Markdown guide | A syntax guide on the Help menu, opening in a read-only tab: every construct Trypthos renders, with examples, in GitHub and Obsidian flavours. |
| Updates | Checks for a newer version on startup, or on demand from the Help menu or the tray icon. |
| Local by default | No server and no account. Your files stay on your machine; chats are stored locally. |
`.trim();

/// Third-party components a user should know are involved. Add a row when a new library, model or AI
/// provider is introduced.
export const DISCLAIMERS: readonly string[] = [
  "Built with Electron and React.",
  "Editing is provided by CodeMirror 6. Preview is rendered with marked and sanitised with DOMPurify.",
  "Mathematics is typeset with KaTeX, and diagrams are drawn with Mermaid, both loaded only when a document uses them.",
  "Updates are checked against this project's public GitHub releases. Nothing else is sent.",
  "Chat requests go directly from this app to the endpoint you configure. No Trypthos server is involved.",
  "GitHub requests go directly from this app to api.github.com, using the token you provide. Your token is encrypted by your operating system and never leaves this machine.",
  "The graph is drawn with Sigma.js and laid out with graphology's ForceAtlas2, loaded only when a graph is shown.",
  "Which files a folder's graph leaves out is decided with the ignore package, reading the folder's own .gitignore.",
  "Icons assigned in an Obsidian vault are drawn with the Lucide icon set, loaded only when a vault that uses them is open.",
];
