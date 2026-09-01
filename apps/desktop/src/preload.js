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
});
