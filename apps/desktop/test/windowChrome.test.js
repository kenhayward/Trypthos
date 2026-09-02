"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { chromeOptionsFor } = require("../src/windowChrome");

test("Windows and Linux get a fully frameless window", () => {
  assert.equal(chromeOptionsFor("win32").frame, false);
  assert.equal(chromeOptionsFor("linux").frame, false);
});

/// The failure this prevents is unrecoverable rather than untidy. `frame: false` on macOS removes the
/// traffic lights along with the rest of the chrome, and since the renderer does not draw controls
/// there, the result is a window with no way to close it from inside the app.
test("macOS keeps its traffic lights rather than going frameless", () => {
  const options = chromeOptionsFor("darwin");
  assert.equal(options.frame, undefined, "frame:false would remove the traffic lights too");
  assert.equal(options.titleBarStyle, "hiddenInset");
});

test("macOS insets the traffic lights to sit against the title bar", () => {
  const { trafficLightPosition } = chromeOptionsFor("darwin");
  assert.ok(trafficLightPosition.x > 0);
  assert.ok(trafficLightPosition.y > 0);
});

test("every platform ends up with exactly one set of controls", () => {
  // Windows draws its own and has no OS chrome; macOS draws none and keeps the OS lights.
  assert.equal(chromeOptionsFor("win32").titleBarStyle, undefined);
  assert.equal(chromeOptionsFor("darwin").frame, undefined);
});
