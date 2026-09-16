import { describe, expect, it } from "vitest";
import { ChatProfileSchema, type ChatEvent, type ChatTrace } from "@trypthos/domain";
import i18n from "./i18n";
import { conversationLog } from "./conversationLog";
import { noteReplyEvent, startReplyStats, type ReplyStats } from "./replyStats";
import type { Turn } from "./conversation";

/// The conversation log, which a user opens to find out what really happened to a reply.
///
/// Written against the real catalogue: a key that does not exist renders as the key, and in a
/// document nobody proofreads that would go unnoticed.

const t = i18n.t.bind(i18n);

const model = ChatProfileSchema.parse({
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "gpt-oss:20b",
});

const trace = (over: Partial<ChatTrace> = {}): ChatTrace => ({
  round: 0,
  url: "http://localhost:11434/v1/chat/completions",
  request: '{\n  "model": "gpt-oss:20b"\n}',
  status: 200,
  response: 'data: {"choices":[{"delta":{"reasoning":"Hmm"}}]}\n\ndata: [DONE]\n\n',
  notes: [],
  ...over,
});

function reply(events: ChatEvent[], question = "Why is it empty?"): ReplyStats {
  return events.reduce(
    (stats, event, index) => noteReplyEvent(stats, event, 100 * (index + 1)),
    startReplyStats({ profileId: "one", at: 0, question }),
  );
}

const log = (turns: Turn[], replyStats: ReplyStats[]) =>
  conversationLog({ turns, replyStats, models: [model], t, language: "en" });

describe("conversationLog", () => {
  it("is titled, and says when nothing has been asked", () => {
    const text = log([], []);

    expect(text.startsWith("# Conversation Log\n")).toBe(true);
    expect(text).toContain("Nothing has been asked in this conversation yet.");
  });

  it("shows the thread as the panel holds it, text exactly as written", () => {
    const text = log(
      [
        { role: "user", content: "Why is it empty?" },
        { role: "assistant", content: "", reasoning: "Thinking **hard**" },
      ],
      [],
    );

    expect(text).toContain("Why is it empty?");
    // Fenced, so the log shows what was said rather than a rendering of it.
    expect(text).toMatch(/```text\nThinking \*\*hard\*\*\n```/);
  });

  it("shows each request of a reply: where it went, what was sent, and what came back", () => {
    const text = log(
      [],
      [
        reply([
          { type: "reasoning", text: "Hmm" },
          { type: "usage", promptTokens: 120, replyTokens: 900 },
          { type: "trace", trace: trace({ notes: ["A propose_edit call was dropped."] }) },
          { type: "end" },
        ]),
      ],
    );

    expect(text).toContain("Why is it empty?");
    expect(text).toContain("Local model (gpt-oss:20b)");
    expect(text).toContain("http://localhost:11434/v1/chat/completions");
    expect(text).toContain("HTTP 200");
    expect(text).toMatch(/```json\n\{\n {2}"model": "gpt-oss:20b"\n\}\n```/);
    expect(text).toContain('data: {"choices":[{"delta":{"reasoning":"Hmm"}}]}');
    expect(text).toContain("A propose_edit call was dropped.");
    expect(text).toContain("900");
  });

  // The case the log exists for: the endpoint reported tokens, and the panel showed no answer.
  it("says when tokens were returned but no answer text reached the panel", () => {
    const text = log(
      [],
      [
        reply([
          { type: "reasoning", text: "Thinking it over" },
          { type: "usage", promptTokens: 120, replyTokens: 900 },
          { type: "end" },
        ]),
      ],
    );

    expect(text).toContain("No answer text reached the panel");
    expect(text).toContain("16 characters of thinking");
  });

  it("says how many times a reply was cleared, and what each error said", () => {
    const text = log(
      [],
      [
        reply([
          { type: "token", text: "asking" },
          { type: "reset" },
          { type: "error", message: "The reply stopped part-way through." },
          { type: "end" },
        ]),
      ],
    );

    expect(text).toContain("Times the panel cleared this reply: 1");
    expect(text).toContain("The reply stopped part-way through.");
  });

  it("says a request never reached the endpoint rather than showing a status", () => {
    const text = log([], [reply([{ type: "trace", trace: trace({ status: null, response: "" }) }, { type: "end" }])]);

    expect(text).toContain("Not reached");
  });

  // A response carrying a fence of its own would otherwise close the log's fence early, and
  // everything after it would render as markdown.
  it("fences text that contains a fence of its own without breaking out of it", () => {
    const text = log(
      [],
      [reply([{ type: "trace", trace: trace({ response: "```trypthos-edit\nx\n```" }) }, { type: "end" }])],
    );

    expect(text).toContain("````text\n```trypthos-edit\nx\n```\n````");
  });

  it("names a model that is no longer configured", () => {
    const stats = startReplyStats({ profileId: "gone", at: 0, question: "Hi" });
    expect(conversationLog({ turns: [], replyStats: [stats], models: [], t, language: "en" })).toContain(
      "A model no longer configured",
    );
  });
});
