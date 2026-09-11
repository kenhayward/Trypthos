"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/// The IPC surface, enumerated.
///
/// Everything the renderer can reach is listed here by name. There is deliberately no general
/// "invoke any channel" or "run this fs call" bridge: such a bridge would make this enumeration
/// decorative, since anything the main process can do would become reachable from a page.
///
/// Note what is absent. The renderer cannot name a workspace root - it can only ask the user to
/// choose one, and the main process holds the result. A renderer that could name its own root could
/// name any directory on the machine.
contextBridge.exposeInMainWorld("trypthos", {
  platform: process.platform,
  isDesktop: true,

  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  /// Closes one open workspace, by the id the main process minted for it. Never by its root - see
  /// the note at the top of this file.
  closeWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:close", { workspaceId }),
  /// Looks again at where one open workspace reads from - for a repository, the newest commit on its
  /// branch. By id, like closing, for the same reason.
  refreshWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:refresh", { workspaceId }),
  listDirectory: (path) => ipcRenderer.invoke("workspace:list", { path }),
  readFile: (path) => ipcRenderer.invoke("file:read", { path }),
  /// An image, as a data URL. A different channel from `readFile` because that one decodes text and
  /// refuses anything binary - see the handler.
  readImage: (path) => ipcRenderer.invoke("file:readImage", { path }),
  /// `message` is what a provider whose write IS a commit puts on it. Null for every backend with
  /// no history to write it into, which is all of them but GitHub.
  writeFile: (path, content, expectedRevision, message = null) =>
    ipcRenderer.invoke("file:write", { path, content, expectedRevision, message }),

  /// Save As. Note what is NOT sent: a destination. The dialog runs in the main process and the path
  /// it answers with is checked against the open workspace there - `path` here is only where the
  /// dialog should open, and null for a document that has never been anywhere.
  saveFileAs: (workspaceId, path, content) =>
    ipcRenderer.invoke("file:saveAs", { workspaceId, path, content }),

  /// API keys, write-only by construction.
  ///
  /// `listKeyedEndpoints` returns endpoints, never keys - it is how the settings UI shows whether a
  /// key is stored. There is deliberately no `getKey`: a key that reached this side would be visible
  /// in devtools, in the network panel, and in a renderer crash dump.
  listKeyedEndpoints: () => ipcRenderer.invoke("secrets:list"),
  setApiKey: (endpoint, key) => ipcRenderer.invoke("secrets:set", { endpoint, key }),
  deleteApiKey: (endpoint) => ipcRenderer.invoke("secrets:delete", { endpoint }),

  /// Chat. The renderer names a PROFILE, never an endpoint - the main process looks the endpoint,
  /// model and key up from settings it already holds, for the same reason the renderer cannot name a
  /// workspace root.
  sendChat: (profileId, turns, context) =>
    ipcRenderer.invoke("chat:send", { profileId, turns, context }),
  cancelChat: (streamId) => ipcRenderer.invoke("chat:cancel", { streamId }),

  /// Saved conversations. Files in the app-data directory - the renderer names a chat by id and
  /// never a path, and the id it sends is checked against a UUID before anything touches disk.
  /// The markdown files in the open folder, for chat to use as a map. Paths only - the renderer
  /// never names the folder, and the walk happens where the workspace is held.
  workspaceOutline: (path) => ipcRenderer.invoke("workspace:outline", { path }),

  /// Find in Files. A folder INSIDE the open workspace, a pattern, and whether to read it as an
  /// expression - never a root, for the reason at the top of this file.
  findInFiles: (request) => ipcRenderer.invoke("workspace:find", request),

  /// The browser's filter box. A folder INSIDE the open workspace and a name pattern - never a root,
  /// for the reason at the top of this file. Names only: nothing here opens a file.
  filterFiles: (request) => ipcRenderer.invoke("workspace:filter", request),

  listChats: () => ipcRenderer.invoke("chats:list"),
  loadChat: (id) => ipcRenderer.invoke("chats:load", { id }),
  saveChat: (request) => ipcRenderer.invoke("chats:save", request),
  deleteChat: (id) => ipcRenderer.invoke("chats:delete", { id }),

  /// Streamed reply tokens. Wrapped like `onWindowState`, so the renderer never receives the
  /// IpcRendererEvent - it carries a `sender` that would hand a page a route back into main.
  onChatEvent: (listener) => {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("chat:event", wrapped);
    return () => ipcRenderer.removeListener("chat:event", wrapped);
  },

  /// What the renderer reports about its document: whether there is unsaved work, never what it
  /// says. The shell needs it to know whether a close is worth interrupting.
  setDocumentDirty: (dirty) => ipcRenderer.invoke("document:dirty", { dirty }),

  /// The shared native prompt, for anything about to discard a document. The name is what the
  /// dialog asks about - one of several open tabs, or nothing in particular.
  confirmDiscard: (name) => ipcRenderer.invoke("document:confirmDiscard", { name: name ?? null }),

  /// The shell asking whether the window may close. Wrapped like `onWindowState`, so the renderer
  /// never receives the IpcRendererEvent and the `sender` on it.
  onCloseRequested: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("window:closeRequested", wrapped);
    return () => ipcRenderer.removeListener("window:closeRequested", wrapped);
  },

  /// A link the user clicked in rendered markdown, on its way to their browser.
  ///
  /// The scheme is checked again in the main process. The renderer having decided a link was
  /// external is not a decision - on the other side of this call is the operating system.
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),

  readSettings: () => ipcRenderer.invoke("settings:read"),
  writeSettings: (settings) => ipcRenderer.invoke("settings:write", settings),
  /// Opens a workspace the app already knows how to name: a folder remembered from last launch, a
  /// repository chosen from the picker, or a folder handed over by File Explorer.
  ///
  /// A reference, not a root - which is what lets one call open a local folder and a GitHub
  /// repository. It is still not a way to name a folder on the machine: the only roots this side has
  /// ever seen are ones the main process minted, and the shell checks the folder exists before
  /// opening it.
  openWorkspaceRef: (ref) => ipcRenderer.invoke("workspace:openRef", { ref }),

  /// GitHub, as an account.
  ///
  /// Write-only by construction, exactly like the API keys above. `status` answers with a LOGIN and
  /// never a token, and there is deliberately no `getToken`: a token that reached this side would be
  /// visible in devtools, in the network panel, and in a renderer crash dump.
  githubStatus: () => ipcRenderer.invoke("github:status"),
  connectGitHub: (token) => ipcRenderer.invoke("github:connect", { token }),
  disconnectGitHub: () => ipcRenderer.invoke("github:disconnect"),
  /// The repositories the connected account owns. Fetched in the main process, where the token is,
  /// and held for the session - `refresh` is for a user who has just made one.
  listRepositories: (refresh = false) => ipcRenderer.invoke("github:repos", { refresh }),
  /// The statistics one repository's own page draws. Named by an OPEN workspace, never by owner and
  /// repository - see the note at the top of this file.
  repoInfo: (workspaceId) => ipcRenderer.invoke("github:repoInfo", { workspaceId }),
  /// The branches a repository has, and which one it is reading and writing. What the save dialog
  /// needs to ask its question.
  repoBranches: (workspaceId) => ipcRenderer.invoke("github:branches", { workspaceId }),
  /// Where this repository's saves go from now on. `create` cuts a branch; false moves to one that
  /// already exists, and the workspace follows it.
  setRepoBranch: (workspaceId, branch, create) =>
    ipcRenderer.invoke("github:setBranch", { workspaceId, branch, create }),

  /// Opens a native menu under the label the renderer drew.
  ///
  /// The renderer supplies only WHICH menu and where the label is. What is on each menu is decided
  /// in the main process, so a page cannot invent an item or a click handler.
  popupMenu: (menu, x, y) => ipcRenderer.invoke("menu:popup", { menu, x, y }),

  /// Menu items the renderer carries out. Wrapped like `onWindowState`, so no IpcRendererEvent -
  /// and with it no `sender` - ever reaches the page.
  onMenuAction: (listener) => {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("menu:action", wrapped);
    return () => ipcRenderer.removeListener("menu:action", wrapped);
  },

  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),

  /// Trypthos's entries in File Explorer's right-click menu: whether they can be there, whether they
  /// are, and turning them on or off. The registry itself is the record, so the renderer asks rather
  /// than remembering.
  explorerIntegration: () => ipcRenderer.invoke("shell:integration"),
  setExplorerIntegration: (enabled) => ipcRenderer.invoke("shell:setIntegration", { enabled }),

  /// What the app was launched with from Explorer - a folder, or a markdown file in one. Wrapped
  /// like `onWindowState`, so no IpcRendererEvent, and with it no `sender`, reaches the page.
  onOpenTarget: (listener) => {
    const wrapped = (_event, target) => listener(target);
    ipcRenderer.on("shell:openTarget", wrapped);
    return () => ipcRenderer.removeListener("shell:openTarget", wrapped);
  },

  /// The one channel flowing the other way. The listener is wrapped rather than passed through, so
  /// the renderer never receives the IpcRendererEvent - it carries a `sender` that would hand a page
  /// a route back into the main process.
  onWindowState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("window:state", wrapped);
    return () => ipcRenderer.removeListener("window:state", wrapped);
  },
});
