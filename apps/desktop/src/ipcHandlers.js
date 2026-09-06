"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  CHAT_EVENT_CHANNEL,
  CancelChatRequest,
  ChatIdRequest,
  SaveChatRequest,
  chatTitleFrom,
  composeMessages,
  contextTurns,
  effectiveSystemPrompt,
  DeleteSecretRequest,
  OpenExternalRequest,
  SendChatRequest,
  SetIntegrationRequest,
  SetSecretRequest,
  createPathGuard,
  imageMediaType,
  ListRequest,
  OutlineRequest,
  MAX_IMAGE_FILE_BYTES,
  ReadImageRequest,
  ReadRequest,
  SaveAsRequest,
  WriteRequest,
  WriteSettingsRequest,
} = require("@trypthos/domain");
const { readSettings, writeSettings, notifySettingsWritten } = require("./settingsStore");
const { createLocalWorkspace } = require("./localWorkspace");
const chatStore = require("./chatStore");
const { outlineWorkspace } = require("./workspaceOutline");
const { createFolderToolRunner } = require("./folderToolRunner");

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
  const guard = createPathGuard({
    root,
    // Windows and default macOS volumes compare names case-insensitively; Linux does not. Getting
    // this wrong in the permissive direction would let "/WS/../etc" read as inside "/ws".
    caseInsensitive: process.platform !== "linux",
  });

  // The guard is kept beside the provider rather than only inside it, because Save As has a path to
  // check BEFORE it has anything to write: the dialog answers with an absolute path, and whether
  // that is a place in this workspace is the question asked first.
  current = { root, name: path.basename(root) || root, guard, provider: createLocalWorkspace({ root, guard }) };
  return { root, name: current.name };
}

