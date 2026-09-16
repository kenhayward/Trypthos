import { describe, expect, it } from "vitest";
import {
  conversationTotals,
  noteReplyEvent,
  noteStopped,
  startReplyStats,
  summariseReply,
  type ReplyStats,
} from "./replyStats";

/// Plays events into a reply at the given clock readings, in milliseconds.
function play(steps: [number, Parameters<typeof noteReplyEvent>[1]][], at = 1000): ReplyStats {
  return steps.reduce(
    (stats, [when, event]) => noteReplyEvent(stats, event, when),
    startReplyStats({ profileId: "one", at }),
  );
}

describe("replyStats", () => {
  it("times the first token, the whole reply, and the writing between them", () => {
    const stats = play([
      [1400, { type: "token", text: "Hello" }],
      [3400, { type: "token", text: " there" }],
      [3400, { type: "usage", promptTokens: 120, replyTokens: 40 }],
      [3500, { type: "end" }],
    ]);

    const summary = summariseReply(stats, 8000);
    expect(summary.timeToFirstTokenMs).toBe(400);
    expect(summary.totalMs).toBe(2500);
    expect(summary.writingMs).toBe(2100);
    expect(summary.outcome).toBe("complete");
  });

  it("works out tokens per second over the writing, not the wait before it", () => {
    const stats = play([
      [2000, { type: "token", text: "a" }],
      [4000, { type: "usage", promptTokens: 10, replyTokens: 50 }],
      [4000, { type: "end" }],
    ]);

    expect(summariseReply(stats, null).tokensPerSecond).toBe(25);
  });

  // The model's thinking is generated too, and a reasoning model can think for a long time before a
  // word of the answer. The wait the user sits through ends at whichever arrives first.
  it("counts thinking as the first token", () => {
    const stats = play([
      [1300, { type: "reasoning", text: "Hmm" }],
      [2000, { type: "token", text: "Yes" }],
      [2000, { type: "end" }],
    ]);

    expect(summariseReply(stats, null).timeToFirstTokenMs).toBe(300);
  });

  // A turn that reads a file is several requests. Every one of them was paid for, so the totals add
  // up - but the context the conversation now fills is what the LAST request carried.
  it("adds up every request in the turn, and measures context from the last one", () => {
    const stats = play([
      [1100, { type: "tool", name: "get_file_contents", detail: "a.md" }],
      [1100, { type: "usage", promptTokens: 100, replyTokens: 20 }],
      [1500, { type: "token", text: "Done" }],
      [1600, { type: "usage", promptTokens: 900, replyTokens: 30 }],
      [1600, { type: "end" }],
    ]);

    const summary = summariseReply(stats, 4000);
    expect(summary.sentTokens).toBe(1000);
    expect(summary.returnedTokens).toBe(50);
    expect(summary.totalTokens).toBe(1050);
    expect(summary.contextUsed).toBe(930);
    expect(summary.contextLimit).toBe(4000);
    expect(summary.contextFraction).toBeCloseTo(930 / 4000);
    expect(summary.toolCalls).toBe(1);
    expect(summary.requests).toBe(2);
    // What the last request alone sent, beside the total across both (#169).
    expect(summary.lastSentTokens).toBe(900);
  });

  // Some endpoints ignore the request for usage. What was returned can still be estimated from the
  // text, and says it is an estimate; what was sent cannot be, and says it was not reported.
  it("estimates what was returned when the endpoint reports no usage", () => {
    const stats = play([
      [1200, { type: "token", text: "a".repeat(400) }],
      [2200, { type: "end" }],
    ]);

    const summary = summariseReply(stats, 8000);
    expect(summary.usageReported).toBe(false);
    expect(summary.returnedTokens).toBe(100);
    expect(summary.sentTokens).toBeNull();
    expect(summary.totalTokens).toBeNull();
    expect(summary.contextUsed).toBeNull();
    expect(summary.tokensPerSecond).toBe(100);
  });

  it("leaves the times open while the reply is still arriving", () => {
    const stats = play([[1200, { type: "token", text: "Hi" }]]);

    const summary = summariseReply(stats, null);
    expect(summary.outcome).toBe("streaming");
    expect(summary.totalMs).toBeNull();
    expect(summary.tokensPerSecond).toBeNull();
  });

  it("has no first token for a reply that failed before one arrived", () => {
    const stats = play([
      [1500, { type: "error", message: "No." }],
      [1500, { type: "end" }],
    ]);

    const summary = summariseReply(stats, null);
    expect(summary.outcome).toBe("failed");
    expect(summary.timeToFirstTokenMs).toBeNull();
    expect(summary.totalMs).toBe(500);
  });

  it("says a reply the user stopped was stopped", () => {
    const begun = play([[1200, { type: "token", text: "Hi" }]]);
    const stats = noteReplyEvent(noteStopped(begun), { type: "end" }, 1300);

    expect(summariseReply(stats, null).outcome).toBe("stopped");
  });

  it("totals every timed reply in the conversation", () => {
    const first = play([
      [1100, { type: "token", text: "a" }],
      [1500, { type: "usage", promptTokens: 100, replyTokens: 10 }],
      [1500, { type: "end" }],
    ]);
    const second = play(
      [
        [5200, { type: "token", text: "b" }],
        [6000, { type: "usage", promptTokens: 300, replyTokens: 30 }],
        [6000, { type: "end" }],
      ],
      5000,
    );

    expect(conversationTotals([first, second])).toEqual({
      replies: 2,
      sentTokens: 400,
      returnedTokens: 40,
      returnedEstimated: false,
      totalMs: 1500,
      stillArriving: 0,
    });
  });

  // A reply still arriving has no total time yet. It is counted as arriving rather than added as
  // nothing, which read as a conversation that had taken 0 ms (#169).
  it("counts a reply still arriving rather than adding it as no time", () => {
    const finished = play([
      [1100, { type: "token", text: "a" }],
      [1500, { type: "end" }],
    ]);
    const arriving = play([[5200, { type: "token", text: "b" }]], 5000);

    expect(conversationTotals([finished, arriving])).toMatchObject({
      replies: 2,
      totalMs: 500,
      stillArriving: 1,
    });
    expect(conversationTotals([arriving])).toMatchObject({ totalMs: 0, stillArriving: 1 });
  });

  it("has nothing sent to total when no reply reported usage", () => {
    const stats = play([
      [1100, { type: "token", text: "abcd" }],
      [1500, { type: "end" }],
    ]);

    expect(conversationTotals([stats])).toEqual({
      replies: 1,
      sentTokens: null,
      returnedTokens: 1,
      returnedEstimated: true,
      totalMs: 500,
      stillArriving: 0,
    });
  });
});

