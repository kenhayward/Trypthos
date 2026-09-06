import { describe, expect, it } from "vitest";
import { READ_FENCE_TAG, readRequestIn } from "./readBlocks";

const block = (path: string) => ["```" + READ_FENCE_TAG, path, "```"].join("\n");

describe("readRequestIn", () => {
  it("reads the path out of a block", () => {
    expect(readRequestIn(block("notes/plan.md"))).toBe("notes/plan.md");
  });

  it("finds one with prose around it", () => {
    expect(readRequestIn(`Let me look.\n\n${block("a.md")}\n\nThen I will answer.`)).toBe("a.md");
  });

  it("ignores surrounding whitespace on the path", () => {
    expect(readRequestIn("```" + READ_FENCE_TAG + "\n   a.md  \n```")).toBe("a.md");
  });

  // The first, not the last. A model that asks for three gets them one round at a time, which is
  // what makes the per-turn cap mean anything.
  it("answers the first request when several are written", () => {
    expect(readRequestIn(`${block("a.md")}\n${block("b.md")}`)).toBe("a.md");
  });

  it("finds nothing in an ordinary reply", () => {
    expect(readRequestIn("Here is the answer, with no request in it.")).toBeNull();
  });

  // A block that has not finished arriving is not a request yet. Acting on one would read whatever
  // partial path had streamed so far.
  it("finds nothing in a block that has not closed", () => {
    expect(readRequestIn("```" + READ_FENCE_TAG + "\nnotes/plan.md\n")).toBeNull();
  });

  it("finds nothing in an empty block", () => {
    expect(readRequestIn("```" + READ_FENCE_TAG + "\n\n```")).toBeNull();
  });

  // The edit transport's tag, not this one. Two fenced protocols share a reply, and a read that
  // matched an edit would carry out something the user was meant to approve.
  it("does not mistake an edit block for a read", () => {
    expect(readRequestIn("```trypthos-edit append\nSome content\n```")).toBeNull();
  });

  // Four backticks are how the edit format nests a fence. Reads are one line and never need it,
  // but a reply may contain both, and the reader must not run off into somebody else's block.
  it("does not read across a four-backtick fence", () => {
    const nested = "````trypthos-edit append\n" + block("a.md") + "\n````";
    expect(readRequestIn(nested)).toBeNull();
  });

  // Only the path. A model that writes a sentence has not made a request this can act on, and
  // guessing which word is the path is how a chat reads a file nobody asked for.
  it("refuses a block holding anything but a path", () => {
    expect(readRequestIn("```" + READ_FENCE_TAG + "\nplease read notes/plan.md\n```")).toBeNull();
  });

  it("refuses a block holding several lines", () => {
    expect(readRequestIn("```" + READ_FENCE_TAG + "\na.md\nb.md\n```")).toBeNull();
  });
});
