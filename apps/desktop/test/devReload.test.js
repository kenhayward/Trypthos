"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nextRetryDelayMs } = require("../src/devReload");

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
