"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { onWindowClosed } = require("../src/windowClosed");

/// A window as Electron behaves once it has closed: `webContents` is no longer there to read, and
/// reading it throws. A listener for "closed" that reaches for it crashes the main process on quit.
function fakeWindow(id) {
  const window = new EventEmitter();
  let destroyed = false;
  Object.defineProperty(window, "webContents", {
    get() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return { id };
    },
  });
  window.close = () => {
    destroyed = true;
    window.emit("closed");
  };
  return window;
}

test("hands the cleanup the contents id read before the window closed", () => {
  const window = fakeWindow(7);
  const seen = [];
  onWindowClosed(window, (contentsId) => seen.push(contentsId));

  window.close();
  assert.deepEqual(seen, [7]);
});

test("does nothing until the window closes", () => {
  const window = fakeWindow(7);
  const seen = [];
  onWindowClosed(window, (contentsId) => seen.push(contentsId));

  assert.deepEqual(seen, []);
});
