import { z } from "zod";
import { ChatTurnSchema } from "./chatCompletion";
import { SettingsSchema } from "./settings";

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
  "window:minimize",
  "window:toggleMaximize",
  "window:close",
  "settings:read",
  "settings:write",
  "workspace:reopen",
  "secrets:list",
  "secrets:set",
  "secrets:delete",
  "chat:send",
  "chat:cancel",
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

export const ReadRequest = z.object({ path: relativePath.min(1) }).strict();

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
  })
  .strict();

export const CancelChatRequest = z.object({ streamId: z.string().min(1) }).strict();

/// What the main process pushes back while a reply streams.
///
/// Strict, and a closed union. This is our own contract rather than a provider's response, so an
/// unexpected shape means the two sides have drifted and should fail loudly - the opposite of the
/// tolerance `parseStreamPayload` applies to somebody else's JSON.
///
/// `end` always arrives last, error or not, so the panel has ONE signal that the turn is over.
export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), text: z.string() }).strict(),
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
export type ReadRequest = z.infer<typeof ReadRequest>;
export type WriteRequest = z.infer<typeof WriteRequest>;

// No `Revision` type is exported here on purpose: provider.ts already defines it, and a second
// declaration of the same concept is the start of the two drifting apart. RevisionSchema is the
// runtime check for that same shape.
