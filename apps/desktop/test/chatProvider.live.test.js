"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createChatProvider } = require("../src/chatProvider");

/// The same provider, against a real HTTP server.
///
/// Every other test here hands `createChatProvider` a fake `fetch`, which proves the logic agrees
/// with my idea of what a response looks like - and nothing about whether the real path works. This
/// exercises the genuine article: Node's `fetch`, a real `ReadableStream`, a real `TextDecoder`, and
/// bytes arriving in whatever pieces the socket delivers them in.
///
/// A local server, not a provider: no network, no key, no cost, and it runs in CI like anything else.

/// Serves SSE, writing each frame separately so the reads land where they land.
function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "",
  model: "some-model",
  supportsImages: false,
  isDefault: true,
};

const silent = { error: () => {}, warn: () => {} };

function provider(key = null) {
  return createChatProvider({ secrets: { getKey: async () => key }, logger: silent });
}

test("streams a reply from a real server, over a real socket", async () => {
  const received = [];
  const server = await serve((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":", world"}}]}\n\n');
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });

  try {
    const events = [];
    await provider("sk-test-do-not-use-90210").run({
      profile: { ...PROFILE, endpoint: server.endpoint },
      turns: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    assert.equal(received[0].url, "/v1/chat/completions");
    assert.equal(received[0].body.model, "some-model");
    assert.equal(received[0].body.stream, true);
    assert.equal(received[0].headers.authorization, "Bearer sk-test-do-not-use-90210");

    assert.deepEqual(events, [
      { type: "token", text: "Hello" },
      { type: "token", text: ", world" },
      { type: "end" },
    ]);
  } finally {
    await server.close();
  }
});

// The bug a fake reader cannot produce. A multi-byte character split across two socket reads decodes
// as two replacement characters unless the decoder is told the stream continues - so accented text
// arrives mangled from a provider that is behaving perfectly.
test("a reply with accented text survives being split across reads", async () => {
  const frame = Buffer.from('data: {"choices":[{"delta":{"content":"café naïve"}}]}\n\n', "utf8");
  const server = await serve((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      // Split mid-character: the two bytes of "é" land in different writes.
      const at = frame.indexOf(Buffer.from("é", "utf8")) + 1;
      response.write(frame.subarray(0, at));
      setTimeout(() => {
        response.write(frame.subarray(at));
        response.write("data: [DONE]\n\n");
        response.end();
      }, 10);
    });
  });

  try {
    const events = [];
    await provider().run({
      profile: { ...PROFILE, endpoint: server.endpoint },
      turns: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    const text = events
      .filter((event) => event.type === "token")
      .map((event) => event.text)
      .join("");
    assert.equal(text, "café naïve");
  } finally {
    await server.close();
  }
});

test("a real 401 becomes an error the user can act on", async () => {
  const server = await serve((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end('{"error":{"message":"Incorrect API key provided: sk-test-do-not-use-90210"}}');
    });
  });

  try {
    const events = [];
    await provider("sk-test-do-not-use-90210").run({
      profile: { ...PROFILE, endpoint: server.endpoint },
      turns: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events.at(-1), { type: "end" });
    assert.ok(events.some((event) => event.type === "error"));
    // The server echoed the key back in its body, which is exactly why the body is never forwarded.
    assert.ok(!JSON.stringify(events).includes("sk-test-do-not-use-90210"));
  } finally {
    await server.close();
  }
});

// A server that accepts the request and then simply stops. Without the end-of-stream fallback the
// panel would show a stop button for ever.
test("a server that closes mid-reply still ends the turn", async () => {
  const server = await serve((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"Cut off"}}]}\n\n');
      response.end();
    });
  });

  try {
    const events = [];
    await provider().run({
      profile: { ...PROFILE, endpoint: server.endpoint },
      turns: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(events, [{ type: "token", text: "Cut off" }, { type: "end" }]);
  } finally {
    await server.close();
  }
});

test("nothing is sent to a server that is not there", async () => {
  const events = [];
  // Port 1 is reserved and nothing listens on it, so this is a connection refusal rather than a wait.
  await provider().run({
    profile: { ...PROFILE, endpoint: "http://127.0.0.1:1/v1" },
    turns: [{ role: "user", content: "Hi" }],
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(events.at(-1), { type: "end" });
  assert.match(events.find((event) => event.type === "error").message, /could not be reached/i);
});
