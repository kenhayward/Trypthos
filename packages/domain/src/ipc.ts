import { z } from "zod";
import { ChatTurnSchema } from "./chatCompletion";
import { ChatContextSchema } from "./chatContext";
import { SettingsSchema } from "./settings";
import { WorkspaceRefSchema } from "./workspaceRef";
import { isExternalUrl } from "./markdownLink";

/// The IPC contract between the renderer and the shell.
///
/// Shared so both sides are described once. The renderer is untrusted, so the main process parses
/// every argument with these schemas before acting - the renderer having already checked is not a
/// check, and a compromised or buggy renderer is exactly the case this defends against.
///
/// Every schema is `.strict()`. An unexpected field is a sign that the two sides disagree about the
/// contract, and failing loudly the first time beats silently dropping it and diverging further.

/// The complete list of channels. The preload bridge exposes these by name and nothing else: there is
/// deliberately no general "invoke any channel" helper, because one would make this enumeration
/// decorative - anything the main process can do would become reachable from a page.
export const IPC_CHANNELS = [
  "workspace:open",
  "workspace:list",
  "file:read",
  "file:write",
  "file:saveAs",
  "file:readImage",
  "window:minimize",
  "window:toggleMaximize",
  "window:close",
  "settings:read",
  "settings:write",
  "workspace:openRef",
  "secrets:list",
  "secrets:set",
  "secrets:delete",
  "chat:send",
  "chat:cancel",
  "menu:popup",
  "chats:list",
  "chats:load",
  "chats:save",
  "chats:delete",
  "workspace:outline",
  "workspace:find",
  "workspace:filter",
  "workspace:close",
  "document:dirty",
  "document:confirmDiscard",
  "shell:openExternal",
  "shell:integration",
  "shell:setIntegration",
  "github:status",
  "github:connect",
  "github:disconnect",
  "github:repos",
  "github:repoInfo",
  "github:branches",
  "github:setBranch",
] as const;

/// There is no channel that returns an API key, and there must never be one.
///
/// The renderer asks which endpoints HAVE a key and gets endpoints back; the key itself never leaves
/// the main process. A key in the renderer is a key in devtools, in the network panel, and in a
/// renderer crash dump - so the absence below is the security property, and `secretsLeakGuard` in
/// the shell tests is what keeps it true as handlers are added.

/// Pushed from the main process when the window is maximised or restored, so the maximise button can
/// show the right glyph. The only channel that flows main to renderer.
///
/// Validated on arrival like everything else. Main is trusted, but the schema is what stops the two
/// sides drifting silently: a shape change here would otherwise surface as a button that stops
/// updating rather than as an error.
export const WINDOW_STATE_CHANNEL = "window:state";

/// The shell asking the renderer whether the window may close.
///
/// Main to renderer, and it is a QUESTION rather than an order: the renderer owns the document and
/// the unsaved flag, so it is the only side that can decide - and having decided, it closes the
/// window itself with `force`. The shell keeps its own copy of the dirty flag only so that a window
/// with nothing to lose closes without a round trip at all.
export const CLOSE_REQUESTED_CHANNEL = "window:closeRequested";

/// What the renderer reports about the document it holds. Nothing about the document itself: the
/// shell needs to know whether there is unsaved work, never what it says.
export const DocumentDirtyRequest = z.object({ dirty: z.boolean() }).strict();

/// A link the user clicked, on its way to their browser.
///
/// The scheme is checked HERE rather than trusted, and it is the same check the renderer made -
/// `isExternalUrl`, one function, so the two answers cannot drift apart. What is on the other side of
/// this handler is `shell.openExternal`, which hands a string to the operating system: `file:` reads
/// anything on the machine, and Windows registers handlers (`ms-msdt:`, `search-ms:`) that do rather
/// more than open a page. An allow-list is the only shape this check can safely take.
export const OpenExternalRequest = z
  .object({ url: z.string().min(1).refine(isExternalUrl) })
  .strict();

export type OpenExternalRequest = z.infer<typeof OpenExternalRequest>;

/// What the person answering the prompt meant.
///
/// Three, not two. "Cancel" is the one that makes it a question rather than a demand, and it is the
/// answer somebody gives when they clicked the wrong file.
export const DiscardChoiceSchema = z.enum(["save", "discard", "cancel"]);

export type DiscardChoice = z.infer<typeof DiscardChoiceSchema>;

/// The document a discard prompt is about.
///
/// Named, because the editor holds several documents at once: "save changes before closing this
/// document?" over a tab strip asks about work the user cannot identify. Nullable rather than
/// required, because closing the WINDOW is about the window - it walks each unsaved document in
/// turn, and the shell still has a sentence to show if it is ever asked without one.
export const ConfirmDiscardRequest = z
  .object({ name: z.string().nullable().default(null) })
  .strict();

