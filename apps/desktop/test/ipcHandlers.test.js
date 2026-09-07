"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ListRequest, WriteRequest } = require("@trypthos/domain");
const { guarded } = require("../src/ipcHandlers");

/// `guarded` is where an untrusted payload stops. These tests drive it directly rather than through
/// Electron, because what matters is the ordering: refusal must happen BEFORE the handler runs, so a
/// malformed request never reaches the filesystem at all.

const workspace = { root: "/ws" };

/// The locator `guarded` takes: it is handed the PARSED request and answers which workspace it is
/// about, together with the path within that workspace. Several folders are open at once, so which
/// one a request is for is part of the request rather than part of the app's state.
const open = (request) => ({ workspace, path: request.path });
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

test("refuses a valid request when it names no workspace that is open", async () => {
  const { calls, handler } = spyHandler();
  const result = await guarded(none, ListRequest, handler)(null, { path: "notes" });

  // A freshly launched app, and equally a renderer naming a folder that has since been closed.
  // Either way it gets nothing.
  assert.deepEqual(result, { ok: false, reason: "no-workspace" });
  assert.equal(calls.length, 0);
});

/// The handler is given the path WITHIN the workspace, never the qualified one it arrived as.
///
/// That is what keeps every handler below unchanged by there being several workspaces: they still
/// take a workspace-relative path and hand it to a provider, which applies the boundary guard to it.
/// A handler that saw the qualified path would be a second place that had to know how to split one.
test("hands the handler the path inside the workspace it resolved", async () => {
  const { calls, handler } = spyHandler();
  const locate = (request) => ({ workspace, path: request.path.replace("Notes/", "") });

  const result = await guarded(locate, ListRequest, handler)(null, { path: "Notes/docs" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ path: "docs" }]);
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
