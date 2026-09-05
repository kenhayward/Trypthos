import { describe, expect, it } from "vitest";
import { isHidden, sortNodes, type TreeEntry } from "./workspaceTree";

const file = (name: string): TreeEntry => ({ name, kind: "file" });
const dir = (name: string): TreeEntry => ({ name, kind: "directory" });

describe("isHidden", () => {
  it("treats dot-prefixed entries as hidden", () => {
    expect(isHidden(".git")).toBe(true);
    expect(isHidden(".env")).toBe(true);
  });

  it("does not treat an ordinary name with a dot as hidden", () => {
    expect(isHidden("notes.md")).toBe(false);
  });
});

describe("sortNodes", () => {
  it("puts directories before files", () => {
    const sorted = sortNodes([file("a.md"), dir("z-folder")]);
    expect(sorted.map((n) => n.name)).toEqual(["z-folder", "a.md"]);
  });

  it("sorts each group by name", () => {
    const sorted = sortNodes([file("b.md"), file("a.md"), dir("y"), dir("x")]);
    expect(sorted.map((n) => n.name)).toEqual(["x", "y", "a.md", "b.md"]);
  });

  // "Chapter 10" after "Chapter 9", not before it. Plain string comparison puts 10 first, which looks
  // like a bug in the file list rather than in the sort.
  it("orders embedded numbers naturally", () => {
    const sorted = sortNodes([file("ch10.md"), file("ch9.md"), file("ch1.md")]);
    expect(sorted.map((n) => n.name)).toEqual(["ch1.md", "ch9.md", "ch10.md"]);
  });

  it("is case-insensitive, so an uppercase name does not sort to the top", () => {
    const sorted = sortNodes([file("banana.md"), file("Apple.md"), file("cherry.md")]);
    expect(sorted.map((n) => n.name)).toEqual(["Apple.md", "banana.md", "cherry.md"]);
  });

  it("does not mutate its input", () => {
    const input = [file("b.md"), file("a.md")];
    sortNodes(input);
    expect(input.map((n) => n.name)).toEqual(["b.md", "a.md"]);
  });
});
