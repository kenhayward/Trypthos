"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CLOSE_REQUESTED_CHANNEL } = require("@trypthos/domain");
const { createCloseGuard } = require("../src/closeGuard");

/// The shell's half of "do not throw away somebody's writing".
///
/// The dirty flag lives in the renderer, which owns the document; the close event lives here. So the
/// shell keeps a copy of the flag for one purpose only - to know whether a close needs asking about
/// at all - and hands the decision itself back to the renderer, which is the side that can save.

const guard = (over = {}) => {
  const sent = [];
  const shown = [];
  const dialog = {
    showMessageBox: async (options) => {
      shown.push(options);
      return { response: over.response ?? 0 };
    },
  };
  const created = createCloseGuard({
    dialog,
    send: (channel, payload) => sent.push({ channel, payload }),
  });
  return { guard: created, sent, shown };
};

// Not a native prompt from here: the renderer owns the document, and only it can save. The shell
// asks it, and the renderer answers by closing the window itself.
test("asks the renderer rather than deciding for it", () => {
  const { guard: g, sent } = guard();

  g.requestClose();
  assert.deepEqual(sent, [{ channel: CLOSE_REQUESTED_CHANNEL, payload: {} }]);
});

test("tracks the flag the renderer reports", () => {
  const { guard: g } = guard();
  assert.equal(g.isDirty(), false);

  g.setDirty(true);
  assert.equal(g.isDirty(), true);

  // The document can be saved between the flag going up and a close being attempted, and then there
  // is nothing left to ask about.
  g.setDirty(false);
  assert.equal(g.isDirty(), false);
});

// Anything that is not exactly true is not dirty: a renderer sending something odd must not make the
// window unclosable.
test("treats anything but true as clean", () => {
  const { guard: g } = guard();
  g.setDirty("yes");

  assert.equal(g.isDirty(), false);
});

test("the prompt offers save, discard and cancel", async () => {
  const { guard: g, shown } = guard({ response: 0 });

  assert.equal(await g.ask(), "save");
  assert.equal(shown[0].buttons.length, 3);
  assert.equal(shown[0].type, "warning");
  // The safe answer is the default, and Escape has to mean cancel rather than "discard my work".
  assert.equal(shown[0].defaultId, 0);
  assert.equal(shown[0].cancelId, 2);
});

// With tabs, several documents can have unsaved work at once, so a prompt that says "this document"
// asks about writing the user cannot identify. Named, it is answerable.
test("the prompt names the document it is about", async () => {
  const { guard: g, shown } = guard({ response: 0 });

  await g.ask("notes.md");
  assert.match(shown[0].message, /notes\.md/);
});

// The window closing is about the window, not about any one file, and the first release of this
// prompt had no name to give. Both must still read as a sentence.
test("asks about the document in general when it has no name", async () => {
  const { guard: g, shown } = guard({ response: 0 });

  await g.ask();
  assert.match(shown[0].message, /document/);
  assert.doesNotMatch(shown[0].message, /undefined|null/);
});

// A file name is renderer input, and it lands in a native dialog. Nothing here interprets it, but a
// name long enough to push the buttons off the screen is a dialog nobody can answer.
test("cuts a preposterous name down to something a dialog can show", async () => {
  const { guard: g, shown } = guard({ response: 0 });

  await g.ask("x".repeat(500));
  assert.ok(shown[0].message.length < 200);
});

test("maps each button to what it means", async () => {
  for (const [response, choice] of [
    [0, "save"],
    [1, "discard"],
    [2, "cancel"],
  ]) {
    const { guard: g } = guard({ response });
    assert.equal(await g.ask(), choice);
  }
});

// A dialog that was dismissed in some way this build does not know about must not read as "throw it
// away". Anything unrecognised is a cancel.
test("an answer it does not recognise is a cancel", async () => {
  const { guard: g } = guard({ response: 7 });
  assert.equal(await g.ask(), "cancel");
});

/// What a close attempt should actually do.
///
/// Three policies meet on one event - a forced close the renderer already decided, close-to-tray,
/// and unsaved work - and the order between them is the whole difference between "asks twice" and
/// "loses the file". Pure, so the order is stated once and tested rather than read off main.js.
const { closeDecision } = require("../src/closeGuard");

test("an ordinary close on a saved document closes", () => {
  assert.equal(closeDecision({ forced: false, hiding: false, dirty: false }), "close");
});

test("unsaved work is asked about", () => {
  assert.equal(closeDecision({ forced: false, hiding: false, dirty: true }), "ask");
});

// Close-to-tray does not close anything: the window hides and the document is still there, so a
// prompt would be asking about work that is in no danger at all.
test("hiding to the tray never asks, however dirty the document is", () => {
  assert.equal(closeDecision({ forced: false, hiding: true, dirty: true }), "hide");
});

// The renderer forces a close only after asking. Neither the guard nor the tray may interrupt it -
// hiding the window here would be the app quietly ignoring "discard and close".
test("a forced close beats both the tray and the guard", () => {
  assert.equal(closeDecision({ forced: true, hiding: true, dirty: true }), "close");
});

test("reports whether a close has already been decided", () => {
  const { guard: g } = guard();
  assert.equal(g.forced(), false);

  g.allow();
  assert.equal(g.forced(), true);
});
