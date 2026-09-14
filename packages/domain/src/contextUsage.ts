import type { ChatTurn } from "./chatCompletion";
import {
  CONTEXT_CHARACTER_LIMIT,
  MAX_CONTEXT_CHARACTER_LIMIT,
  contextTurns,
  type ChatContext,
} from "./chatContext";

/// How full the model's context is, roughly.
///
/// **Every number here is an estimate, and every surface that shows one says so.** Counting tokens
/// needs the provider's own tokeniser, and a profile points at an arbitrary OpenAI-compatible
/// endpoint - there is no tokeniser to ask, and the endpoint reports its count only in the reply,
/// which is after the question the dial exists to inform. Four characters to a token is the rule of
/// thumb the character limit is already set from; it is good to within a few per cent on English
/// prose and worse on code, which is the honest reason the dial reads "about".

export const CHARACTERS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

/// The share of a model's context window the documents and attachments may fill.
///
/// Nine tenths. What else a request carries - the system prompt, the tool definitions, the
/// conversation - is small next to a set of documents, and the reply is the model's own business.
export const DOCUMENT_CONTEXT_SHARE = 0.9;

/// How many characters of document and attachment text a question to this model may carry.
///
/// Sized from the window when one is set, at the same four characters to a token the dial estimates
/// by, so the budget and the ring agree about what fits. The fixed fallback when no window is set:
/// there is no way to ask an endpoint, and a guess would be worse. Never past the ceiling, since the
/// window is a number somebody types.
export function contextCharacterBudget(contextWindow: number | null): number {
  if (contextWindow === null || contextWindow <= 0) return CONTEXT_CHARACTER_LIMIT;
  return Math.min(
    Math.floor(contextWindow * DOCUMENT_CONTEXT_SHARE * CHARACTERS_PER_TOKEN),
    MAX_CONTEXT_CHARACTER_LIMIT,
  );
}

export interface ContextTokensInput {
  /// The prompt as it will actually be sent - resolved, not the stored null.
  systemPrompt: string;
  context: ChatContext;
  turns: readonly Pick<ChatTurn, "content">[];
}

/// What the next request will carry, before anything is typed.
///
/// Split from `contextUsage` because this is the expensive half: it builds the same framing text
/// `contextTurns` sends, over a document that can be sixty thousand characters. The caller memoises
/// it on the document and the conversation, and adds the draft on every keystroke through the cheap
/// half.
///
/// It counts `contextTurns` rather than the raw document, deliberately: the fences and the
/// explanations around a file are real tokens the user pays for, and a dial that counted different
/// text from the request would be worse than no dial.
export function contextTokens({ systemPrompt, context, turns }: ContextTokensInput): number {
  // The tool transport, whichever the model actually has. The dial is an estimate to within a
  // rounding error either way, and threading the model's transport into a token count would tie a
  // number the panel shows to a setting it has no other reason to know about.
  const framed = contextTurns(context, { reads: "tool" }).reduce(
    (total, turn) => total + estimateTokens(turn.content),
    0,
  );
  const conversation = turns.reduce((total, turn) => total + estimateTokens(turn.content), 0);
  return estimateTokens(systemPrompt) + framed + conversation;
}

export interface ContextUsage {
  /// Everything the next request will carry, including what is typed but not yet sent.
  tokens: number;
  /// The model's context window, or null when nobody has said what it is.
  limit: number | null;
  /// How full, from 0 to 1 - or null when there is no window to be a fraction of. A ring with no
  /// total is a ring that cannot be filled, and inventing a total would draw a confident lie.
  fraction: number | null;
  /// Past the end. Kept separate from `fraction`, which stays clamped: a fraction above one draws a
  /// ring that has wrapped around, which reads as nearly empty.
  over: boolean;
}

export function contextUsage({
  tokens,
  draft,
  limit,
}: {
  tokens: number;
  draft: string;
  limit: number | null;
}): ContextUsage {
  const total = tokens + estimateTokens(draft);
  // A window of zero or less cannot mean anything. Treated as "not configured" rather than as a
  // division by zero, which would draw Infinity per cent full.
  const usable = limit !== null && limit > 0 ? limit : null;

  return {
    tokens: total,
    limit: usable,
    fraction: usable === null ? null : Math.min(1, total / usable),
    over: usable !== null && total > usable,
  };
}