/// What the conversation log needs of a reply beyond its numbers.
describe("replyStats, for the conversation log", () => {
  const trace = {
    round: 0,
    url: "https://api.example.com/v1/chat/completions",
    request: "{}",
    status: 200,
    response: "data: [DONE]",
    notes: [],
  };

  it("remembers the question it answers", () => {
    expect(startReplyStats({ profileId: "one", at: 0, question: "Why?" }).question).toBe("Why?");
  });

  it("keeps each request's trace, in order", () => {
    const stats = play([
      [1100, { type: "trace", trace }],
      [1200, { type: "trace", trace: { ...trace, round: 1 } }],
      [1200, { type: "end" }],
    ]);
    expect(stats.traces.map((each) => each.round)).toEqual([0, 1]);
  });

  // A reply that looks empty in the panel and still reported tokens is usually one of these: all
  // thinking and no answer, or an answer the panel was told to clear.
  it("counts thinking apart from the answer, and every time the reply was cleared", () => {
    const stats = play([
      [1100, { type: "reasoning", text: "abcdef" }],
      [1200, { type: "token", text: "abc" }],
      [1300, { type: "reset" }],
      [1400, { type: "end" }],
    ]);
    expect(stats.characters).toBe(9);
    expect(stats.reasoningCharacters).toBe(6);
    expect(stats.resets).toBe(1);
  });

  it("keeps what each error said", () => {
    const stats = play([
      [1100, { type: "error", message: "Rate limited." }],
      [1100, { type: "end" }],
    ]);
    expect(stats.errors).toEqual(["Rate limited."]);
  });
});
