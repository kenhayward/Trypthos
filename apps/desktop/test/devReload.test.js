"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nextRetryDelayMs, shouldRetryLoad } = require("../src/devReload");

test("retries quickly at first", () => {
  assert.equal(nextRetryDelayMs(0, {}), 250);
  assert.equal(nextRetryDelayMs(3, {}), 250);
});

test("backs off as attempts mount", () => {
  assert.equal(nextRetryDelayMs(4, {}), 500);
  assert.equal(nextRetryDelayMs(8, {}), 1000);
});

test("caps the delay so a long wait never becomes an unbounded one", () => {
  assert.equal(nextRetryDelayMs(30, {}), 2000);
  assert.equal(nextRetryDelayMs(39, {}), 2000);
});

test("gives up eventually, rather than retrying for ever", () => {
  assert.equal(nextRetryDelayMs(40, {}), null);
  assert.equal(nextRetryDelayMs(100, {}), null);
});

test("honours an overridden schedule", () => {
  assert.equal(nextRetryDelayMs(0, { baseMs: 10 }), 10);
  assert.equal(nextRetryDelayMs(2, { maxAttempts: 2 }), null);
  assert.equal(nextRetryDelayMs(8, { baseMs: 1000, maxMs: 1500 }), 1500);
});

/// Whether a failed load should reload the window.
///
/// The retry exists for one thing: in development the shell and the Vite server start together and
/// the shell routinely wins the race. It was armed for the life of the window, so ANY later
/// `did-fail-load` reloaded a running app - discarding the renderer's entire state: open tabs,
/// **unsaved documents**, and whatever dialog the user was in the middle of.
///
/// That is a data-loss bug in its own right, and it is indistinguishable from the app "closing a
/// dialog by itself": the window blanks for a moment and comes back with everything reset and
/// nothing to say about why.
test("retries a first load that failed, in either mode", () => {
  assert.equal(shouldRetryLoad({ isMainFrame: true, hasLoaded: false, isDev: true }), true);
  assert.equal(shouldRetryLoad({ isMainFrame: true, hasLoaded: false, isDev: false }), true);
});

// The dev server being restarted while the shell stays open is a reload the developer wants, and
// nothing is lost that a dev server restart would not lose anyway.
test("reloads a running app in development, where a restarted dev server is expected", () => {
  assert.equal(shouldRetryLoad({ isMainFrame: true, hasLoaded: true, isDev: true }), true);
});

/// The one that matters.
///
/// A packaged app that has already loaded must never reload itself. Whatever the failure was, it
/// cannot be worth throwing away the user's unsaved work to retry - and there is no dev server here
/// whose restart it could be tracking.
test("never reloads a running packaged app", () => {
  assert.equal(shouldRetryLoad({ isMainFrame: true, hasLoaded: true, isDev: false }), false);
});

// `did-fail-load` fires for subframes too, and a subframe that failed is not a reason to reload the
// document around it.
test("ignores a failure that is not the main frame", () => {
  assert.equal(shouldRetryLoad({ isMainFrame: false, hasLoaded: false, isDev: true }), false);
  assert.equal(shouldRetryLoad({ isMainFrame: false, hasLoaded: true, isDev: false }), false);
});
