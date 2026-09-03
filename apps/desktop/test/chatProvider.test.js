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
