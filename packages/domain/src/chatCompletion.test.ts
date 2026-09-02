import { describe, expect, it } from "vitest";
import { ChatProfileSchema } from "./chat";
import { buildChatRequest, completionsUrl, parseStreamPayload } from "./chatCompletion";

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
