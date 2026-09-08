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
  CloseWorkspaceRequest,
  ConnectGitHubRequest,
  ListReposRequest,
  OpenWorkspaceRefRequest,
  workspaceRefKey,
  FilterRequest,
  FindRequest,
  qualifyPath,
  splitQualified,
  workspaceIdFor,
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
const { openWorkspaceFor } = require("./providers");
const chatStore = require("./chatStore");
const { outlineWorkspace } = require("./workspaceOutline");
const { createFolderToolRunner } = require("./folderToolRunner");
const { searchFiles } = require("./fileSearch");
const { searchNames } = require("./nameSearch");

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

/// The open workspaces, by the id the main process minted for each.
///
/// Not exported, and not settable except by the user choosing a folder. A renderer can name an id -
/// which is a thing this side made up - and can never name a root, which would be a way to reach any
/// directory on the machine.
const open = new Map();

/// What the renderer is told about an open workspace.
///
/// The REFERENCE rather than a root and a kind beside it. One field that says which provider answers
/// and which place it is, so the renderer can remember the workspace for next launch, draw the right
/// icon, and know that a repository has no folder - without three fields that could disagree.
///
/// Note what is not here: nothing about the connection, and nothing about the token. Which is the
/// same reason the workspace's own guard and provider stay on this side.
function described(workspace) {
  return {
    id: workspace.id,
    ref: workspace.ref,
    name: workspace.name,
    /// True when the provider could not describe the whole workspace.
    ///
    /// Its own field rather than part of the reference, because it is a fact about this LISTING
    /// rather than about which place this is. GitHub cuts a very large tree short, and a browser
    /// that showed less than the repository holds without saying so would be wrong rather than
    /// incomplete. False for a local folder, which is listed one folder at a time and never
    /// truncated.
    truncated: workspace.truncated === true,
  };
}

/// Opens whatever a reference names, or answers the workspace it is already open as.
///
/// Opening the same place twice is one workspace, not two: two trees over one folder - or one
/// repository - would be two sets of tabs for the same files, each with its own idea of what is in
/// them. The comparison is `workspaceRefKey`, which is the one rule for "the same place" and knows
/// that GitHub folds case where a Linux filesystem does not.
///
/// **Which provider answers is decided in `providers.js` and nowhere else.** What is here is the
/// registry of what is open, the id minted for each, and the deduplication - all of which is the
/// same work whatever opened it.
async function openWorkspaceRef(ref, dependencies) {
  const key = workspaceRefKey(ref);
  const already = [...open.values()].find((workspace) => workspaceRefKey(workspace.ref) === key);
  if (already !== undefined) return { ok: true, workspace: described(already) };

  const opened = await openWorkspaceFor(ref, dependencies);
  if (!opened.ok) return opened;

  // The id is the place's own name, deduplicated - so a qualified path reads as something a person
  // recognises, and a tab forced to disambiguate two files called `notes.md` shows `Notes/notes.md`
  // rather than an opaque token.
  const id = workspaceIdFor(opened.workspace.name, [...open.keys()]);
  const workspace = { ...opened.workspace, id };

  open.set(id, workspace);
  return { ok: true, workspace: described(workspace) };
}

/// How the folder tools put a file on the user's screen, or null when they cannot.
///
/// The channel behind this names a file by its workspace ROOT - it is the one a launch from File
/// Explorer uses, and there is deliberately no second implementation of opening a file. A workspace
/// with no folder on disk has no root to name one with, and sending null would fail the schema on
/// arrival and reach the user as a file that could not be found. Null instead, which is the case the
/// runner already handles: it refuses the tool rather than offering one that cannot work.
function tabOpenerFor(workspace, openInWindow) {
  if (workspace.root === null) return null;
  return (file) => openInWindow({ root: workspace.root, file });
}

/// Which workspace a qualified path is in, and where in it.
///
/// The ONE place a qualified path is taken apart. What comes out is an ordinary workspace-relative
/// path, and it goes through the provider's guard unchanged: naming a workspace adds a folder to a
/// path, never permission to leave it.
function locateQualified(request) {
  const split = splitQualified(request.path ?? "");
  if (split === null) return null;

  const workspace = open.get(split.workspaceId);
  return workspace === undefined ? null : { workspace, path: split.path };
}