/// Turning the File Explorer entries on or off.
///
/// The registry is the only record of whether they are there: a copy in settings would be a second
/// answer that could disagree with what Explorer actually shows, and the user can remove the keys
/// without telling us.
export const SetIntegrationRequest = z.object({ enabled: z.boolean() }).strict();

/// What the app was launched with from Explorer: a folder, and optionally a document inside it.
///
/// A file names both, because every path this app handles is relative to one open folder. Pushed
/// from the main process, which is the side that sees the command line - and validated on arrival
/// like every other message, so a shape change surfaces as an error rather than as a launch that
/// quietly opens nothing.
export const OpenTargetSchema = z
  .object({ root: z.string().min(1), file: z.string().min(1).nullable() })
  .strict();

export type OpenTarget = z.infer<typeof OpenTargetSchema>;

/// The channel that carries it. Main to renderer, like `window:state`.
export const OPEN_TARGET_CHANNEL = "shell:openTarget";

/// Closing the window. `force` says the renderer has already asked about unsaved work and been told
/// to go ahead - without it the shell would ask again and the window could never close.
export const CloseWindowRequest = z
  .object({ force: z.boolean().default(false) })
  .strict();

export type DocumentDirtyRequest = z.infer<typeof DocumentDirtyRequest>;

/// Streamed reply tokens, pushed from the main process. The second channel flowing main to renderer.
///
/// A push rather than a return value because a reply arrives over seconds and has to render as it
/// goes. Each message names the stream it belongs to, so a reply that arrives after the user has
/// moved on can be discarded rather than appended to a different conversation.
export const CHAT_EVENT_CHANNEL = "chat:event";

export const WindowStateSchema = z.object({ maximized: z.boolean() }).strict();

export type WindowState = z.infer<typeof WindowStateSchema>;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

/// A provider version token. Opaque: a local mtime and size today, an ETag or commit SHA later.
export const RevisionSchema = z.object({ id: z.string().min(1) }).strict();

/// Workspace-relative. Never absolute - the shell resolves it against the open root and rejects
/// anything that escapes, so a path arriving here is a request, not a location.
const relativePath = z.string();

export const ListRequest = z.object({ path: relativePath }).strict();

/// The folder chat should map. "" is the workspace root.
///
/// A path from the renderer, so it is validated in the main process like every other one - and the
/// walk goes through the workspace provider rather than `fs`, which is what applies the guard. The
/// boundary is the workspace root; which folder inside it is a choice, not a permission.
export const OutlineRequest = z.object({ path: relativePath }).strict();

export const ReadRequest = z.object({ path: relativePath.min(1) }).strict();

/// Opening a workspace the app already knows how to name: a folder remembered from last launch, a
/// repository chosen from the picker, or a folder handed over by File Explorer.
///
/// **This is not a way for the renderer to name a folder on the machine.** A local reference carries
/// an absolute root, and the only roots the renderer has ever seen are ones the main process minted
/// - from the native dialog, from the settings file it wrote, or from the command line. That is the
/// same round trip `workspace:reopen` made before this channel generalised it, and the shell still
/// checks the folder exists and is a directory rather than trusting the string.
export const OpenWorkspaceRefRequest = z.object({ ref: WorkspaceRefSchema }).strict();

export type OpenWorkspaceRefRequest = z.infer<typeof OpenWorkspaceRefRequest>;

/// Storing the GitHub token. One way, like every other credential here: nothing reads it back.
///
/// The token is checked by being USED - the shell asks GitHub who it belongs to and reports the
/// login - rather than by matching a pattern. GitHub has changed its token format twice, and a regex
/// here would start refusing valid tokens on a day nothing in this app changed.
export const ConnectGitHubRequest = z
  .object({
    /// Trimmed by the caller. A token that is only whitespace is a mistake, not a token.
    token: z.string().min(1),
  })
  .strict();

export type ConnectGitHubRequest = z.infer<typeof ConnectGitHubRequest>;

/// Asking for the repositories the connected account owns.
///
/// `refresh` skips the copy the shell is holding. The list is fetched once and kept, because it is
/// several requests over a slow connection and the picker is opened far more often than a
/// repository is created - but a user who has just made one needs a way to see it without restarting
/// the app.
export const ListReposRequest = z.object({ refresh: z.boolean().default(false) }).strict();

export type ListReposRequest = z.infer<typeof ListReposRequest>;

