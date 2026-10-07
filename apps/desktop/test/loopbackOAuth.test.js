"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { listenOnce, pkcePair } = require("../src/loopbackOAuth");

// Microsoft's registration names http://localhost, Google's flow uses 127.0.0.1. The socket is
// 127.0.0.1 either way - only the address the provider is told changes.
test("names the redirect by the host asked for, while listening on 127.0.0.1", async () => {
  const listener = await listenOnce({ redirectHost: "localhost" });
  try {
    const port = new URL(listener.redirectUri).port;
    assert.match(listener.redirectUri, /^http:\/\/localhost:\d+$/);
    const response = await fetch(`http://127.0.0.1:${port}/?code=c&state=s`);
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(new URL(await listener.arrived).searchParams.get("code"), "c");
  } finally {
    listener.close();
  }
});

test("defaults the redirect host to 127.0.0.1", async () => {
  const listener = await listenOnce();
  try {
    assert.match(listener.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    listener.close();
  }
});

test("ignores requests that are not for /, such as a favicon", async () => {
  const listener = await listenOnce();
  try {
    const port = new URL(listener.redirectUri).port;
    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    assert.equal(favicon.status, 404);
    await favicon.text();
    const answer = await fetch(`http://127.0.0.1:${port}/?code=c2`);
    await answer.text();
    assert.equal(new URL(await listener.arrived).searchParams.get("code"), "c2");
  } finally {
    listener.close();
  }
});

test("makes a verifier, its S256 challenge, and a state", () => {
  const bytes = (n) => Buffer.alloc(n, 7);
  const { verifier, challenge, state } = pkcePair(bytes);
  assert.equal(verifier, bytes(32).toString("base64url"));
  assert.equal(challenge, nodeCrypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(state, bytes(16).toString("base64url"));
});
