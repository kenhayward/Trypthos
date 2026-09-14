"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDocumentHandoff } = require("../src/documentHandoff");

/// Moving a tab with unsaved work into its own window.
///
/// The main window closes the tab only once this says the new window HAS the text. Everything here
/// is about the ways that can fail to happen - the window never loading, closing first, taking too
/// long - because each of those must leave the tab open rather than the work nowhere.

const draft = { content: "# Plan\n\nhalf written", revision: { id: "rev-1" } };

/// A timer the test drives, so a timeout is a step rather than a wait.
function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    fireAll: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    count: () => pending.size,
  };
}

test("the window that was opened with a draft receives it", () => {
  const handoff = createDocumentHandoff({ timers: manualTimers() });
  void handoff.hold(7, draft);

  assert.deepEqual(handoff.take(7), draft);
});

test("reports success once the new window has taken the draft", async () => {
  const handoff = createDocumentHandoff({ timers: manualTimers() });
  const held = handoff.hold(7, draft);

  handoff.take(7);
  assert.deepEqual(await held, { ok: true });
});

// Taken once. A reload of the new window must not paste the same text in again over whatever the
// user has typed since - it opens the file like any other window would.
test("gives a draft to its window once", () => {
  const handoff = createDocumentHandoff({ timers: manualTimers() });
  void handoff.hold(7, draft);

  handoff.take(7);
  assert.equal(handoff.take(7), null);
});

// Another renderer asking is not the window the text was meant for.
test("gives nothing to a window it was not held for", () => {
  const handoff = createDocumentHandoff({ timers: manualTimers() });
  void handoff.hold(7, draft);

  assert.equal(handoff.take(8), null);
  assert.deepEqual(handoff.take(7), draft);
});

// The window crashed, failed to load, or was closed before its page asked. The tab must stay open.
test("reports failure when the window goes before taking the draft", async () => {
  const handoff = createDocumentHandoff({ timers: manualTimers() });
  const held = handoff.hold(7, draft);

  handoff.abandon(7);
  assert.deepEqual(await held, { ok: false, reason: "window-failed" });
  assert.equal(handoff.take(7), null, "an abandoned draft must not be handed out later");
});

test("reports failure when the window never asks", async () => {
  const timers = manualTimers();
  const handoff = createDocumentHandoff({ timers });
  const held = handoff.hold(7, draft);

  timers.fireAll();
  assert.deepEqual(await held, { ok: false, reason: "window-failed" });
  assert.equal(handoff.take(7), null);
});

test("stops waiting once the draft has been taken", async () => {
  const timers = manualTimers();
  const handoff = createDocumentHandoff({ timers });
  const held = handoff.hold(7, draft);

  handoff.take(7);
  assert.equal(timers.count(), 0);
  // Abandoning a window that already took its draft changes nothing about the answer.
  handoff.abandon(7);
  assert.deepEqual(await held, { ok: true });
});