/// The statistics one repository's own page shows.
///
/// Named by the WORKSPACE the renderer already has open, never by owner and repository. That is the
/// same rule as everywhere else here: the shell holds what is open, and a renderer that could name
/// any repository could ask GitHub about repositories the user never opened.
export const RepoInfoRequest = z.object({ workspaceId: z.string().min(1) }).strict();

export type RepoInfoRequest = z.infer<typeof RepoInfoRequest>;

/// Where a repository's saves should go.
///
/// Named by the open workspace for the same reason everything else here is: the shell holds what is
/// open, and a renderer that could name a repository could commit to one the user never opened.
///
/// `create` is what tells cutting a branch from moving to one. They are different acts with
/// different failures - one can find the name already taken, the other can find no such branch -
/// and a single call that guessed from whether the name exists would race between the guess and the
/// act.
export const SetBranchRequest = z
  .object({
    workspaceId: z.string().min(1),
    /// Bounded, and checked against git's own rules in the main process before it becomes a URL.
    branch: z.string().min(1).max(255),
    create: z.boolean(),
  })
  .strict();

export type SetBranchRequest = z.infer<typeof SetBranchRequest>;

/// The branches a repository has, for the picker in the save dialog.
export const BranchesRequest = z.object({ workspaceId: z.string().min(1) }).strict();

export type BranchesRequest = z.infer<typeof BranchesRequest>;

/// Closing one of the open workspaces.
///
/// A workspace is named by the id the MAIN PROCESS minted for it, never by its root. That is the
/// same rule as everywhere else here: a renderer that could name a root could name any directory on
/// the machine, and closing is only the reverse of an opening this side performed.
export const CloseWorkspaceRequest = z.object({ workspaceId: z.string().min(1) }).strict();

/// Reading an image, which does not go through `file:read`.
///
/// The same shape, and a different channel on purpose: `file:read` DECODES, and an image must not
/// be decoded as text - the read boundary refuses anything binary, which is right for a document
/// and wrong for a picture. Two channels rather than a flag, so neither can be answered by the
/// wrong half of the shell.
export const ReadImageRequest = z.object({ path: relativePath.min(1) }).strict();

export const WriteRequest = z
  .object({
    path: relativePath.min(1),
    content: z.string(),
    /// The revision the caller last saw, or null to create a new file.
    ///
    /// Required, and explicitly nullable rather than optional. A missing field would read as
    /// "overwrite whatever is there", which is the precise accident the revision exists to prevent -
    /// so creating a file has to say so.
    expectedRevision: RevisionSchema.nullable(),
    /// What the commit should say, for a provider whose write IS a commit.
    ///
    /// Null everywhere else, and ignored by every backend that has no history. Bounded because a
    /// commit message is a line, not a document, and the renderer is untrusted about length as much
    /// as about anything else.
    message: z.string().min(1).max(500).nullable().default(null),
  })
  .strict();

/// Save As: a dialog, and then a write to wherever it landed.
///
/// **The renderer cannot name a destination, and that is the whole shape of this.** It sends the
/// document and where the document currently lives; the path comes back from the native dialog on
/// the main process's side, and is checked against the open workspace there. A renderer that could
/// name a target could write a file anywhere on the machine, which is the same reason it cannot name
/// a workspace root.
///
/// `path` is only where the dialog starts - null for the scratch buffer, which has never been
/// anywhere.
/// Save As. The renderer names WHICH workspace, and never where in it.
///
/// `workspaceId` is the authority, not `path`: a document that has never been saved has no path at
/// all, and two fields that could each answer "which workspace" would be two answers waiting to
/// disagree. `path` is where the dialog should OPEN and nothing else - qualified like every other
/// path, and the workspace is taken off it only to find the folder to start in.
export const SaveAsRequest = z
  .object({
    workspaceId: z.string().min(1),
    path: relativePath.min(1).nullable(),
    content: z.string(),
  })
  .strict();

/// One turn of a conversation, on the way to the provider.
///
/// The renderer names a **profile id**, never an endpoint. The main process looks the profile up in
/// the settings it already holds - so a renderer cannot point Trypthos at a server of its choosing,
/// for the same reason it cannot name a workspace root. That is also what keeps the key out of
/// reach: the key is stored per endpoint, and the renderer never gets to say which endpoint.
export const SendChatRequest = z
  .object({
    profileId: z.string().min(1),
    /// The whole conversation, resent each turn. Chat is stateless per turn, so switching model
    /// mid-conversation needs nothing else - the history reaches the new model with the request.
    turns: z.array(ChatTurnSchema).min(1),
    /// The document, the selection, or nothing.
    ///
    /// Required rather than optional, and explicitly `{ kind: "none" }` for nothing. A missing field
    /// would read as "no context" for both a deliberate choice and a renderer that forgot to send
    /// it, and the difference between those is a chat that quietly stops seeing the document.
    ///
    /// Resolved by the renderer because only the renderer has the live buffer: the file on disk is
    /// not what the user is looking at once they have typed into it. The main process re-validates
    /// the shape and the size.
    context: ChatContextSchema,
  })
  .strict();

