"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatProvider } = require("../src/chatProvider");

/// The provider call, which happens here and nowhere else.
///
/// The renderer never opens a socket to a provider and never holds the key - so these tests are
/// about what this module sends, what it emits back, and what it must never say out loud.

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "https://api.example.com/v1",
  model: "some-model",
  supportsImages: false,
  isDefault: true,
};

const KEY = "sk-test-do-not-use-90210";
const TURNS = [{ role: "user", content: "Hello" }];

/// A fetch that answers with a stream of SSE frames.
function streamingFetch(frames, { status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      body: {
        getReader() {
          const queue = [...frames];
          return {
            read: async () =>
              queue.length === 0
                ? { done: true, value: undefined }
                : { done: false, value: Buffer.from(queue.shift(), "utf8") },
            cancel: async () => {},
          };
        },
      },
      text: async () => frames.join(""),
    };
  };
}

function collect() {
  const events = [];
  return { events, onEvent: (event) => events.push(event) };
}

const silent = { error: () => {}, warn: () => {} };

function provider(fetchImpl, { key = KEY, logger = silent } = {}) {
  return createChatProvider({
    fetchImpl,
    secrets: { getKey: async () => key },
    logger,
  });
}

test("streams the reply back token by token", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events, [
    { type: "token", text: "Hel" },
    { type: "token", text: "lo" },
    { type: "end" },
  ]);
});

test("posts to the endpoint's completions path, with the configured model", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent: () => {} });

  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(JSON.parse(calls[0].init.body).model, "some-model");
});

test("sends the stored key as a bearer token", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent: () => {} });

  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
});

// A local model served by Ollama or llama.cpp needs no key at all. Refusing to call without one
// would make the most private way to use Trypthos the one way that does not work.
test("calls without an Authorization header when no key is stored", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl, { key: null }).run({
    profile: PROFILE,
    turns: TURNS,
    onEvent: () => {},
  });

  assert.equal("Authorization" in calls[0].init.headers, false);
});

test("reports a refused request as an error the user can act on", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(["Unauthorized"], { status: 401 });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /key/i);
});

test("distinguishes a rate limit from a rejected key", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(["Slow down"], { status: 429 });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.match(events.at(-1).message, /too many requests/i);
});

test("reports a model the endpoint does not have", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(['{"error":{"message":"no such model"}}'], { status: 404 });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /some-model/);
});

test("reports a connection that never opened", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /could not be reached/i);
});

// The reason this module is worth testing at all. An error message is shown to the user, written to
// a log, and pasted into a bug report - so a key reaching one is a key published.
test("no error path repeats the API key", async () => {
  const logged = [];
  const logger = { error: (...args) => logged.push(args.join(" ")), warn: () => {} };

  for (const fetchImpl of [
    streamingFetch([`Invalid key ${KEY}`], { status: 401 }),
    streamingFetch([`{"error":{"message":"bad key ${KEY}"}}`], { status: 400 }),
    async () => {
      throw new Error(`connect failed with Authorization: Bearer ${KEY}`);
    },
  ]) {
    const { events, onEvent } = collect();
    await provider(fetchImpl, { logger }).run({ profile: PROFILE, turns: TURNS, onEvent });

    const said = JSON.stringify(events);
    assert.ok(!said.includes(KEY), `an error event repeated the key: ${said}`);
  }

  assert.ok(!logged.join("\n").includes(KEY), "the log repeated the key");
});

test("an error mid-stream ends the reply rather than hanging", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
    'data: {"error":{"message":"Rate limit exceeded"}}\n\n',
  ]);

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events[0], { type: "token", text: "Partial" });
  // `end` is always the last event, error or not, so the panel has ONE signal that the turn is over
  // rather than two shapes of ending to get right.
  assert.deepEqual(events.at(-1), { type: "end" });

  const failure = events.find((event) => event.type === "error");
  assert.match(failure.message, /Rate limit/);
});

// A stream that stops without [DONE] - the connection dropped, or the provider simply closed it.
// The panel has to be told the reply finished, or the stop button stays up forever.
test("a stream that ends without a sentinel still ends the turn", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(['data: {"choices":[{"delta":{"content":"Cut"}}]}\n\n']);

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events.at(-1), { type: "end" });
});

test("cancelling stops the stream and ends the turn once", async () => {
  const { events, onEvent } = collect();
  const controller = new AbortController();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          controller.abort();
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
        cancel: async () => {},
      }),
    },
    text: async () => "",
  });

  await provider(fetchImpl).run({
    profile: PROFILE,
    turns: TURNS,
    onEvent,
    signal: controller.signal,
  });

  assert.deepEqual(events, [{ type: "end" }]);
});

test("passes usage through when the provider reports it", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}\n\n',
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events[0], { type: "usage", promptTokens: 12, replyTokens: 34 });
});
