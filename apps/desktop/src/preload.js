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
  listDirectory: (path) => ipcRenderer.invoke("workspace:list", { path }),
  readFile: (path) => ipcRenderer.invoke("file:read", { path }),
  writeFile: (path, content, expectedRevision) =>
    ipcRenderer.invoke("file:write", { path, content, expectedRevision }),

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

  readSettings: () => ipcRenderer.invoke("settings:read"),
  writeSettings: (settings) => ipcRenderer.invoke("settings:write", settings),
  reopenWorkspace: (root) => ipcRenderer.invoke("workspace:reopen", { root }),

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

  /// The one channel flowing the other way. The listener is wrapped rather than passed through, so
  /// the renderer never receives the IpcRendererEvent - it carries a `sender` that would hand a page
  /// a route back into the main process.
  onWindowState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("window:state", wrapped);
    return () => ipcRenderer.removeListener("window:state", wrapped);
  },
});
