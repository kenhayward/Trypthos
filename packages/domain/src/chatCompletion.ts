import { z } from "zod";
import type { ChatProfile } from "./chat";
import { normaliseEndpoint } from "./endpoints";

/// Talking to an OpenAI-compatible chat endpoint.
///
/// Pure: building the request body, and reading one streamed chunk. The request itself is made by
/// the main process - the renderer never opens a socket to a provider and never holds the key.
///
/// **Tolerant outward, strict inward.** Everything here parses somebody else's response, so an
/// unrecognised shape is ignored rather than rejected: a provider adding a field must not end a
/// reply mid-sentence. Our own IPC payloads are the opposite, and are parsed strictly, because there
/// an unexpected field means the two sides of a contract we control have drifted.

/// One message in the conversation, as the provider sees it.
export const ChatTurnSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })
  .strict();

export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/// Assembles the messages one request sends.
///
/// The order is the point, and it is why this is a function rather than three lines at a call site:
///
///   1. **The system prompt**, if there is one. Omitted entirely when blank - an empty system
///      message is not the same as no system message, and some endpoints reject one.
///   2. **The conversation so far**, unchanged and in order.
///   3. **The document**, immediately before the question it belongs to.
///
/// The document goes last-but-one rather than at the top because it is re-sent fresh every turn: the
/// user may have edited the file, or selected something different, between one question and the
/// next. Putting it beside the question that prompted it also keeps the two together in a long
/// thread, where a document pinned at the top would be a long way from what was asked about it.
export function composeMessages({
  systemPrompt,
  context,
  turns,
}: {
  systemPrompt: string;
  context: ChatTurn | null;
  turns: readonly ChatTurn[];
}): ChatTurn[] {
  const messages: ChatTurn[] = [];
  if (systemPrompt.trim() !== "") messages.push({ role: "system", content: systemPrompt });

  if (context === null) return [...messages, ...turns];

  // Before the final turn, which is the question being asked. A history that does not end in a
  // question should not happen, but if it does the document still belongs at the end rather than
  // being dropped.
  const at = turns.length > 0 ? turns.length - 1 : 0;
  messages.push(...turns.slice(0, at), context, ...turns.slice(at));
  return messages;
}

/// The full URL to POST to, from the configured base URL.
export function completionsUrl(endpoint: string): string {
  // Trailing slashes stripped first: someone will paste the base URL with one, and a doubled slash
  // is a 404 on enough providers to be worth handling rather than diagnosing.
  return `${normaliseEndpoint(endpoint)}/chat/completions`;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatTurn[];
  stream: true;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

/// The request body for one turn.
///
/// A configured parameter is sent under its wire name; an unconfigured one is ABSENT rather than
/// null. Providers differ on whether they ignore a null or reject the request outright, and a
/// settings form that leaves a box empty must not be the reason one endpoint answers and another
/// does not.
export function buildChatRequest(
  profile: ChatProfile,
  turns: readonly ChatTurn[],
): ChatRequestBody {
  return {
    // The slug, never the label. They are separate fields precisely so this cannot go wrong.
    model: profile.model,
    messages: [...turns],
    stream: true,
    ...(profile.temperature === undefined ? {} : { temperature: profile.temperature }),
    ...(profile.maxTokens === undefined ? {} : { max_tokens: profile.maxTokens }),
    ...(profile.topP === undefined ? {} : { top_p: profile.topP }),
  };
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "usage"; promptTokens: number; replyTokens: number }
  | { type: "error"; message: string }
  | { type: "done" }
  /// Anything not recognised. Deliberately not an error - see the note at the top.
  | { type: "ignored" };

/// Loose, not strict: this describes only the fields that are read, and tolerates every other.
const ChunkSchema = z.looseObject({
  choices: z
    .array(z.looseObject({ delta: z.looseObject({ content: z.string().optional() }).optional() }))
    .optional(),
  usage: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

/// Reads one `data:` payload from the stream.
///
/// Total: it never throws. A truncated frame, or a proxy injecting an HTML error page into the
/// middle of a stream, must not throw out of the read loop and lose the reply already on screen.
export function parseStreamPayload(payload: string): StreamEvent {
  const text = payload.trim();
  if (text === "") return { type: "ignored" };
  // The sentinel every OpenAI-compatible endpoint ends with. Not JSON, so it is checked first.
  if (text === "[DONE]") return { type: "done" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { type: "ignored" };
  }

  const chunk = ChunkSchema.safeParse(parsed);
  if (!chunk.success) return { type: "ignored" };

  const { choices, usage, error } = chunk.data;

  // Checked before content: a provider that streams an error mid-reply has stopped answering, and
  // continuing to wait for tokens would hang the panel until the connection dropped.
  if (error !== undefined) {
    return { type: "error", message: error.message ?? "The provider reported an error." };
  }

  const content = choices?.[0]?.delta?.content;
  // An empty string is not a token. The first chunk of a reply usually carries the role and no
  // content, and appending it would be harmless but pointless; treating it as an error would end
  // the stream before a word arrived.
  if (typeof content === "string" && content !== "") return { type: "token", text: content };

  if (usage !== undefined) {
    return {
      type: "usage",
      promptTokens: usage.prompt_tokens ?? 0,
      replyTokens: usage.completion_tokens ?? 0,
    };
  }

  return { type: "ignored" };
}