/// The workspace a request names outright, for the one call that has no path to read it from.
function locateById(request) {
  const workspace = open.get(request.workspaceId);
  return workspace === undefined ? null : { workspace };
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
/// `locate` is passed in rather than read from module state so the ordering below can be tested
/// directly. That ordering is the point of the function.
function guarded(locate, schema, handler) {
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

    // Which workspace, worked out from the request rather than from this module's state: several
    // are open at once, so "the workspace" is not a thing the app has any more.
    const found = locate(parsed.data);
    if (!found) return { ok: false, reason: "no-workspace" };

    // The handler is given the path INSIDE the workspace, never the qualified one it arrived as.
    // That is what leaves every handler below unchanged by there being several workspaces.
    const request = found.path === undefined ? parsed.data : { ...parsed.data, path: found.path };
    return handler(request, found.workspace);
  };
}

function registerIpcHandlers({
  ipcMain,
  dialog,
  getWindow,
  /// Puts a file on the user's screen. Passed in rather than reached for, because the channel and
  /// the window belong to `main.js` - and because a test can then watch what would have opened.
  openInWindow = () => {},
  userDataDir,
  secrets,
  /// Cloud provider credentials. A separate store from `secrets` on purpose - see `accountStore.js`.
  accounts = null,
  /// Builds a GitHub client over a token supplier.
  ///
  /// A factory rather than a client, because two are needed: the standing one reads the stored
  /// token, and connecting builds a throwaway over the token being offered - so a token is VERIFIED
  /// before it is written, and a rejected one never reaches disk.
  createGitHub = null,
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
            // Which workspace, from the folder the user attached - it names one. Several folders
            // are open at once, so "the workspace" is not a thing this side has any more.
            const attached = locateQualified(parsed.data.context.folder);
            if (!attached) return { ok: false, reason: "no-workspace" };
            const { workspace } = attached;

            // Rebuilt HERE rather than trusted from the request: the outline is the allowlist, so
            // what may be read is decided by the main process walking the folder again. The folder
            // itself is the user's choice and comes with the context; the guard is what keeps that
            // choice inside the workspace.
            const outline = await outlineWorkspace(workspace.provider, {
              // The folder INSIDE its workspace. What the model sees, and what it names back, is
              // relative to the workspace its folder is in - one folder is one world to it.
              path: attached.path,
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
            const attached = locateQualified(parsed.data.context.folder);
            if (!attached) return null;
            const { workspace } = attached;

            // Built per call rather than held, so a folder or a file-types change between turns is
            // picked up rather than remembered from whenever the conversation started.
            const run = createFolderToolRunner({
              provider: workspace.provider,
              folder: attached.path,
              fileTypes: settings.fileTypes.enabled,
              // Down the channel a launch from File Explorer already uses, so the renderer opens it
              // the one way - asking about unsaved work, reporting a file that is not there. There
              // is deliberately no second implementation of opening a file.
              //
              // **Null for a workspace with no folder on disk.** That channel names a file by its
              // ROOT, which a repository has not got - and the runner already refuses the tool when
              // it has no way to open a tab, which is the honest answer. Sending a null root instead
              // would fail the schema on arrival and look like a file that could not be found.
              openInTab: tabOpenerFor(workspace, openInWindow),
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

    const found = locateQualified(parsed.data);
    if (!found) return { ok: false, reason: "no-workspace" };
    const { workspace } = found;

    // The FOLDER comes from the renderer - it is what the user selected in the tree - and is
    // therefore validated by the provider, which applies the same guard every other path gets. The
    // file types and the size come from settings read here, never from the renderer.
    const settings = await readSettings(userDataDir);
    return {
      ok: true,
      outline: await outlineWorkspace(workspace.provider, {
        path: found.path,
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
      // The renderer never names a workspace root - the main process holds the open ones, and a
      // chat records the root of whichever workspace the file it is about lives in.
      workspaceRoot: locateQualified({ path: parsed.data.filePath ?? "" })?.workspace.root ?? null,
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

  /// GitHub, as an account rather than as a workspace.
  ///
  /// **The token is written and never read back.** `github:status` answers with a login, which is
  /// what lets the interface show who is connected without ever holding the credential - the same
  /// shape as `secrets:list` answering with endpoints. There is deliberately no channel that returns
  /// a token, and there must never be one.
  const github = createGitHub === null ? null : createGitHub(() => accounts?.getToken("github") ?? null);

  /// The dependencies a provider is opened with. Built once, so `workspace:open`, `workspace:openRef`
  /// and anything after them cannot end up holding different clients.
  const providerDeps = { github };

  /// The repositories the account owns, held for the session.
  ///
  /// Several requests over a connection the user is paying for, and the picker is opened far more
  /// often than a repository is created - so it is fetched once. `refresh` is what a user who has
  /// just made one asks for, rather than restarting the app.
  let repositories = null;

  ipcMain.handle("github:status", async () => {
    if (accounts === null || github === null) return { ok: true, connected: false, login: null, reason: null };
    if (!(await accounts.hasToken("github"))) {
      return { ok: true, connected: false, login: null, reason: null };
    }

    // Asked of GitHub rather than answered from a stored name. A token can be revoked, and a cached
    // login would go on naming an account the app can no longer reach - which is the one thing a
    // connection indicator must not do.
    const who = await github.whoami();
    return who.ok
      ? { ok: true, connected: true, login: who.login, reason: null }
      : { ok: true, connected: false, login: null, reason: who.reason };
  });

  ipcMain.handle("github:connect", async (_event, payload) => {
    const parsed = ConnectGitHubRequest.safeParse(payload);
    // Never echoing the payload into a log: it contains the token.
    if (!parsed.success) {
      console.error("Rejected a malformed GitHub connection request.");
      return { ok: false, reason: "bad-request" };
    }
    if (accounts === null || createGitHub === null) return { ok: false, reason: "unsupported" };

    // **Verified before it is stored.** A token that GitHub rejects never reaches disk, so there is
    // no window in which the app holds a credential it has never been able to use - and the user is
    // told at the moment they paste it rather than the first time they open a repository.
    const offered = createGitHub(async () => parsed.data.token);
    const who = await offered.whoami();
    if (!who.ok) return who;

    const stored = await accounts.setToken("github", parsed.data.token);
    // The store refuses rather than falling back to plaintext, and that refusal is passed straight
    // through - the user has to be told their token was not saved.
    if (!stored.ok) return stored;

    repositories = null;
    return { ok: true, login: who.login };
  });

  ipcMain.handle("github:disconnect", async () => {
    if (accounts === null) return { ok: true };

    await accounts.deleteToken("github");
    // The list went with the account. Keeping it would let a picker opened after signing out show
    // the repositories of an account the app can no longer reach.
    repositories = null;
    return { ok: true };
  });

  ipcMain.handle("github:repos", async (_event, payload) => {
    const parsed = ListReposRequest.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, reason: "bad-request" };
    if (github === null) return { ok: false, reason: "unsupported" };

    if (repositories !== null && !parsed.data.refresh) {
      return { ok: true, repos: repositories };
    }

    const result = await github.ownedRepositories();
    if (!result.ok) return result;

    repositories = result.repos;
    return { ok: true, repos: result.repos };
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

    return await openWorkspaceRef({ kind: "local", root: result.filePaths[0] }, providerDeps);
  });

  /// Closing one workspace. The tabs that belonged to it are the renderer's business; what happens
  /// here is that its provider and its guard stop existing, so a path naming it stops resolving.
  ipcMain.handle("workspace:close", async (_event, payload) => {
    const parsed = CloseWorkspaceRequest.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: "bad-request" };

    // Answered the same whether or not it was open. Closing a workspace that has already gone is
    // the state the caller wanted, not a failure to report.
    open.delete(parsed.data.workspaceId);
    return { ok: true };
  });

  /// Opening a workspace the app already knows how to name.
  ///
  /// One channel for three acts that were always the same act: reopening a folder remembered from
  /// last launch, opening a repository chosen from the picker, and following a folder handed over by
  /// File Explorer. Which provider answers is `providers.js`, and each checks what it needs to -
  /// a stored folder can have been deleted, and a repository can have been made private.
  ipcMain.handle("workspace:openRef", async (_event, payload) => {
    const parsed = OpenWorkspaceRefRequest.safeParse(payload);
    if (!parsed.success) {
      // Not echoing the payload: it names a folder on the user's machine or a repository of theirs.
      console.error("Rejected a malformed request to open a workspace.");
      return { ok: false, reason: "bad-request" };
    }

    return await openWorkspaceRef(parsed.data.ref, providerDeps);
  });

  ipcMain.handle(
    "workspace:list",
    guarded(locateQualified, ListRequest, async (request, workspace) => {
      const result = await workspace.provider.list(request.path);
      if (!result.ok) return result;
      // Qualified HERE, so the renderer receives ids it can hand straight back and never has to
      // work out which workspace a row belongs to.
      return {
        ok: true,
        nodes: result.nodes.map((node) => ({ ...node, id: qualifyPath(workspace.id, node.id) })),
      };
    }),
  );

  ipcMain.handle(
    "file:read",
    guarded(locateQualified, ReadRequest, (request, workspace) => workspace.provider.read(request.path)),
  );

  /// Find in Files.
  ///
  /// The walk goes through the provider, which is what applies the workspace guard - so a folder
  /// that climbs out is refused by the listing rather than by a check written a second time here.
  /// Which folder INSIDE the workspace is a choice, not a permission, exactly as for `workspace:outline`.
  ipcMain.handle(
    "workspace:find",
    guarded(locateQualified, FindRequest, (request, workspace) =>
      searchFiles(workspace.provider, request),
    ),
  );

  /// The browser's filter box, which searches INSIDE the folders rather than only the rows on
  /// screen.
  ///
  /// The same walk rules as Find in Files - through the provider, bounded, one unreadable folder
  /// skipped rather than fatal - and one difference: nothing is read, so nothing is restricted by
  /// file type. The browser lists a file whose type is off and draws it grey; a filter that could
  /// not find it would disagree with the tree it sits above.
  ipcMain.handle(
    "workspace:filter",
    guarded(locateQualified, FilterRequest, async (request, workspace) => {
      const result = await searchNames(workspace.provider, request);
      if (!result.ok) return result;
      // Qualified HERE, exactly as a listing is, so the renderer receives paths it can hand straight
      // back to open a file and never has to work out which workspace one belongs to.
      return {
        ok: true,
        paths: result.paths.map((found) => qualifyPath(workspace.id, found)),
        truncated: result.truncated,
      };
    }),
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
    guarded(locateById, SaveAsRequest, async (request, workspace) => {
      // A provider with no folder on disk has nowhere for a save dialog to open and nowhere for the
      // file to land. Refused HERE, before a dialog appears: offering one and then declining what
      // the user chose would ask a question whose every answer is no. Writing to GitHub is a commit
      // on a branch, which is a feature rather than a destination - see `githubWorkspace.js`.
      if (workspace.root === null) return { ok: false, reason: "unsupported" };

      const window = getWindow();
      const result = await dialog.showSaveDialog(window, {
        title: "Save As",
        // Where the dialog OPENS, and the only thing the renderer's path is for. A Save As from a
        // file deep in the tree that opened at the root would make the user navigate back to where
        // they already were.
        // Where the dialog OPENS, and the only thing the path is for. It arrives qualified like
        // every other path, so the workspace comes off the front - the workspace this saves INTO is
        // the one the request named outright, not one inferred from where the dialog started.
        defaultPath:
          request.path === null
            ? workspace.root
            : path.join(workspace.root, splitQualified(request.path)?.path ?? ""),
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
      // Qualified on the way back, like a listing: the renderer receives a path it can hand
      // straight to any other channel and never has to work out which workspace it names.
      return written.ok
        ? { ok: true, path: qualifyPath(workspace.id, relative), revision: written.revision }
        : written;
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
    guarded(locateQualified, ReadImageRequest, async (request, workspace) => {
      const mediaType = imageMediaType(request.path);
      if (mediaType === null) return { ok: false, reason: "not-an-image" };

      const read = await workspace.provider.readBytes(request.path, MAX_IMAGE_FILE_BYTES);
      if (!read.ok) return read;

      return { ok: true, dataUrl: `data:${mediaType};base64,${read.bytes.toString("base64")}` };
    }),
  );

  ipcMain.handle(
    "file:write",
    guarded(locateQualified, WriteRequest, (request, workspace) =>
      workspace.provider.write(request.path, request.content, request.expectedRevision),
    ),
  );
}

module.exports = { registerIpcHandlers, guarded, tabOpenerFor };
