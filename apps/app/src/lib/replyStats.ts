import { CHARACTERS_PER_TOKEN, type ChatEvent, type ChatTrace } from "@trypthos/domain";

/// How one reply went: how long it took and how many tokens it cost.
///
/// Measured in the renderer, as the events arrive, because the times worth showing are the ones the
/// user sat through - from pressing Send to the first word on screen. IPC adds a fraction of a
/// millisecond to that, which is noise next to a model's own latency.
///
/// **Token counts are the endpoint's, not ours.** A request asks a streamed reply to report its
/// usage, and most OpenAI-compatible servers do. One that does not still gets an estimate of what it
/// returned, from the text, and the panel says so; what was SENT is never estimated here, because
/// the request is assembled in the main process and this side cannot see all of it.
///
/// Held in memory for the conversation on screen, and never saved with a chat: a timing belongs to
/// the moment it was taken, and a saved chat is a record of what was said.

export interface ReplyStats {
  /// The model the question went to, so the panel can name it even after another is picked.
  profileId: string;
  /// The question this reply answers, for the conversation log.
  question: string;
  startedAt: number;
  /// When the first token or piece of thinking arrived, or null while none has.
  firstTokenAt: number | null;
  /// When the turn ended, or null while it is still arriving.
  endedAt: number | null;
  /// Summed over every request in the turn - a turn that reads files is several.
  sentTokens: number;
  returnedTokens: number;
  /// What the most recent request carried and produced, which is what the conversation now fills.
  lastSentTokens: number | null;
  lastReturnedTokens: number | null;
  /// How many usage reports arrived, which is how many requests reported one.
  requests: number;
  /// Characters of answer and thinking, for an estimate when no usage is reported.
  characters: number;
  /// How many of `characters` were thinking. A reply the panel shows as empty while the endpoint
  /// reported tokens is often all thinking, and this is how the log can say so.
  reasoningCharacters: number;
  /// How many times the reply streamed so far was cleared - see the `reset` event.
  resets: number;
  /// What each error said, in order.
  errors: string[];
  /// Each request the reply made, as it went and came back. For the conversation log.
  traces: ChatTrace[];
  toolCalls: number;
  failed: boolean;
  stopped: boolean;
}

export function startReplyStats({
  profileId,
  at,
  question = "",
}: {
  profileId: string;
  at: number;
  question?: string;
}): ReplyStats {
  return {
    profileId,
    question,
    startedAt: at,
    firstTokenAt: null,
    endedAt: null,
    sentTokens: 0,
    returnedTokens: 0,
    lastSentTokens: null,
    lastReturnedTokens: null,
    requests: 0,
    characters: 0,
    reasoningCharacters: 0,
    resets: 0,
    errors: [],
    traces: [],
    toolCalls: 0,
    failed: false,
    stopped: false,
  };
}

/// Records one event of the reply, arriving at `at`.
export function noteReplyEvent(stats: ReplyStats, event: ChatEvent, at: number): ReplyStats {
  switch (event.type) {
    case "token":
    case "reasoning":
      // Thinking counts as the first token: it is generated output, and for a reasoning model it is
      // what ends the silence.
      return {
        ...stats,
        firstTokenAt: stats.firstTokenAt ?? at,
        characters: stats.characters + event.text.length,
        reasoningCharacters:
          stats.reasoningCharacters + (event.type === "reasoning" ? event.text.length : 0),
      };
    case "usage":
      return {
        ...stats,
        sentTokens: stats.sentTokens + event.promptTokens,
        returnedTokens: stats.returnedTokens + event.replyTokens,
        lastSentTokens: event.promptTokens,
        lastReturnedTokens: event.replyTokens,
        requests: stats.requests + 1,
      };
    case "tool":
      return { ...stats, toolCalls: stats.toolCalls + 1 };
    case "reset":
      return { ...stats, resets: stats.resets + 1 };
    case "trace":
      return { ...stats, traces: [...stats.traces, event.trace] };
    case "error":
      return { ...stats, failed: true, errors: [...stats.errors, event.message] };
    case "end":
      return { ...stats, endedAt: stats.endedAt ?? at };
    default:
      return stats;
  }
}

