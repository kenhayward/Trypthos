"use strict";

const test = require("node:test");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { TRACE_TEXT_LIMIT, createChatProvider } = require("../src/chatProvider");

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

/// A complete OpenAI-compatible response for a profile that has streaming switched off.
function completionFetch(responses, { calls = [] } = {}) {
  return async (url, init) => {
    const response = responses[Math.min(calls.length, responses.length - 1)];
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      body: null,
      json: async () => response,
      text: async () => JSON.stringify(response),
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

  // `end` is always last, so the panel stops waiting. Before this it was not emitted on a failed
  // request at all, which left the stop button up and the panel streaming for ever.
  assert.deepEqual(events.at(-1), { type: "end" });
  assert.match(events.find((event) => event.type === "error").message, /key/i);
});

test("distinguishes a rate limit from a rejected key", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(["Slow down"], { status: 429 });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.match(events.find((event) => event.type === "error").message, /too many requests/i);
});

test("reports a model the endpoint does not have", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(['{"error":{"message":"no such model"}}'], { status: 404 });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events.at(-1), { type: "end" });
  assert.match(events.find((event) => event.type === "error").message, /some-model/);
});

test("reports a connection that never opened", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events.at(-1), { type: "end" });
  assert.match(events.find((event) => event.type === "error").message, /could not be reached/i);
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

/// How long a model may go quiet before the turn is given up on.
///
/// Silence, not duration: the clock restarts with every piece of the reply, so a long answer that
/// keeps arriving is never cut off, and a model that has simply gone away does not hold the stop
/// button up for ever. Driven by a timer the test controls, so a ten-minute wait is a step.
describe("the reply timeout", () => {
  /// Timers the test fires by hand. Records how long each was set for.
  function manualTimers() {
    const pending = new Map();
    const durations = [];
    let next = 1;
    return {
      durations,
      setTimeout: (fn, ms) => {
        const id = next++;
        pending.set(id, fn);
        durations.push(ms);
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
      fire: () => {
        for (const [id, fn] of [...pending]) {
          pending.delete(id);
          fn();
        }
      },
      pending: () => pending.size,
    };
  }

  /// Lets every promise that can settle, settle.
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /// A promise that never settles on its own, and rejects the way fetch does when its signal aborts.
  const untilAborted = (signal) =>
    new Promise((_, reject) => {
      const fail = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });

  function timedProvider(fetchImpl, timers) {
    return createChatProvider({
      fetchImpl,
      secrets: { getKey: async () => null },
      logger: silent,
      timers,
    });
  }

  it("gives up on an endpoint that never answers, and says why", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const running = timedProvider((_url, init) => untilAborted(init.signal), timers).run({
      profile: PROFILE,
      turns: TURNS,
      onEvent,
    });

    await settle();
    timers.fire();
    await running;

    const failure = events.find((event) => event.type === "error");
    assert.match(failure.message, /Local model sent nothing for 10 minutes/);
    assert.match(failure.message, /Settings/);
    assert.deepEqual(events.at(-1), { type: "end" });
  });

  it("waits ten minutes for a model that has not been given a timeout", async () => {
    const timers = manualTimers();
    const running = timedProvider((_url, init) => untilAborted(init.signal), timers).run({
      profile: PROFILE,
      turns: TURNS,
      onEvent: () => {},
    });

    await settle();
    assert.deepEqual(timers.durations, [10 * 60_000]);
    timers.fire();
    await running;
  });

  it("waits as long as the model's own timeout says", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const running = timedProvider((_url, init) => untilAborted(init.signal), timers).run({
      profile: { ...PROFILE, timeoutMinutes: 60 },
      turns: TURNS,
      onEvent,
    });

    await settle();
    assert.deepEqual(timers.durations, [60 * 60_000]);
    timers.fire();
    await running;

    assert.match(events.find((event) => event.type === "error").message, /60 minutes/);
  });

  it("says one minute, not one minutes", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const running = timedProvider((_url, init) => untilAborted(init.signal), timers).run({
      profile: { ...PROFILE, timeoutMinutes: 1 },
      turns: TURNS,
      onEvent,
    });

    await settle();
    timers.fire();
    await running;

    assert.match(events.find((event) => event.type === "error").message, /for 1 minute,/);
  });

  // Silence, not duration. A reply still arriving is a model still working.
  it("starts the clock again with every piece of the reply", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();

    await timedProvider(
      streamingFetch([
        'data: {"choices":[{"delta":{"content":"One"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" two"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" three"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      timers,
    ).run({ profile: PROFILE, turns: TURNS, onEvent });

    // Armed for the request, again when the answer began, and again for each of the four pieces.
    assert.ok(timers.durations.length >= 5, `armed ${timers.durations.length} times`);
    assert.equal(events.some((event) => event.type === "error"), false);
    // And nothing left running once the turn is over - a stray ten-minute timer would fire an error
    // into a conversation that finished long ago.
    assert.equal(timers.pending(), 0);
  });

  // What already arrived is the model's actual words, and a partial answer is often worth reading.
  it("keeps what arrived when a reply goes quiet part-way", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const fetchImpl = async (_url, init) => {
      let sent = false;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (!sent) {
                sent = true;
                return {
                  done: false,
                  value: Buffer.from('data: {"choices":[{"delta":{"content":"Half"}}]}\n\n'),
                };
              }
              return untilAborted(init.signal);
            },
            cancel: async () => {},
          }),
        },
      };
    };

    const running = timedProvider(fetchImpl, timers).run({ profile: PROFILE, turns: TURNS, onEvent });
    await settle();
    await settle();
    timers.fire();
    await running;

    assert.deepEqual(events[0], { type: "token", text: "Half" });
    assert.match(events.find((event) => event.type === "error").message, /sent nothing for 10 minutes/);
    assert.deepEqual(events.at(-1), { type: "end" });
  });

  // With streaming off the whole reply is one wait, so the timeout bounds all of it.
  it("gives up on a complete reply that never comes", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const fetchImpl = async (_url, init) => ({
      ok: true,
      status: 200,
      body: null,
      json: () => untilAborted(init.signal),
    });

    const running = timedProvider(fetchImpl, timers).run({
      profile: { ...PROFILE, stream: false },
      turns: TURNS,
      onEvent,
    });
    await settle();
    timers.fire();
    await running;

    assert.match(events.find((event) => event.type === "error").message, /sent nothing for 10 minutes/);
    assert.deepEqual(events.at(-1), { type: "end" });
  });

  // Stop is the user's choice, not a failure: it ends quietly, and does not claim a timeout.
  it("still ends quietly when the user stops the reply", async () => {
    const timers = manualTimers();
    const { events, onEvent } = collect();
    const controller = new AbortController();
    const running = timedProvider((_url, init) => untilAborted(init.signal), timers).run({
      profile: PROFILE,
      turns: TURNS,
      onEvent,
      signal: controller.signal,
    });

    await settle();
    controller.abort();
    await running;

    assert.deepEqual(events, [{ type: "end" }]);
    assert.equal(timers.pending(), 0);
  });
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

