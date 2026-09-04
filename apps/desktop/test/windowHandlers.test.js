"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerWindowHandlers } = require("../src/windowHandlers");

/// The window controls, and the document channels that sit beside them.
///
/// Every handler here validates its argument in the main process. The renderer having already
/// checked is not a check: it is the untrusted side, and these run with the shell's own authority.

function harness(over = {}) {
  const handlers = new Map();
  const calls = [];
  const window = {
    isDestroyed: () => false,
    minimize: () => calls.push("minimize"),
    isMaximized: () => false,
    maximize: () => calls.push("maximize"),
    unmaximize: () => calls.push("unmaximize"),
    close: () => calls.push("close"),
  };
  const guard = {
    setDirty: (value) => calls.push(`dirty:${value}`),
    allow: () => calls.push("allow"),
    ask: async () => over.choice ?? "cancel",
  };

  registerWindowHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getWindow: () => (over.noWindow === true ? null : window),
    guard,
  });

  const invoke = (channel, payload) => handlers.get(channel)({}, payload);
  return { invoke, calls, handlers };
}

test("closes the window", async () => {
  const { invoke, calls } = harness();

  await invoke("window:close", {});
  assert.deepEqual(calls, ["close"]);
});

// The renderer forces a close only after it has asked about unsaved work. Telling the guard first is
// what stops the shell asking a second time and the window never closing at all.
test("a forced close tells the guard before it closes", async () => {
  const { invoke, calls } = harness();

  await invoke("window:close", { force: true });
  assert.deepEqual(calls, ["allow", "close"]);
});

// The default matters: an ordinary close must not be able to skip the guard by omitting the flag.
test("a close with no flag does not force anything", async () => {
  const { invoke, calls } = harness();

  await invoke("window:close", undefined);
  assert.deepEqual(calls, ["close"]);
});

test("refuses a close whose argument is not the shape it expects", async () => {
  const { invoke, calls } = harness();

  const result = await invoke("window:close", { force: "yes" });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test("passes the dirty flag to the guard", async () => {
  const { invoke, calls } = harness();

  await invoke("document:dirty", { dirty: true });
  assert.deepEqual(calls, ["dirty:true"]);
});

test("refuses a dirty flag that is not a boolean", async () => {
  const { invoke, calls } = harness();

  const result = await invoke("document:dirty", { dirty: "sort of" });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test("answers the discard prompt with what the user chose", async () => {
  const { invoke } = harness({ choice: "discard" });

  assert.deepEqual(await invoke("document:confirmDiscard"), { ok: true, choice: "discard" });
});

// The window can be gone between a click and its handler - during shutdown, or after a crash.
test("says so rather than throwing when there is no window left", async () => {
  const { invoke } = harness({ noWindow: true });

  assert.deepEqual(await invoke("window:close", {}), { ok: false, reason: "no-window" });
});
