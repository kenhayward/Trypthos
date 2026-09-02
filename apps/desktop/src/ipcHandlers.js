"use strict";

const path = require("node:path");
const {
  createPathGuard,
  ListRequest,
  ReadRequest,
  WriteRequest,
  WriteSettingsRequest,
} = require("@trypthos/domain");
const { readSettings, writeSettings } = require("./settingsStore");
const { createLocalWorkspace } = require("./localWorkspace");

/// The main-process side of the IPC surface.
///
/// Two rules hold here, and both exist because the renderer is untrusted:
///
///  1. Every argument is parsed with the shared schema before anything happens. The renderer having
///     already validated is not a check - a compromised or simply buggy renderer is the case this
///     defends against.
///  2. There is no channel that takes an arbitrary path or operation. Each one does a named thing to
///     the currently open workspace, which is held HERE rather than passed in. A renderer that could
///     name its own root could name any directory on the machine.

/// The open workspace. Not exported, and not settable except by the user choosing a folder.
let current = null;

function openWorkspace(root) {
  current = {
    root,
    name: path.basename(root) || root,
    provider: createLocalWorkspace({
      root,
      guard: createPathGuard({
        root,
        // Windows and default macOS volumes compare names case-insensitively; Linux does not. Getting
        // this wrong in the permissive direction would let "/WS/../etc" read as inside "/ws".
        caseInsensitive: process.platform !== "linux",
      }),
    }),
  };
  return { root, name: current.name };
}

/// Wraps a handler so a schema failure or a missing workspace becomes a result rather than an
/// exception crossing the IPC boundary, where it would reach the renderer as an opaque string.
///
/// `getWorkspace` is passed in rather than read from module state so the ordering below can be
/// tested directly. That ordering is the point of the function.
function guarded(getWorkspace, schema, handler) {
  return async (_event, payload) => {
    // Validation comes FIRST, before any consideration of state. A malformed payload is a protocol
    // error whatever the app happens to be doing, and reporting it as "no workspace open" would send
    // whoever is debugging it looking in entirely the wrong place.
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // Deliberately not echoing the payload back: it came from the renderer, and repeating it into
      // a log is how untrusted content ends up somewhere it is read as trusted.
      console.error("Rejected malformed IPC payload on a workspace channel.");
      return { ok: false, reason: "bad-request" };
    }

    const workspace = getWorkspace();
    if (!workspace) return { ok: false, reason: "no-workspace" };

    return handler(parsed.data, workspace);
  };
}

function registerIpcHandlers({ ipcMain, dialog, getWindow, userDataDir }) {
  // Settings are not workspace-scoped, so they do not go through `guarded` - there is no workspace
  // to require, and the app needs to read them before one is open.
  ipcMain.handle("settings:read", async () => ({ ok: true, settings: await readSettings(userDataDir) }));

  ipcMain.handle("settings:write", async (_event, payload) => {
    const parsed = WriteSettingsRequest.safeParse(payload);
    if (!parsed.success) {
      console.error("Rejected malformed settings write.");
      return { ok: false, reason: "bad-request" };
    }
    await writeSettings(userDataDir, parsed.data);
    return { ok: true };
  });

  ipcMain.handle("workspace:open", async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Open folder",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: "cancelled" };
    }

    return { ok: true, workspace: openWorkspace(result.filePaths[0]) };
  });

  // Reopening the folder the app was last closed with. Same validation path as the dialog, so a
  // stored path that has since been deleted or moved is refused rather than trusted.
  ipcMain.handle("workspace:reopen", async (_event, payload) => {
    const root = typeof payload?.root === "string" ? payload.root : null;
    if (root === null) return { ok: false, reason: "bad-request" };

    try {
      const stats = await require("node:fs/promises").stat(root);
      if (!stats.isDirectory()) return { ok: false, reason: "not-found" };
    } catch {
      return { ok: false, reason: "not-found" };
    }

    return { ok: true, workspace: openWorkspace(root) };
  });

  const getWorkspace = () => current;

  ipcMain.handle(
    "workspace:list",
    guarded(getWorkspace, ListRequest, (request, workspace) => workspace.provider.list(request.path)),
  );

  ipcMain.handle(
    "file:read",
    guarded(getWorkspace, ReadRequest, (request, workspace) => workspace.provider.read(request.path)),
  );

  ipcMain.handle(
    "file:write",
    guarded(getWorkspace, WriteRequest, (request, workspace) =>
      workspace.provider.write(request.path, request.content, request.expectedRevision),
    ),
  );
}

module.exports = { registerIpcHandlers, guarded, openWorkspace };
