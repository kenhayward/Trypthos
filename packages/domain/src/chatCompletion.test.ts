import { describe, expect, it } from "vitest";
import { ChatProfileSchema } from "./chat";
import {
  buildChatRequest,
  completionsUrl,
  composeMessages,
  parseCompletionPayload,
  parseStreamPayload,
} from "./chatCompletion";

const profile = ChatProfileSchema.parse({
  id: "one",
  label: "Local model",
  endpoint: "https://api.example.com/v1",
  model: "some-model",
});

const turns = [{ role: "user" as const, content: "Hello" }];

describe("completionsUrl", () => {
  it("appends the completions path to the configured base URL", () => {
    expect(completionsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  // Someone will paste the URL with a trailing slash, and a doubled slash is a 404 on enough
  // providers to be worth one line here.
  it("does not double the slash", () => {
    expect(completionsUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });
});

describe("buildChatRequest", () => {
  it("sends the model slug, not the label the user reads", () => {
    expect(buildChatRequest(profile, turns).model).toBe("some-model");
  });

  it("streams, because the panel renders tokens as they arrive", () => {
    expect(buildChatRequest(profile, turns).stream).toBe(true);
  });

  // A streamed reply reports no token counts unless asked for them, and the chat statistics are
  // built from those counts.
  it("asks a streamed reply to report its token usage", () => {
    expect(buildChatRequest(profile, turns).stream_options).toEqual({ include_usage: true });
  });

  it("does not send stream options when the reply is not streamed", () => {
    const whole = ChatProfileSchema.parse({ ...profile, stream: false });
    expect("stream_options" in buildChatRequest(whole, turns)).toBe(false);
  });

  it("sends the turns in order", () => {
    const body = buildChatRequest(profile, [
      { role: "user", content: "First" },
      { role: "assistant", content: "Second" },
      { role: "user", content: "Third" },
    ]);
    expect(body.messages.map((message) => message.content)).toEqual(["First", "Second", "Third"]);
  });

  // An unset parameter must be absent, not null. Providers differ on whether they ignore a null or
  // reject the request, and "temperature: null" failing on one endpoint and not another is a bug
  // nobody would think to look for in a settings form.
  it("omits parameters that were never configured", () => {
    const body = buildChatRequest(profile, turns);
    expect("temperature" in body).toBe(false);
    expect("max_tokens" in body).toBe(false);
  });

  it("sends the parameters that were configured, under their wire names", () => {
    const configured = ChatProfileSchema.parse({
      ...profile,
      temperature: 0.2,
      maxTokens: 4096,
      topP: 0.9,
    });
    const body: Record<string, unknown> = { ...buildChatRequest(configured, turns) };

    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(4096);
    expect(body.top_p).toBe(0.9);
  });
});

describe("parseStreamPayload", () => {
  const token = (text: string) =>
    JSON.stringify({ choices: [{ delta: { content: text }, index: 0 }] });

  it("reads a token", () => {
    expect(parseStreamPayload(token("Hel"))).toEqual({ type: "token", text: "Hel" });
  });

  it("reads the end-of-stream sentinel", () => {
    expect(parseStreamPayload("[DONE]")).toEqual({ type: "done" });
  });

  // The first chunk of a reply usually carries the role and no content at all. Treating that as a
  // token would append an empty string; treating it as an error would end the stream at once.
  it("ignores a chunk with no content", () => {
    const roleOnly = JSON.stringify({ choices: [{ delta: { role: "assistant" } }] });
    expect(parseStreamPayload(roleOnly)).toEqual({ type: "ignored" });
  });

  it("reads usage when the provider reports it", () => {
    const payload = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
    expect(parseStreamPayload(payload)).toEqual({ type: "usage", promptTokens: 12, replyTokens: 34 });
  });

  it("reads an error the provider streams mid-reply", () => {
    const payload = JSON.stringify({ error: { message: "Rate limit exceeded" } });
    expect(parseStreamPayload(payload)).toEqual({
      type: "error",
      message: "Rate limit exceeded",
    });
  });

  // Tolerant outward, strict inward. This is someone else's response: a provider adding a field must
  // not end the reply, so unknown shapes are ignored rather than rejected. Our own IPC payloads are
  // parsed strictly, where an unexpected field means the two sides have drifted.
  it("ignores a chunk in a shape it does not recognise", () => {
    expect(parseStreamPayload(JSON.stringify({ something: "new" }))).toEqual({ type: "ignored" });
  });

  it("ignores a chunk carrying a field it has never seen, rather than failing", () => {
    const payload = JSON.stringify({
      choices: [{ delta: { content: "Hi", reasoning: "..." }, logprobs: null }],
      system_fingerprint: "fp_1",
    });
    expect(parseStreamPayload(payload)).toEqual({ type: "token", text: "Hi" });
  });

  // A truncated frame, or a proxy injecting an HTML error page into the stream. Neither should throw
  // out of the read loop and lose the reply already on screen.
  it("ignores a payload that is not JSON at all", () => {
    expect(parseStreamPayload("<html>502 Bad Gateway</html>")).toEqual({ type: "ignored" });
  });

  it("ignores an empty payload", () => {
    expect(parseStreamPayload("")).toEqual({ type: "ignored" });
  });
});

/// Servers that say "none" with an explicit null rather than by leaving a field out.
///
/// Once a stream is asked to report usage, several servers put `"usage": null` on EVERY chunk until
/// the last, and send `"content": null` beside thinking and `"reasoning_content": null` beside the
/// answer. A null is "nothing here", exactly as an absent field is - refused as a malformed chunk,
/// every chunk of the reply was dropped and only the final usage report counted (#167).
describe("parseStreamPayload, with nulls where a field has nothing", () => {
  // The two shapes a reporting server sent, verbatim apart from the id.
  const chunk = (delta: Record<string, unknown>) =>
    JSON.stringify({
      id: "chatcmpl-0000",
      created: 1789568805,
      model: "halogen-qwen3.8-flash-next",
      object: "chat.completion.chunk",
      choices: [{ index: 0, finish_reason: null, delta }],
      usage: null,
    });

  it("reads thinking from a chunk whose usage is null", () => {
    expect(parseStreamPayload(chunk({ reasoning_content: " Keep" }))).toEqual({
      type: "reasoning",
      text: " Keep",
    });
  });

  it("reads the answer from a chunk whose usage is null", () => {
    expect(parseStreamPayload(chunk({ content: " it" }))).toEqual({ type: "token", text: " it" });
  });

  it("reads thinking beside a null answer, and an answer beside null thinking", () => {
    expect(
      parseStreamPayload(chunk({ content: null, reasoning_content: "Hmm", reasoning: null })),
    ).toEqual({ type: "reasoning", text: "Hmm" });
    expect(
      parseStreamPayload(chunk({ content: "Yes", reasoning_content: null, tool_calls: null })),
    ).toEqual({ type: "token", text: "Yes" });
  });

  it("reads a tool call whose unused parts are null", () => {
    const payload = chunk({
      content: null,
      tool_calls: [{ index: null, id: null, function: { name: null, arguments: '{"op"' } }],
    });
    expect(parseStreamPayload(payload)).toEqual({
      type: "tool-call",
      index: 0,
      name: null,
      argumentsDelta: '{"op"',
    });
  });

  it("reads usage whose counts are null as zero", () => {
    const payload = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 120, completion_tokens: null },
    });
    expect(parseStreamPayload(payload)).toEqual({ type: "usage", promptTokens: 120, replyTokens: 0 });
  });

  it("ignores a chunk that has nothing in it but nulls", () => {
    expect(parseStreamPayload(chunk({ content: null }))).toEqual({ type: "ignored" });
    const empty = JSON.stringify({ choices: null, usage: null, error: null });
    expect(parseStreamPayload(empty)).toEqual({ type: "ignored" });
  });

  // An error with no message is still an error: the server has stopped answering.
  it("reads an error whose message is null", () => {
    expect(parseStreamPayload(JSON.stringify({ error: { message: null } }))).toEqual({
      type: "error",
      message: "The provider reported an error.",
    });
  });
});

/// The same nulls in a completed response, for a profile with streaming off.
describe("parseCompletionPayload, with nulls where a field has nothing", () => {
  it("reads the answer and thinking when the other fields are null", () => {
    const payload = {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { content: "Yes", reasoning_content: "Hmm", reasoning: null, tool_calls: null },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    expect(parseCompletionPayload(payload)).toEqual([
      { type: "token", text: "Yes" },
      { type: "reasoning", text: "Hmm" },
      { type: "usage", promptTokens: 10, replyTokens: 20 },
    ]);
  });

  it("reads a completed response whose usage and error are null", () => {
    const payload = { choices: [{ message: { content: "Yes" } }], usage: null, error: null };
    expect(parseCompletionPayload(payload)).toEqual([{ type: "token", text: "Yes" }]);
  });
});

describe("composeMessages", () => {
  const turns = [
    { role: "user" as const, content: "First" },
    { role: "assistant" as const, content: "An answer" },
    { role: "user" as const, content: "Second" },
  ];
  const context = [{ role: "user" as const, content: "Here is the document." }];

  it("leads with the system prompt", () => {
    const messages = composeMessages({ systemPrompt: "Be brief.", context: [], turns });
    expect(messages[0]).toEqual({ role: "system", content: "Be brief." });
  });

  // An empty system message is not the same as no system message, and some endpoints reject one.
  it("omits a blank system prompt entirely", () => {
    const messages = composeMessages({ systemPrompt: "   ", context: [], turns });
    expect(messages.some((message) => message.role === "system")).toBe(false);
  });

  it("keeps the conversation in order", () => {
    const messages = composeMessages({ systemPrompt: "", context: [], turns });
    expect(messages).toEqual(turns);
  });

  // Beside the question it belongs to, not pinned at the top: in a long thread the document would
  // otherwise be a long way from whatever was asked about it.
  it("puts the document immediately before the question being asked", () => {
    const messages = composeMessages({ systemPrompt: "", context, turns });
    expect(messages.map((message) => message.content)).toEqual([
      "First",
      "An answer",
      "Here is the document.",
      "Second",
    ]);
  });

  it("sends the document even when it is the very first thing asked", () => {
    const messages = composeMessages({
      systemPrompt: "Be brief.",
      context,
      turns: [{ role: "user", content: "Summarise this" }],
    });
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
    expect(messages[1]?.content).toBe("Here is the document.");
  });

  it("does not lose the document if the history does not end in a question", () => {
    const messages = composeMessages({ systemPrompt: "", context, turns: [] });
    expect(messages).toEqual(context);
  });
});

/// Reasoning models stream their thinking separately from the answer.
///
/// Taken from a real local model, which ended a turn having sent reasoning and no content at all.
/// Ignoring the field showed the user an empty bubble with no explanation.
describe("the reasoning channel", () => {
  it("reads reasoning under the name llama.cpp and LM Studio use", () => {
    const payload = JSON.stringify({ choices: [{ delta: { reasoning: "Let me think." } }] });
    expect(parseStreamPayload(payload)).toEqual({ type: "reasoning", text: "Let me think." });
  });

  it("reads reasoning under the name DeepSeek uses", () => {
    const payload = JSON.stringify({ choices: [{ delta: { reasoning_content: "Hmm." } }] });
    expect(parseStreamPayload(payload)).toEqual({ type: "reasoning", text: "Hmm." });
  });

  // The answer is what was asked for; the thinking is only shown when no answer arrives.
  it("prefers the answer when a chunk carries both", () => {
    const payload = JSON.stringify({
      choices: [{ delta: { content: "The answer.", reasoning: "Working it out." } }],
    });
    expect(parseStreamPayload(payload)).toEqual({ type: "token", text: "The answer." });
  });

  it("ignores an empty reasoning delta", () => {
    const payload = JSON.stringify({ choices: [{ delta: { reasoning: "" } }] });
    expect(parseStreamPayload(payload)).toEqual({ type: "ignored" });
  });
});

/// The tool-calling transport.
///
/// Opt-in per profile, because there is no reliable way to ask an OpenAI-compatible endpoint whether
/// it supports tools: several accept a `tools` array, ignore it, and answer in prose.
describe("tool calling", () => {
  it("can disable streaming for an endpoint whose streamed tool calls are malformed", () => {
    const nonStreaming = ChatProfileSchema.parse({ ...profile, stream: false });

    expect(buildChatRequest(nonStreaming, turns).stream).toBe(false);
  });

  it("sends no tools unless the profile says the endpoint supports them", () => {
    const body = buildChatRequest(profile, turns);
    expect("tools" in body).toBe(false);
  });

  it("offers the edit tool when the profile says so", () => {
    const capable = ChatProfileSchema.parse({ ...profile, supportsTools: true });
    const body = buildChatRequest(capable, turns);

    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });

  it("reads a tool call fragment", () => {
    const payload = JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { name: "propose_edit", arguments: '{"op":' } }],
          },
        },
      ],
    });

    expect(parseStreamPayload(payload)).toEqual({
      type: "tool-call",
      index: 0,
      name: "propose_edit",
      argumentsDelta: '{"op":',
    });
  });

  it("reads a continuation fragment, which carries no name", () => {
    const payload = JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"append"}' } }] } }],
    });

    expect(parseStreamPayload(payload)).toEqual({
      type: "tool-call",
      index: 0,
      name: null,
      argumentsDelta: '"append"}',
    });
  });

  // Some providers omit the index when there is only ever one call in flight. Treating each fragment
  // as a new call would assemble none of them.
  it("assumes the first call when no index is given", () => {
    const payload = JSON.stringify({
      choices: [{ delta: { tool_calls: [{ function: { arguments: "{}" } }] } }],
    });

    expect(parseStreamPayload(payload)).toMatchObject({ type: "tool-call", index: 0 });
  });

  // A chunk carrying both is the model doing what was asked. Preferring the thinking would lose the
  // proposal entirely.
  it("prefers a tool call over the reasoning beside it", () => {
    const payload = JSON.stringify({
      choices: [
        {
          delta: {
            reasoning: "Deciding where it goes.",
            tool_calls: [{ index: 0, function: { arguments: "{}" } }],
          },
        },
      ],
    });

    expect(parseStreamPayload(payload)).toMatchObject({ type: "tool-call" });
  });
});

