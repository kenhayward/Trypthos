import { describe, expect, it } from "vitest";
import { ChatProfileSchema } from "./chat";
import {
  buildChatRequest,
  completionsUrl,
  composeMessages,
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
