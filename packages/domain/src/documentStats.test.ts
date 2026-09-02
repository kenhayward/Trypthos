import { describe, expect, it } from "vitest";
import { countWords, detectLineEnding } from "./documentStats";

describe("countWords", () => {
  it("counts plain words", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("is not inflated by whitespace", () => {
    expect(countWords("  one   two  \n\n  three \t")).toBe(3);
  });

  it("counts nothing in an empty or blank document", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  // The count is shown beside a markdown document, so the syntax must not be counted as content.
  // "**bold**" is one word, not one word wrapped in two more.
  it("does not count markdown syntax as words", () => {
    expect(countWords("**bold**")).toBe(1);
    expect(countWords("# Heading")).toBe(1);
    expect(countWords("- item")).toBe(1);
    expect(countWords("> quoted text")).toBe(2);
  });

  it("treats a hyphenated word and a contraction as one word each", () => {
    expect(countWords("well-known")).toBe(1);
    expect(countWords("don't")).toBe(1);
    expect(countWords("it's a well-known thing")).toBe(4);
  });

  it("counts numbers", () => {
    expect(countWords("RTX 4070 and 3090")).toBe(4);
  });

  it("counts nothing for punctuation alone", () => {
    expect(countWords("--- *** ...")).toBe(0);
  });
});

describe("detectLineEnding", () => {
  it("reports LF", () => {
    expect(detectLineEnding("a\nb\nc")).toBe("LF");
  });

  it("reports CRLF", () => {
    expect(detectLineEnding("a\r\nb\r\nc")).toBe("CRLF");
  });

  // A file that has been edited on both platforms. Reporting it as one or the other would be a
  // quiet lie in the status bar, and the whole point of showing it is that it is true.
  it("reports a mixture as mixed rather than picking a side", () => {
    expect(detectLineEnding("a\r\nb\nc")).toBe("Mixed");
  });

  // A single-line file has no evidence either way. LF is the neutral answer, and matches what a new
  // document gets written with.
  it("assumes LF when there is no line break at all", () => {
    expect(detectLineEnding("just one line")).toBe("LF");
    expect(detectLineEnding("")).toBe("LF");
  });

  it("is not confused by a lone carriage return inside a line", () => {
    expect(detectLineEnding("a\rb\nc")).toBe("LF");
  });
});
