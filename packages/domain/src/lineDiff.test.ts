import { describe, expect, it } from "vitest";
import { diffLines } from "./lineDiff";

/// Comparing two files line by line.
///
/// A rule over two lists of strings, so none of this needs a filesystem - which is most of why it
/// lives in the domain rather than beside the tool that calls it.

const diff = (left: string, right: string, limit = 100) =>
  diffLines(left, right, { limit, context: 1 });

describe("diffLines", () => {
  it("says nothing when the files match", () => {
    const result = diff("a\nb\nc\n", "a\nb\nc\n");

    expect(result.identical).toBe(true);
    expect(result.text).toBe("");
  });

  it("marks a changed line as one removed and one added", () => {
    const result = diff("a\nb\nc\n", "a\nB\nc\n");

    expect(result.identical).toBe(false);
    expect(result.text.split("\n")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("marks an added line", () => {
    expect(diff("a\nc\n", "a\nb\nc\n").text.split("\n")).toEqual([" a", "+b", " c"]);
  });

  it("marks a removed line", () => {
    expect(diff("a\nb\nc\n", "a\nc\n").text.split("\n")).toEqual([" a", "-b", " c"]);
  });

  // A comparison of two files that differ in one line should be one line long, not the whole file.
  it("keeps only the parts that differ, with a little either side", () => {
    const left = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
    const right = ["1", "2", "3", "4", "X", "6", "7", "8", "9"].join("\n");

    expect(diff(left, right).text.split("\n")).toEqual([" 4", "-5", "+X", " 6"]);
  });

  // The normal case for a text file, and reporting a phantom last line as a difference would make
  // every comparison between a file with a trailing newline and one without look like a change
  // nobody made.
  it("does not read a trailing newline as a line", () => {
    expect(diff("a\nb\n", "a\nb").identical).toBe(true);
  });

  it("reads both line endings the same way", () => {
    expect(diff("a\r\nb\r\n", "a\nb\n").identical).toBe(true);
  });

  // Truncation is always MARKED. A model told it has the whole comparison when it has the first few
  // lines will answer confidently and wrongly.
  it("stops at the limit, and says it did", () => {
    const left = Array.from({ length: 50 }, (_, n) => `line ${n}`).join("\n");
    const right = Array.from({ length: 50 }, (_, n) => `LINE ${n}`).join("\n");
    const result = diffLines(left, right, { limit: 10, context: 0 });

    expect(result.truncated).toBe(true);
    expect(result.text.split("\n")).toHaveLength(10);
  });

  it("does not claim truncation when it showed everything", () => {
    expect(diff("a\n", "b\n").truncated).toBe(false);
  });

  it("compares a file against an empty one", () => {
    expect(diff("", "a\nb\n").text.split("\n")).toEqual(["+a", "+b"]);
    expect(diff("a\nb\n", "").text.split("\n")).toEqual(["-a", "-b"]);
  });

  it("says two empty files match", () => {
    expect(diff("", "").identical).toBe(true);
  });

  // The text of a line is the file's, and it has to survive exactly - including whatever leading
  // space it had, which is why the mark is a character rather than a trim-and-prefix.
  it("keeps a line's own leading space", () => {
    expect(diff("  indented\n", "\tindented\n").text.split("\n")).toEqual([
      "-  indented",
      "+\tindented",
    ]);
  });
});
