"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRange } = require("../src/mediaRange");

/// Seeking a video IS a range request, so these numbers are the scrub bar.
///
/// Both ends of a byte range are INCLUSIVE, which is the off-by-one this module exists to get right
/// in one place: `bytes=0-0` is one byte, not zero.

test("no header means the whole file", () => {
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange("", 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

test("an open-ended range runs to the last byte", () => {
  assert.deepEqual(parseRange("bytes=0-", 1000), { start: 0, end: 999, length: 1000 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999, length: 500 });
});

test("both ends are inclusive", () => {
  assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199, length: 100 });
  assert.deepEqual(parseRange("bytes=0-0", 1000), { start: 0, end: 0, length: 1 });
});

// `bytes=-500` is the LAST 500 bytes, not the first 500. Reading it the other way serves the wrong
// part of the file, and from the player it looks as though nothing happened.
test("a suffix range is the last n bytes", () => {
  assert.deepEqual(parseRange("bytes=-500", 1000), { start: 500, end: 999, length: 500 });
});

test("a suffix larger than the file is the whole file", () => {
  assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999, length: 1000 });
});

test("an end past the file is clamped to the last byte", () => {
  assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999, length: 100 });
});

test("a start past the file cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=1000-", 1000), { unsatisfiable: true });
  assert.deepEqual(parseRange("bytes=2000-3000", 1000), { unsatisfiable: true });
});

test("a backwards range cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=500-100", 1000), { unsatisfiable: true });
});

test("an empty file cannot satisfy any range", () => {
  assert.deepEqual(parseRange("bytes=0-", 0), { unsatisfiable: true });
  assert.deepEqual(parseRange("bytes=-10", 0), { unsatisfiable: true });
});

// Answering 200 with the whole file is a legitimate response to a Range a server will not honour,
// and a media element copes with it. Guessing at one of several ranges would not be legitimate.
test("several ranges at once are declined, and the whole file is sent", () => {
  assert.equal(parseRange("bytes=0-99,200-299", 1000), null);
});

test("a header that is not a byte range is ignored", () => {
  assert.equal(parseRange("items=0-99", 1000), null);
  assert.equal(parseRange("bytes=abc-def", 1000), null);
  assert.equal(parseRange("bytes=-", 1000), null);
});

// A zero-length suffix asks for nothing at all, which is not a thing to answer 206 with.
test("a zero-length suffix cannot be satisfied", () => {
  assert.deepEqual(parseRange("bytes=-0", 1000), { unsatisfiable: true });
});

test("surrounding whitespace does not change the answer", () => {
  assert.deepEqual(parseRange("  bytes=10-19  ", 1000), { start: 10, end: 19, length: 10 });
});
