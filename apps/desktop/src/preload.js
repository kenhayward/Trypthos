"use strict";

const { contextBridge } = require("electron");

/// The IPC surface, enumerated.
///
/// Everything the renderer can reach is listed here by name. There is deliberately no general
/// "invoke any channel" or "run this fs call" bridge: such a bridge makes the enumerated surface
/// decorative, since anything the main process can do becomes reachable from a page.
///
/// As handlers are added, each one validates its arguments in the MAIN process. The renderer having
/// already checked is not a check.
contextBridge.exposeInMainWorld("trypthos", {
  platform: process.platform,
  isDesktop: true,
});