/// The tool-calling transport.
///
/// A completed call becomes exactly the block the fenced transport produces, so everything
/// downstream - the card, resolving the anchor, applying it - has one representation rather than
/// two. These tests are about the assembly: fragments arrive separately and a turn can end
/// mid-object.

const TOOLS_PROFILE = { ...PROFILE, supportsTools: true };

const toolFrames = (fragments, { index = 0 } = {}) =>
  fragments.map((fragment, at) =>
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                function: at === 0 ? { name: "propose_edit", arguments: fragment } : { arguments: fragment },
              },
            ],
          },
        },
      ],
    })}\n\n`,
  );

test("offers the edit tool when the profile supports it", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent: () => {} });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].function.name, "propose_edit");
});

test("sends no tools for a profile that does not support them", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent: () => {} });
  assert.equal("tools" in JSON.parse(calls[0].init.body), false);
});

test("assembles a tool call split across frames into one proposal", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    ...toolFrames(['{"op":"insert-before",', '"heading":"Objectives",', '"content":"## Summary"}']),
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent });

  const text = events
    .filter((event) => event.type === "token")
    .map((event) => event.text)
    .join("");
  assert.match(text, /trypthos-edit insert-before heading="Objectives"/);
  assert.match(text, /## Summary/);
});

// The proposal has to survive to the end of the turn: emitting it early would mean emitting half an
// argument object.
test("emits the proposal only once the turn has ended", async () => {
  const seen = [];
  const fetchImpl = streamingFetch([
    ...toolFrames(['{"op":"append","content":"Text."}']),
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent: (event) => seen.push(event.type),
  });

  assert.deepEqual(seen, ["token", "end"]);
});

test("keeps the prose a model wrote alongside its tool call", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    'data: {"choices":[{"delta":{"content":"Here is a summary."}}]}\n\n',
    ...toolFrames(['{"op":"append","content":"## Summary"}']),
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent });

  const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.match(text, /Here is a summary\./);
  assert.match(text, /trypthos-edit/);
});

test("assembles two separate calls into two proposals", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    ...toolFrames(['{"op":"append","content":"One."}'], { index: 0 }),
    ...toolFrames(['{"op":"append","content":"Two."}'], { index: 1 }),
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent });

  const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.equal(text.match(/trypthos-edit/g).length, 2);
});

// A turn cut off mid-object. The reply already on screen is worth more than the proposal that failed
// to arrive, so nothing throws and nothing half-formed is offered.
test("drops a tool call whose arguments never finished", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch(toolFrames(['{"op":"append","cont']));

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent });

  assert.deepEqual(events, [{ type: "end" }]);
});

test("drops a tool call that asks for something unrecognised", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = streamingFetch([
    ...toolFrames(['{"op":"delete-everything","content":"Text."}']),
    "data: [DONE]\n\n",
  ]);

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent });
  assert.deepEqual(events, [{ type: "end" }]);
});

/// Reading files the model asks for.
///
/// This is the one tool the app CARRIES OUT, so it is a loop rather than a single request - and the
/// tests that matter are the bounds: what may be read, how many times, and what happens when the
/// answer is no.

/// A fetch that answers differently on each call, so a loop can be driven.
function scriptedFetch(responses, { calls = [] } = {}) {
  return async (url, init) => {
    const frames = responses[Math.min(calls.length, responses.length - 1)];
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
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
      text: async () => "",
    };
  };
}

const readCall = (path) =>
  `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { name: "get_file_contents", arguments: JSON.stringify({ path }) },
            },
          ],
        },
      },
    ],
  })}\n\n`;

const completeReadCall = (path) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            id: "call_one",
            function: { name: "get_file_contents", arguments: JSON.stringify({ path }) },
          },
        ],
      },
    },
  ],
});

const completeAnswer = (content) => ({
  choices: [{ message: { role: "assistant", content } }],
});

const says = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/// Serves only the files the outline named. This IS the allowlist.
const allowlist = (files) => async (path) =>
  path in files ? { ok: true, content: files[path] } : { ok: false, reason: "not-allowed" };

test("offers the read tool only when there is something to read from", async () => {
  const calls = [];
  const fetchImpl = streamingFetch(["data: [DONE]\n\n"], { calls });

  await provider(fetchImpl).run({ profile: TOOLS_PROFILE, turns: TURNS, onEvent: () => {} });
  const names = (calls[0].init ? JSON.parse(calls[0].init.body) : {}).tools.map(
    (tool) => tool.function.name,
  );

  assert.deepEqual(names, ["propose_edit"]);
});

test("offers the read tool when a folder was listed", async () => {
  const calls = [];
  const fetchImpl = scriptedFetch([["data: [DONE]\n\n"]], { calls });

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent: () => {},
    readFile: allowlist({ "plan.md": "# Plan" }),
  });

  const names = calls[0].body.tools.map((tool) => tool.function.name);
  assert.deepEqual(names.sort(), ["get_file_contents", "propose_edit"]);
});

test("reads a file the model asks for and answers with what it said next", async () => {
  const calls = [];
  const { events, onEvent } = collect();
  const fetchImpl = scriptedFetch(
    [
      [readCall("plan.md"), "data: [DONE]\n\n"],
      [says("The plan is short."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "# Plan\n\nDo the thing." }),
  });

  // Two requests: the one that asked, and the one that answered.
  assert.equal(calls.length, 2);

  // The file came back as a tool result, which is what let the model continue.
  const second = calls[1].body.messages;
  assert.equal(second.at(-1).role, "tool");
  assert.match(second.at(-1).content, /Do the thing\./);

  const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.match(text, /The plan is short\./);
  assert.deepEqual(events.at(-1), { type: "end" });
});

test("continues a file read from complete responses when streaming is disabled", async () => {
  const calls = [];
  const { events, onEvent } = collect();
  const fetchImpl = completionFetch(
    [completeReadCall("plan.md"), completeAnswer("The plan is short.")],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: { ...TOOLS_PROFILE, stream: false },
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "# Plan\n\nDo the thing." }),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[1].body.messages.at(-1).role, "tool");
  assert.match(events.filter((event) => event.type === "token").map((event) => event.text).join(""), /The plan is short\./);
  assert.deepEqual(events.at(-1), { type: "end" });
});

// The reason this is visible at all: a turn that pauses while a file is read should say so rather
// than look stuck.
test("says which file it is reading", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = scriptedFetch([
    [readCall("plan.md"), "data: [DONE]\n\n"],
    ["data: [DONE]\n\n"],
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "# Plan" }),
  });

  assert.deepEqual(events[0], { type: "tool", name: "get_file_contents", detail: "plan.md" });
});

// The panel lists every call a reply made. A call to anything but a read used to arrive with an
// empty detail, so the list could say a search happened but not what it searched for.
test("says what a folder tool was aimed at", async () => {
  const { events, onEvent } = collect();
  const searchCall = `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                name: "search_contents",
                arguments: JSON.stringify({ pattern: "TODO", path: "notes" }),
              },
            },
          ],
        },
      },
    ],
  })}\n\n`;
  const fetchImpl = scriptedFetch([
    [searchCall, "data: [DONE]\n\n"],
    ["data: [DONE]\n\n"],
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({}),
    callTool: async () => ({ content: "notes/a.md:1: TODO" }),
  });

  assert.deepEqual(
    events.filter((e) => e.type === "tool"),
    [{ type: "tool", name: "search_contents", detail: "TODO in notes" }],
  );
});

/// A read held to the model's budget - the same one attachments get - and marked when it is cut.
///
/// Reads used to send the whole file whatever its size: the 20,000-character limit written for them
/// was never applied.
test("cuts a file the model reads to its budget, tells the model, and reports the cut", async () => {
  const calls = [];
  const { events, onEvent } = collect();
  // An 1,000-token window: nine tenths at four characters each is a budget of 3,600 characters.
  const profile = { ...TOOLS_PROFILE, contextWindow: 1_000 };
  const content = `${"x".repeat(5_000)}END`;
  const fetchImpl = scriptedFetch(
    [
      [readCall("plan.md"), "data: [DONE]\n\n"],
      [says("Read it."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile,
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": content }),
  });

  const result = calls[1].body.messages.at(-1);
  assert.equal(result.role, "tool");
  assert.ok(result.content.startsWith("x".repeat(3_600)));
  assert.ok(!result.content.includes("END"), "the part past the budget must not be sent");
  assert.match(result.content, /only the first 3600 of its 5003 characters/i);

  // After the call it belongs to, so the panel can mark that call.
  const at = events.findIndex((event) => event.type === "tool");
  assert.deepEqual(events[at + 1], { type: "tool-cut", sent: 3_600, total: 5_003 });
});

test("sends a file within the budget whole, with no cut reported", async () => {
  const calls = [];
  const { events, onEvent } = collect();
  const fetchImpl = scriptedFetch(
    [
      [readCall("plan.md"), "data: [DONE]\n\n"],
      [says("Read it."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: { ...TOOLS_PROFILE, contextWindow: 262_000 },
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "x".repeat(100_000) }),
  });

  assert.equal(calls[1].body.messages.at(-1).content, "x".repeat(100_000));
  assert.equal(events.some((event) => event.type === "tool-cut"), false);
});

// A model nobody has sized gets the fixed budget attachments get, rather than any file at all.
test("holds a model with no window to the fixed budget", async () => {
  const calls = [];
  const { events, onEvent } = collect();
  const fetchImpl = scriptedFetch(
    [
      [readCall("plan.md"), "data: [DONE]\n\n"],
      [says("Read it."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "x".repeat(60_001) }),
  });

  assert.deepEqual(events.find((event) => event.type === "tool-cut"), {
    type: "tool-cut",
    sent: 60_000,
    total: 60_001,
  });
});

/// The allowlist. A path the outline never named must not reach the filesystem.
test("refuses a file that was never offered, and tells the model why", async () => {
  const calls = [];
  const asked = [];
  const fetchImpl = scriptedFetch(
    [
      [readCall("../../../etc/passwd"), "data: [DONE]\n\n"],
      ["data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent: () => {},
    readFile: async (path) => {
      asked.push(path);
      return { ok: false, reason: "not-allowed" };
    },
  });

  // The path reached the allowlist and was refused there - it never became a file read.
  assert.deepEqual(asked, ["../../../etc/passwd"]);

  const result = calls[1].body.messages.at(-1);
  assert.equal(result.role, "tool");
  assert.match(result.content, /cannot be read|only the files listed/i);
});

// A refusal is not the end of the turn: the model can pick a different file, or answer without one.
test("carries on after a refusal", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = scriptedFetch([
    [readCall("secrets.md"), "data: [DONE]\n\n"],
    [says("I could not read that."), "data: [DONE]\n\n"],
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({}),
  });

  const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.match(text, /I could not read that\./);
});

/// The bound that keeps a bill finite. A model that decides to read every file it was offered would
/// otherwise send the whole conversation again for each one, without limit.
test("stops asking after a fixed number of reads", async () => {
  const calls = [];
  // A model that asks for a file every single time.
  const fetchImpl = scriptedFetch([[readCall("plan.md"), "data: [DONE]\n\n"]], { calls });

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent: () => {},
    readFile: allowlist({ "plan.md": "# Plan" }),
  });

  // Ten rounds of reading, plus the one final request that is told to stop.
  assert.equal(calls.length, 11);

  const last = calls.at(-1).body;
  assert.match(last.messages.at(-1).content, /No more files can be read/);
  // The tool is withdrawn on that last request, so the model cannot ask again.
  assert.equal("tools" in last && last.tools.some((t) => t.function.name === "get_file_contents"), false);
});

// The loop's own messages are for one request. Letting them into the conversation would put tool
// plumbing into a saved chat and resend it as history for ever.
test("keeps the tool messages out of the conversation it was given", async () => {
  const turns = [{ role: "user", content: "Hello" }];
  const fetchImpl = scriptedFetch([
    [readCall("plan.md"), "data: [DONE]\n\n"],
    ["data: [DONE]\n\n"],
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns,
    onEvent: () => {},
    readFile: allowlist({ "plan.md": "# Plan" }),
  });

  assert.deepEqual(turns, [{ role: "user", content: "Hello" }]);
});

test("a proposed edit still arrives when a read happened first", async () => {
  const { events, onEvent } = collect();
  const editFrame = `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                name: "propose_edit",
                arguments: JSON.stringify({ op: "append", heading: "", content: "## Summary" }),
              },
            },
          ],
        },
      },
    ],
  })}\n\n`;

  const fetchImpl = scriptedFetch([
    [readCall("plan.md"), "data: [DONE]\n\n"],
    [editFrame, "data: [DONE]\n\n"],
  ]);

  await provider(fetchImpl).run({
    profile: TOOLS_PROFILE,
    turns: TURNS,
    onEvent,
    readFile: allowlist({ "plan.md": "# Plan" }),
  });

  const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.match(text, /trypthos-edit append/);
});

/// Reading a file without provider tool calling.
///
/// The folder outline is a menu, and an endpoint with no tool calling could not order from it: the
/// model was handed a list of paths and no way to ask for one. It now writes a fenced block, and
/// this carries it out and hands the contents back.
///
/// What may be read is decided by `readFile` exactly as it is for the tool. This changes how a
/// request is written, never what it can reach.
const READ_BLOCK = ["```trypthos-read", "notes/plan.md", "```"].join("\n");

/// A fetch that answers differently each call, so a loop can be watched going round.
function roundsFetch(rounds, { calls = [] } = {}) {
  let at = 0;
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const frames = rounds[Math.min(at, rounds.length - 1)];
    at += 1;
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          const queue = [...frames];
          return {
            read: async () =>
              queue.length === 0
                ? { done: true, value: undefined }
                : { done: false, value: new TextEncoder().encode(queue.shift()) },
          };
        },
      },
    };
  };
}

const say = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test("serves a file the model asked for in a fenced block", async () => {
  const { events, onEvent } = collect();
  const calls = [];
  const fetchImpl = roundsFetch(
    [
      [say(READ_BLOCK), "data: [DONE]\n\n"],
      [say("The plan says hello."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: PROFILE,
    turns: TURNS,
    onEvent,
    readFile: async (path) => ({ ok: true, content: `# Plan for ${path}` }),
  });

  // The same event the tool path emits, so the panel's line of files reads the same either way.
  assert.deepEqual(
    events.filter((e) => e.type === "tool"),
    [{ type: "tool", name: "get_file_contents", detail: "notes/plan.md" }],
  );

  // The request that streamed was not an answer, so the panel is told to drop it.
  assert.ok(
    events.some((e) => e.type === "reset"),
    "expected the partial reply to be discarded",
  );

  assert.deepEqual(events.at(-2), { type: "token", text: "The plan says hello." });
  assert.deepEqual(events.at(-1), { type: "end" });

  // The file went back as an ordinary message: this transport exists because there is no tool role.
  const second = calls[1].body.messages;
  assert.equal(second.at(-1).role, "user");
  assert.ok(second.at(-1).content.includes("# Plan for notes/plan.md"));
});

