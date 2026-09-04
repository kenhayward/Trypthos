"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { revealWindow } = require("../src/revealWindow");

/// Bringing the window back: the one routine behind the tray click, the tray's "Show Trypthos" item
/// and the second-instance handler.
///
/// The bug this guards against: with close-to-tray on, the window is hidden rather than closed, and
/// launching the app again reached a handler that restored a MINIMISED window but never showed a
/// HIDDEN one - so a second launch did nothing visible at all, and the only way back was the tray.

function fakeWindow({ visible = true, minimized = false, destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    restore: () => {
      calls.push("restore");
      minimized = false;
    },
    show: () => {
      calls.push("show");
      visible = true;
    },
    focus: () => calls.push("focus"),
  };
}

test("a window hidden to the tray is shown, then focused", () => {
  const window = fakeWindow({ visible: false });
  assert.equal(revealWindow(window), true);
  assert.deepEqual(window.calls, ["show", "focus"]);
});

test("a minimised window is restored before it is focused", () => {
  const window = fakeWindow({ minimized: true });
  revealWindow(window);
  assert.ok(window.calls.includes("restore"), "restore must be called");
  assert.equal(window.calls.at(-1), "focus", "focus comes last");
});

test("a window that is both hidden and minimised is restored and shown", () => {
  const window = fakeWindow({ visible: false, minimized: true });
  revealWindow(window);
  assert.ok(window.calls.includes("restore"));
  assert.ok(window.calls.includes("show"));
  assert.equal(window.calls.at(-1), "focus");
});

test("a visible, unminimised window is only focused", () => {
  const window = fakeWindow();
  revealWindow(window);
  assert.deepEqual(window.calls, ["focus"]);
});

test("no window, or a destroyed one, is reported rather than thrown at", () => {
  assert.equal(revealWindow(null), false);
  assert.equal(revealWindow(undefined), false);
  const gone = fakeWindow({ destroyed: true });
  assert.equal(revealWindow(gone), false);
  assert.deepEqual(gone.calls, []);
});