/// An absolute path the save dialog returned, as a workspace-relative one - or null when it is not
/// in the workspace at all.
///
/// Forward-slashed, because that is what a path IS everywhere else in the app: the tab strip, the
/// tree, a markdown link and a saved chat all name a file this way, and a backslash arriving from a
/// Windows dialog would make one path look like two.
///
/// The lexical guard has the last word. `path.relative` alone answers "../elsewhere/notes.md" for a
/// target beside the workspace, which is a string that looks perfectly like a relative path.
function workspaceRelative(workspace, absolute) {
  const relative = path.relative(workspace.root, absolute).split(path.sep).join("/");
  if (relative === "" || !workspace.guard.resolve(relative).ok) return null;
  return relative;
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

function registerIpcHandlers({
  ipcMain,
  dialog,
  getWindow,
  userDataDir,
  secrets,
  chat,
  openExternal = async () => {},
  /// Trypthos's entries in File Explorer's right-click menu. Optional, because everywhere but a
  /// packaged Windows build there is nothing to write - the handlers still exist there, and answer
  /// that it is unsupported, so the renderer has one place to ask rather than a platform check of
  /// its own.
  explorerIntegration = null,
}) {
  // The registry is the only record of whether the entries are there: the user can remove them
  // without telling us, so a copy in settings would be a second answer that could disagree with what
  // Explorer actually shows.
  const integrationStatus = async () => {
    const supported = explorerIntegration?.supported() === true;
    return {
      ok: true,
      supported,
      registered: supported ? await explorerIntegration.isRegistered() : false,
    };
  };

  ipcMain.handle("shell:integration", integrationStatus);

  ipcMain.handle("shell:setIntegration", async (_event, payload) => {
    const parsed = SetIntegrationRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };
    if (explorerIntegration?.supported() !== true) return await integrationStatus();

    if (parsed.data.enabled) await explorerIntegration.register();
    else await explorerIntegration.unregister();

    // Answers with the state that FOLLOWS, read back rather than assumed, so the switch reflects
    // what happened rather than what was asked for.
    return await integrationStatus();
  });

  // A link the user clicked, on its way out of the app.
  //
  // Not workspace-scoped: the About box and the chat panel render links before anybody has chosen a
  // folder. `OpenExternalRequest` is where the scheme is checked, and it is checked HERE rather than
  // trusted from the renderer - what is on the other side of this call is the operating system's own
  // protocol handlers, and on Windows several of them do considerably more than open a page.
  ipcMain.handle("shell:openExternal", async (_event, payload) => {
    const parsed = OpenExternalRequest.safeParse(payload);
    if (!parsed.success) {
      // Deliberately not echoing the URL: it came from the renderer, and repeating untrusted content
      // into a log is how it ends up somewhere that reads it as trusted.
      console.error("Refused to open a URL the shell does not hand to the operating system.");
      return { ok: false, reason: "bad-request" };
    }

    await openExternal(parsed.data.url);
    return { ok: true };
  });

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
    notifySettingsWritten(parsed.data);

    // Saving settings is the only moment the app learns that a profile was deleted, or its endpoint
    // repointed. Without this, a live credential for a provider nothing references any more would
    // stay on disk with no way for the user to remove it.
    await secrets.retainOnly(parsed.data.chat.profiles.map((profile) => profile.endpoint));

    return { ok: true };
  });

  // API keys. Write and delete only - see the note on IPC_CHANNELS. `secrets:list` answers with
  // ENDPOINTS, which is how the renderer knows to show "key saved" without ever holding a key.
  ipcMain.handle("secrets:list", async () => ({
    ok: true,
    endpoints: await secrets.endpointsWithKeys(),
  }));

  ipcMain.handle("secrets:set", async (_event, payload) => {
    const parsed = SetSecretRequest.safeParse(payload);
    // Never echoing the payload into a log: it contains the key.
    if (!parsed.success) {
      console.error("Rejected a malformed key write.");
      return { ok: false, reason: "bad-request" };
    }

    // The store refuses rather than falling back to plaintext, and that refusal is passed straight
    // through - the user has to be told their key was not saved.
    return secrets.setKey(parsed.data.endpoint, parsed.data.key);
  });

  ipcMain.handle("secrets:delete", async (_event, payload) => {
    const parsed = DeleteSecretRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    await secrets.deleteKey(parsed.data.endpoint);
    return { ok: true };
  });

  // Chat. Streams in flight, by id, so a reply can be cancelled and so a late event can be told
  // apart from the conversation the user has since moved to.
  const streams = new Map();

  /// Pushes one event to the renderer.
  ///
  /// The window can be closed while a reply is still arriving, and sending to a destroyed
  /// webContents throws - which would surface as an unhandled rejection in the main process rather
  /// than as anything anyone could act on.
  function pushChatEvent(streamId, event) {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(CHAT_EVENT_CHANNEL, { streamId, event });
  }

  ipcMain.handle("chat:send", async (_event, payload) => {
    const parsed = SendChatRequest.safeParse(payload);
    if (!parsed.success) {
      // Not echoing the payload: it is the user's own prose, and a log is not where that belongs.
      console.error("Rejected a malformed chat request.");
      return { ok: false, reason: "bad-request" };
    }

    // The renderer named a profile ID. The endpoint, model and parameters come from settings HERE -
    // a renderer that could name its own endpoint could point Trypthos at any server on the
    // internet, and have it send whatever key was stored for that address.
    const settings = await readSettings(userDataDir);
    const profile = settings.chat.profiles.find(({ id }) => id === parsed.data.profileId);
    if (profile === undefined) return { ok: false, reason: "no-such-profile" };

    const streamId = randomUUID();
    const controller = new AbortController();
    streams.set(streamId, controller);

    // Deliberately not awaited: the reply arrives over seconds, and the renderer needs the stream id
    // now so it can match the events that follow.
    /// Serves a file the model asked for, or refuses.
    ///
    /// **The allowlist, and the only reason this is safe.** The outline is recomputed here rather
    /// than taken from the request: the renderer's copy came from this same function, and trusting
    /// it back would let a renderer widen what the model may read simply by sending a longer list.
    /// The workspace provider then resolves the path against the open root, so even an allowed name
    /// goes through the boundary check every other read does.
    ///
    /// Offered only when the user asked for the folder. With no outline there is nothing to read
    /// from, and offering the tool would invite calls that could only be refused.
    const readForModel =
      parsed.data.context.folder === null
        ? null
        : async (wanted) => {
            const workspace = getWorkspace();
            if (!workspace) return { ok: false, reason: "no-workspace" };

            // Rebuilt HERE rather than trusted from the request: the outline is the allowlist, so
            // what may be read is decided by the main process walking the folder again. The folder
            // itself is the user's choice and comes with the context; the guard is what keeps that
            // choice inside the workspace.
            const outline = await outlineWorkspace(workspace.provider, {
              path: parsed.data.context.folder.path,
              fileTypes: settings.fileTypes.enabled,
              limit: settings.chat.folderFileLimit,
            });
            if (!outline.paths.includes(wanted)) return { ok: false, reason: "not-allowed" };

            const result = await workspace.provider.read(wanted);
            return result.ok ? { ok: true, content: result.content } : { ok: false, reason: "unreadable" };
          };

    /// The tools that let the model look around the attached folder - list, search, compare.
    ///
    /// **Bound to the folder the user attached, and to nothing wider.** Attaching a folder is the
    /// consent gesture this app has; honouring it is the difference between "you showed me this
    /// folder" and "you opened this app". The workspace guard still applies underneath, so the
    /// folder bound is a second fence inside the first rather than instead of it.
    ///
    /// Null with no folder, for the same reason the read tool is: with nothing attached there is
    /// nothing to look around, and offering a tool that can only be refused wastes a turn.
    const exploreFolder =
      parsed.data.context.folder === null
        ? null
        : async (name, argumentsJson) => {
            const workspace = getWorkspace();
            if (!workspace) return null;

            // Built per call rather than held, so a folder or a file-types change between turns is
            // picked up rather than remembered from whenever the conversation started.
            const run = createFolderToolRunner({
              provider: workspace.provider,
              folder: parsed.data.context.folder.path,
              fileTypes: settings.fileTypes.enabled,
            });
            return await run(name, argumentsJson);
          };

    // Composed here, not in the renderer: the system prompt is settings the renderer has no reason
    // to hold, and keeping the document's wording in one place means the panel cannot drift from
    // what the model is actually told.
    const messages = composeMessages({
      // Resolved here rather than stored: null means "the current default", so improving the
      // default reaches everyone who has not written their own.
      systemPrompt: effectiveSystemPrompt(settings.chat.systemPrompt),
      // The transport the model actually has. Promising the tool to an endpoint that was never
      // sent one is what made the folder look empty for two releases.
      context: contextTurns(parsed.data.context, {
        reads: profile.supportsTools ? "tool" : "fenced",
      }),
      turns: parsed.data.turns,
    });

    void chat
      .run({
        profile,
        turns: messages,
        readFile: readForModel,
        callTool: exploreFolder,
        signal: controller.signal,
        onEvent: (event) => pushChatEvent(streamId, event),
      })
      .catch(() => {
        // `run` is documented never to reject, so this is belt and braces - but a turn that ended
        // without an `end` event would leave the panel showing a reply that never finishes.
        pushChatEvent(streamId, { type: "error", message: "The reply failed unexpectedly." });
        pushChatEvent(streamId, { type: "end" });
      })
      .finally(() => streams.delete(streamId));

    return { ok: true, streamId };
  });

  // Saved conversations. Files in the app-data directory, never in the user's workspace.
  // The markdown files in the open folder, as a map for chat. A real recursive walk, so it happens
  // here and is capped: measured on a home directory one took 39 seconds.
  ipcMain.handle("workspace:outline", async (_event, payload) => {
    const parsed = OutlineRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    const workspace = getWorkspace();
    if (!workspace) return { ok: false, reason: "no-workspace" };

    // The FOLDER comes from the renderer - it is what the user selected in the tree - and is
    // therefore validated by the provider, which applies the same guard every other path gets. The
    // file types and the size come from settings read here, never from the renderer.
    const settings = await readSettings(userDataDir);
    return {
      ok: true,
      outline: await outlineWorkspace(workspace.provider, {
        path: parsed.data.path,
        // Both from settings read HERE, never from the renderer: this list is the allowlist the
        // model reads from, so widening it is a decision the main process makes.
        fileTypes: settings.fileTypes.enabled,
        limit: settings.chat.folderFileLimit,
      }),
    };
  });

  ipcMain.handle("chats:list", async () => ({
    ok: true,
    chats: await chatStore.listSessions(userDataDir),
  }));

  ipcMain.handle("chats:load", async (_event, payload) => {
    const parsed = ChatIdRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    const chat = await chatStore.loadSession(userDataDir, parsed.data.id);
    // Missing and unreadable are the same answer: the panel says the chat could not be opened,
    // rather than showing an empty one that would look like a conversation lost.
    return chat === null ? { ok: false, reason: "not-found" } : { ok: true, chat };
  });

  ipcMain.handle("chats:save", async (_event, payload) => {
    const parsed = SaveChatRequest.safeParse(payload);
    if (!parsed.success) {
      // Not echoing the payload: it is the user's own conversation.
      console.error("Rejected a malformed chat save.");
      return { ok: false, reason: "bad-request" };
    }

    const now = new Date().toISOString();
    const existing =
      parsed.data.id === null ? null : await chatStore.loadSession(userDataDir, parsed.data.id);

    const session = {
      schemaVersion: 1,
      // Generated HERE. An id from the renderer becomes a file name, and the shape check in the
      // store is the last line rather than the only one.
      id: existing?.id ?? randomUUID(),
      // Derived from the conversation rather than asked for: a dialog demanding a name before a
      // chat can be saved is a dialog people learn to dismiss.
      title: chatTitleFrom(parsed.data.turns),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      // The renderer never names a workspace root - the main process holds the open one.
      workspaceRoot: current?.root ?? null,
      filePath: parsed.data.filePath,
      profileId: parsed.data.profileId,
      turns: parsed.data.turns,
    };

    const result = await chatStore.saveSession(userDataDir, session);
    return result.ok ? { ok: true, id: session.id, title: session.title } : result;
  });

  ipcMain.handle("chats:delete", async (_event, payload) => {
    const parsed = ChatIdRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };
    return chatStore.deleteSession(userDataDir, parsed.data.id);
  });

  ipcMain.handle("chat:cancel", async (_event, payload) => {
    const parsed = CancelChatRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    // A stream that has already finished is not an error: the user pressing stop as the last token
    // arrives is a race nobody should have to think about.
    streams.get(parsed.data.streamId)?.abort();
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

  /// Save As: a native dialog, then a write to wherever it landed.
  ///
  /// **Every decision about WHERE is on this side.** The renderer sends the document and where the
  /// document currently lives; it has no way to name a destination, and the path it gets back is
  /// already workspace-relative. That is the same rule as the workspace root itself - a renderer
  /// that could name a target could write a file anywhere on the machine.
  ///
  /// The dialog's own "replace it?" is the answer the conflict check exists to obtain, so the write
  /// is made with `overwrite` and does not ask again. What the dialog cannot waive is the boundary:
  /// where a file may be written is not the user's to answer in a file picker.
  ipcMain.handle(
    "file:saveAs",
    guarded(getWorkspace, SaveAsRequest, async (request, workspace) => {
      const window = getWindow();
      const result = await dialog.showSaveDialog(window, {
        title: "Save As",
        // Where the dialog OPENS, and the only thing the renderer's path is for. A Save As from a
        // file deep in the tree that opened at the root would make the user navigate back to where
        // they already were.
        defaultPath:
          request.path === null ? workspace.root : path.join(workspace.root, request.path),
      });

      // Cancelling is not a failure, and must not raise anything: see `failureKey`.
      if (result.canceled || !result.filePath) return { ok: false, reason: "cancelled" };

      const relative = workspaceRelative(workspace, result.filePath);
      // Its own reason rather than "permission-denied". The user picked a real folder they can write
      // to, and the app is the thing declining - so it has to say which of the two it means.
      if (relative === null) return { ok: false, reason: "outside-workspace" };

      const written = await workspace.provider.write(relative, request.content, null, {
        overwrite: true,
      });
      return written.ok ? { ok: true, path: relative, revision: written.revision } : written;
    }),
  );

  /// An image, as a data URL the window can draw.
  ///
  /// Its own channel rather than a flag on `file:read`, because the two do opposite things with the
  /// same bytes: one decodes them as text and refuses anything binary, and this one does not look at
  /// them at all. Neither can then be answered by the wrong half of the shell.
  ///
  /// **The media type is decided HERE, from the file's name.** A data URL's type is an instruction
  /// to the browser about how to read what follows, so it is not something to accept from the
  /// renderer - and a name that is not an image this app draws is refused rather than guessed at.
  ipcMain.handle(
    "file:readImage",
    guarded(getWorkspace, ReadImageRequest, async (request, workspace) => {
      const mediaType = imageMediaType(request.path);
      if (mediaType === null) return { ok: false, reason: "not-an-image" };

      const read = await workspace.provider.readBytes(request.path, MAX_IMAGE_FILE_BYTES);
      if (!read.ok) return read;

      return { ok: true, dataUrl: `data:${mediaType};base64,${read.bytes.toString("base64")}` };
    }),
  );

  ipcMain.handle(
    "file:write",
    guarded(getWorkspace, WriteRequest, (request, workspace) =>
      workspace.provider.write(request.path, request.content, request.expectedRevision),
    ),
  );
}

module.exports = { registerIpcHandlers, guarded, openWorkspace };