/// Marks a reply the user pressed Stop on. Its `end` still arrives afterwards.
export function noteStopped(stats: ReplyStats): ReplyStats {
  return { ...stats, stopped: true };
}

export type ReplyOutcome = "streaming" | "complete" | "stopped" | "failed";

export interface ReplySummary {
  outcome: ReplyOutcome;
  timeToFirstTokenMs: number | null;
  totalMs: number | null;
  /// From the first token to the end: the part of the wait spent writing.
  writingMs: number | null;
  tokensPerSecond: number | null;
  usageReported: boolean;
  /// Null when the endpoint did not report usage - see the note at the top.
  sentTokens: number | null;
  /// Estimated from the text when `usageReported` is false.
  returnedTokens: number;
  totalTokens: number | null;
  contextUsed: number | null;
  contextLimit: number | null;
  contextFraction: number | null;
  toolCalls: number;
  requests: number;
}

/// What the statistics show for one reply, against the model's context window if it has one.
export function summariseReply(stats: ReplyStats, contextLimit: number | null): ReplySummary {
  const usageReported = stats.requests > 0;
  const returnedTokens = usageReported
    ? stats.returnedTokens
    : // The rule of thumb the context dial uses.
      Math.ceil(stats.characters / CHARACTERS_PER_TOKEN);

  const ended = stats.endedAt !== null;
  const writingMs =
    ended && stats.firstTokenAt !== null ? stats.endedAt! - stats.firstTokenAt : null;

  const contextUsed = usageReported
    ? (stats.lastSentTokens ?? 0) + (stats.lastReturnedTokens ?? 0)
    : null;

  return {
    outcome: !ended
      ? "streaming"
      : stats.stopped
        ? "stopped"
        : stats.failed
          ? "failed"
          : "complete",
    timeToFirstTokenMs: stats.firstTokenAt === null ? null : stats.firstTokenAt - stats.startedAt,
    totalMs: ended ? stats.endedAt! - stats.startedAt : null,
    writingMs,
    // Over the writing, not the whole wait: the time before the first token is the model reading
    // the question, and folding it in would make a long document look like a slow model.
    tokensPerSecond:
      writingMs !== null && writingMs > 0 && returnedTokens > 0
        ? returnedTokens / (writingMs / 1000)
        : null,
    usageReported,
    sentTokens: usageReported ? stats.sentTokens : null,
    returnedTokens,
    totalTokens: usageReported ? stats.sentTokens + stats.returnedTokens : null,
    contextUsed,
    contextLimit,
    contextFraction:
      contextUsed !== null && contextLimit !== null && contextLimit > 0
        ? contextUsed / contextLimit
        : null,
    toolCalls: stats.toolCalls,
    requests: stats.requests,
  };
}

export interface ConversationTotals {
  replies: number;
  /// Null when no reply in the conversation reported usage.
  sentTokens: number | null;
  returnedTokens: number;
  /// True when any reply's returned count had to be estimated.
  returnedEstimated: boolean;
  totalMs: number;
}

/// Everything timed in the conversation on screen, retried answers included - they were paid for.
export function conversationTotals(replies: readonly ReplyStats[]): ConversationTotals {
  const summaries = replies.map((stats) => summariseReply(stats, null));
  const reported = summaries.filter((summary) => summary.usageReported);

  return {
    replies: replies.length,
    sentTokens:
      reported.length === 0
        ? null
        : reported.reduce((total, summary) => total + (summary.sentTokens ?? 0), 0),
    returnedTokens: summaries.reduce((total, summary) => total + summary.returnedTokens, 0),
    returnedEstimated: summaries.some((summary) => !summary.usageReported),
    totalMs: summaries.reduce((total, summary) => total + (summary.totalMs ?? 0), 0),
  };
}