// The same budget however the model asked: a fenced read is the same read.
test("cuts a file asked for in a fenced block to the same budget", async () => {
  const { events, onEvent } = collect();
  const calls = [];
  const fetchImpl = roundsFetch(
    [
      [say(READ_BLOCK), "data: [DONE]\n\n"],
      [say("Read it."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: { ...PROFILE, contextWindow: 1_000 },
    turns: TURNS,
    onEvent,
    readFile: async () => ({ ok: true, content: `${"x".repeat(5_000)}END` }),
  });

  const sent = calls[1].body.messages.at(-1).content;
  assert.ok(!sent.includes("END"));
  assert.match(sent, /only the first 3600 of its 5003 characters/i);
  assert.deepEqual(events.find((e) => e.type === "tool-cut"), {
    type: "tool-cut",
    sent: 3_600,
    total: 5_003,
  });
});

test("tells the model when the file it asked for cannot be read", async () => {
  const { onEvent } = collect();
  const calls = [];
  const fetchImpl = roundsFetch(
    [
      [say(READ_BLOCK), "data: [DONE]\n\n"],
      [say("I could not read it."), "data: [DONE]\n\n"],
    ],
    { calls },
  );

  await provider(fetchImpl).run({
    profile: PROFILE,
    turns: TURNS,
    onEvent,
    readFile: async () => ({ ok: false, reason: "not-allowed" }),
  });

  const second = calls[1].body.messages;
  assert.match(second.at(-1).content, /cannot be read/i);
});

// Without a folder there is nothing to read from, so a block is just text the model wrote.
test("ignores a fenced request when no folder was sent", async () => {
  const { events, onEvent } = collect();
  const fetchImpl = roundsFetch([[say(READ_BLOCK), "data: [DONE]\n\n"]]);

  await provider(fetchImpl).run({ profile: PROFILE, turns: TURNS, onEvent, readFile: null });

  assert.ok(!events.some((e) => e.type === "reset"), "expected no reset");
  assert.deepEqual(events.at(-1), { type: "end" });
});

// An unbounded loop is an unbounded bill. The cap is told to the model in the shape it has been
// speaking - an ordinary message, since this endpoint never sent a tool call.
test("stops after the read cap, and says so in a message the model understands", async () => {
  const { events, onEvent } = collect();
  const calls = [];
  const fetchImpl = roundsFetch([[say(READ_BLOCK), "data: [DONE]\n\n"]], { calls });

  await provider(fetchImpl).run({
    profile: PROFILE,
    turns: TURNS,
    onEvent,
    readFile: async () => ({ ok: true, content: "x" }),
  });

  const last = calls.at(-1).body.messages.at(-1);
  assert.equal(last.role, "user");
  assert.match(last.content, /no more files/i);
  assert.deepEqual(events.at(-1), { type: "end" });
});

/// The trace of each request, for the conversation log.
///
/// What a user checks when the panel shows no answer but the endpoint reported tokens - so it has to
/// be what was actually sent and received, not what the panel made of it. And it crosses into the
/// renderer, so the key must be as absent from it as from any error.
describe("the trace of each request", () => {
  /// Runs a turn, recording events and traces in the order they happened.
  async function traced(fetchImpl, options = {}) {
    const order = [];
    const traces = [];
    await provider(fetchImpl, options.provider).run({
      profile: options.profile ?? PROFILE,
      turns: TURNS,
      readFile: options.readFile,
      onEvent: (event) => order.push(event.type),
      onTrace: (trace) => {
        traces.push(trace);
        order.push("trace");
      },
    });
    return { traces, order };
  }

  it("records the request, the status and the stream exactly as it arrived", async () => {
    const frames = [
      'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":900}}\n\n',
      "data: [DONE]\n\n",
    ];
    const { traces } = await traced(streamingFetch(frames));

    assert.equal(traces.length, 1);
    const [trace] = traces;
    assert.equal(trace.round, 0);
    assert.equal(trace.url, "https://api.example.com/v1/chat/completions");
    assert.equal(JSON.parse(trace.request).model, "some-model");
    assert.equal(trace.status, 200);
    assert.equal(trace.response, frames.join(""));
    assert.deepEqual(trace.notes, []);
  });

  it("arrives before the turn ends, so the panel is still listening", async () => {
    const { order } = await traced(
      streamingFetch(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', "data: [DONE]\n\n"]),
    );
    assert.deepEqual(order, ["token", "trace", "end"]);
  });

  it("records every request of a turn that reads a file, in order", async () => {
    const fetchImpl = scriptedFetch([
      [readCall("plan.md"), "data: [DONE]\n\n"],
      [says("The plan is short."), "data: [DONE]\n\n"],
    ]);
    const { traces, order } = await traced(fetchImpl, {
      profile: TOOLS_PROFILE,
      readFile: allowlist({ "plan.md": "# Plan" }),
    });

    assert.deepEqual(traces.map((trace) => trace.round), [0, 1]);
    // The second request carries the file the first asked for.
    assert.match(traces[1].request, /# Plan/);
    assert.equal(order.at(-1), "end");
    assert.equal(order.at(-2), "trace");
  });

  it("records a completed response when streaming is off", async () => {
    const { traces } = await traced(completionFetch([completeAnswer("Whole.")]), {
      profile: { ...PROFILE, stream: false },
    });
    assert.match(traces[0].response, /Whole\./);
  });

  // The body of a refusal is what says WHY - an unsupported parameter, a missing model - and it is
  // exactly the text a provider may echo the key back in.
  it("records what a refusal said, without the key", async () => {
    const { traces } = await traced(
      streamingFetch([`{"error":{"message":"bad key ${KEY} for stream_options"}}`], { status: 400 }),
    );

    assert.equal(traces[0].status, 400);
    assert.match(traces[0].response, /stream_options/);
    assert.ok(!traces[0].response.includes(KEY));
  });

  it("never carries the key, wherever the endpoint puts it", async () => {
    const { traces } = await traced(
      streamingFetch([`data: {"choices":[{"delta":{"content":"${KEY}"}}]}\n\n`, "data: [DONE]\n\n"]),
    );

    assert.ok(!JSON.stringify(traces).includes(KEY));
    assert.match(traces[0].response, /\[key removed\]/);
  });

  it("records a request that never reached the endpoint", async () => {
    const { traces, order } = await traced(async () => {
      throw new Error("ECONNREFUSED");
    });

    assert.equal(traces[0].status, null);
    assert.equal(traces[0].response, "");
    assert.deepEqual(order, ["error", "trace", "end"]);
  });

  // A dropped call is invisible in the panel and in the stream alike: the fragments are there, but
  // nothing says they were thrown away.
  it("notes a tool call it dropped", async () => {
    const { traces } = await traced(streamingFetch(toolFrames(['{"op":"append","cont'])), {
      profile: TOOLS_PROFILE,
    });
    assert.equal(traces[0].notes.length, 1);
    assert.match(traces[0].notes[0], /dropped/);
  });

  it("notes a reply that was a request for a file, and was cleared", async () => {
    const fetchImpl = scriptedFetch([
      [says("```trypthos-read\nplan.md\n```"), "data: [DONE]\n\n"],
      [says("Read it."), "data: [DONE]\n\n"],
    ]);
    const { traces } = await traced(fetchImpl, { readFile: allowlist({ "plan.md": "# Plan" }) });
    assert.match(traces[0].notes.join("\n"), /cleared/);
  });

  it("cuts a response too long to carry, and says so", async () => {
    const huge = `data: {"choices":[{"delta":{"content":"${"a".repeat(TRACE_TEXT_LIMIT)}"}}]}\n\n`;
    const { traces } = await traced(streamingFetch([huge, "data: [DONE]\n\n"]));

    assert.ok(traces[0].response.length < TRACE_TEXT_LIMIT + 200);
    assert.match(traces[0].response, /characters not shown/);
  });

  it("works without anybody listening for traces", async () => {
    const { events, onEvent } = collect();
    await provider(streamingFetch(["data: [DONE]\n\n"])).run({ profile: PROFILE, turns: TURNS, onEvent });
    assert.deepEqual(events, [{ type: "end" }]);
  });
});
