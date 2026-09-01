"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ListRequest, WriteRequest } = require("@trypthos/domain");
const { guarded } = require("../src/ipcHandlers");

/// `guarded` is where an untrusted payload stops. These tests drive it directly rather than through
/// Electron, because what matters is the ordering: refusal must happen BEFORE the handler runs, so a
/// malformed request never reaches the filesystem at all.

const workspace = { root: "/ws" };
const open = () => workspace;
const none = () => null;

function spyHandler() {
  const calls = [];
  const handler = async (request) => {
    calls.push(request);
    return { ok: true };
  };
  return { calls, handler };
}

test("passes a valid payload through to the handler", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(open, ListRequest, handler)(null, { path: "notes" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ path: "notes" }]);
});

test("refuses a malformed payload without calling the handler", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(open, ListRequest, handler)(null, { path: 42 });

  assert.deepEqual(result, { ok: false, reason: "bad-request" });
  assert.equal(calls.length, 0, "the handler must not run for a rejected payload");
});

test("refuses a payload carrying unexpected fields", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(open, ListRequest, handler)(null, { path: "notes", root: "/etc" });

  assert.deepEqual(result, { ok: false, reason: "bad-request" });
  assert.equal(calls.length, 0);
});

test("refuses a write that omits the revision entirely", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(open, WriteRequest, handler)(null, { path: "a.md", content: "x" });

  assert.deepEqual(result, { ok: false, reason: "bad-request" });
  assert.equal(calls.length, 0, "a write with no stated revision must never reach the filesystem");
});

test("refuses a valid request when no workspace is open", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(none, ListRequest, handler)(null, { path: "notes" });

  // The state a freshly launched app is in. A renderer asking anyway gets nothing.
  assert.deepEqual(result, { ok: false, reason: "no-workspace" });
  assert.equal(calls.length, 0);
});

// Ordering, stated as its own test because it is the reason guarded takes getWorkspace as an
// argument. A malformed payload is a protocol error whatever the app is doing; reporting it as
// "no workspace" would send whoever is debugging it looking in the wrong place entirely.
test("reports a malformed payload as such even with no workspace open", async () => {
  const { handler } = spyHandler();
  const result = await guarded(none, ListRequest, handler)(null, { path: 42 });

  assert.deepEqual(result, { ok: false, reason: "bad-request" });
});

test("does not throw when the payload is not an object at all", async () => {
  const { handler } = spyHandler();
  for (const payload of [null, undefined, "string", 7, []]) {
    const result = await guarded(open, ListRequest, handler)(null, payload);
    assert.equal(result.ok, false);
  }
});