export const CancelChatRequest = z.object({ streamId: z.string().min(1) }).strict();

/// Saving a conversation.
///
/// The renderer sends what it holds - the turns, which model answered, which file was open - and the
/// main process fills in the rest: the id, the timestamps, and the workspace root, which the
/// renderer cannot name for the same reason it cannot name one to open.
///
/// `id` is null for a chat that has never been saved and the id of the chat otherwise, so saving
/// twice replaces rather than duplicates.
export const SaveChatRequest = z
  .object({
    id: z.string().nullable(),
    turns: z.array(ChatTurnSchema).min(1),
    profileId: z.string().nullable(),
    /// Workspace-relative, as the renderer knows it. Recorded as a reference only: the file may be
    /// renamed or deleted before the chat is opened again.
    filePath: z.string().nullable(),
  })
  .strict();

export const ChatIdRequest = z.object({ id: z.string().min(1) }).strict();

/// What the main process pushes back while a reply streams.
///
/// Strict, and a closed union. This is our own contract rather than a provider's response, so an
/// unexpected shape means the two sides have drifted and should fail loudly - the opposite of the
/// tolerance `parseStreamPayload` applies to somebody else's JSON.
///
/// `end` always arrives last, error or not, so the panel has ONE signal that the turn is over.
export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), text: z.string() }).strict(),
  z.object({ type: z.literal("reasoning"), text: z.string() }).strict(),
  /// Discard what has streamed for this reply; more is coming in its place.
  ///
  /// Sent when a reply turned out to be a request for a file rather than an answer - the fenced
  /// read transport, for endpoints with no tool calling. The panel empties the reply and the next
  /// round writes the real one, so the user is not left reading the model's own bookkeeping.
  z.object({ type: z.literal("reset") }).strict(),
  /// Something the app is doing on the model's behalf - reading a file it asked for. Shown in the
  /// panel so a turn that pauses for several seconds says what it is doing rather than look stuck.
  z.object({ type: z.literal("tool"), name: z.string(), detail: z.string() }).strict(),
  z
    .object({
      type: z.literal("usage"),
      promptTokens: z.number(),
      replyTokens: z.number(),
    })
    .strict(),
  z.object({ type: z.literal("error"), message: z.string() }).strict(),
  z.object({ type: z.literal("end") }).strict(),
]);

export const ChatEventMessage = z
  .object({ streamId: z.string().min(1), event: ChatEventSchema })
  .strict();

export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type SendChatRequest = z.infer<typeof SendChatRequest>;

/// Storing a key for an endpoint. One way: nothing reads it back out.
///
/// The endpoint is validated as a URL here as well as in the profile schema, because this channel
/// can be called with an endpoint that is not in the profile list yet - the user types the endpoint
/// and pastes the key in the same edit.
export const SetSecretRequest = z
  .object({
    endpoint: z.url(),
    /// Trimmed by the caller. A key that is only whitespace is a mistake, not a key.
    key: z.string().min(1),
  })
  .strict();

export const DeleteSecretRequest = z.object({ endpoint: z.url() }).strict();

/// The whole settings object, validated on the way in. The renderer is untrusted like any other
/// caller, and a malformed write would be persisted and then read back on every launch.
export const WriteSettingsRequest = SettingsSchema;

export type SetSecretRequest = z.infer<typeof SetSecretRequest>;
export type DeleteSecretRequest = z.infer<typeof DeleteSecretRequest>;
export type ListRequest = z.infer<typeof ListRequest>;
export type OutlineRequest = z.infer<typeof OutlineRequest>;
export type ReadRequest = z.infer<typeof ReadRequest>;
export type CloseWorkspaceRequest = z.infer<typeof CloseWorkspaceRequest>;
export type ReadImageRequest = z.infer<typeof ReadImageRequest>;
export type SaveAsRequest = z.infer<typeof SaveAsRequest>;
export type WriteRequest = z.infer<typeof WriteRequest>;

// No `Revision` type is exported here on purpose: provider.ts already defines it, and a second
// declaration of the same concept is the start of the two drifting apart. RevisionSchema is the
// runtime check for that same shape.