describe("composeMessages with several context turns", () => {
  // The folder outline, an attachment and the document are three messages, and all of them belong
  // beside the question rather than scattered through the history.
  it("keeps them together, in order, before the question", () => {
    const messages = composeMessages({
      systemPrompt: "",
      context: [
        { role: "user", content: "The folder holds..." },
        { role: "user", content: "Here is risks.md" },
        { role: "user", content: "Here is the document" },
      ],
      turns: [
        { role: "user", content: "First" },
        { role: "assistant", content: "An answer" },
        { role: "user", content: "Second" },
      ],
    });

    expect(messages.map((message) => message.content)).toEqual([
      "First",
      "An answer",
      "The folder holds...",
      "Here is risks.md",
      "Here is the document",
      "Second",
    ]);
  });
});

/// Reasoning effort, for models that have levels of it.
///
/// gpt-oss is the one this was built for: it reasons at low, medium or high, and OpenAI-compatible
/// servers take that as `reasoning_effort` on the request. Off is the default because a field a
/// server does not know is at best ignored and at worst a 400 - the same reasoning that keeps
/// `tools` behind a switch.
describe("reasoning effort", () => {
  const withThinking = (over: Partial<typeof profile> = {}): typeof profile => ({
    ...profile,
    thinking: true,
    reasoningEffort: "medium",
    ...over,
  });

  it("sends nothing at all when thinking is off", () => {
    const body = buildChatRequest({ ...profile, thinking: false }, turns);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("sends the level under the name an OpenAI-compatible server reads", () => {
    expect(buildChatRequest(withThinking(), turns).reasoning_effort).toBe("medium");
  });

  it("sends each level as the model names it", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(buildChatRequest(withThinking({ reasoningEffort: level }), turns).reasoning_effort).toBe(
        level,
      );
    }
  });

  // The level is remembered while thinking is off, so turning it back on does not lose the choice.
  // That is why these are two fields rather than one four-valued one.
  it("keeps a level that is not being sent out of the request", () => {
    const body = buildChatRequest({ ...profile, thinking: false, reasoningEffort: "high" }, turns);
    expect("reasoning_effort" in body).toBe(false);
  });
});
