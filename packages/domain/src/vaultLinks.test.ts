import { describe, expect, it } from "vitest";
import { extractReferences, maskIgnored } from "./vaultLinks";

const wiki = (target: string) => ({ kind: "wiki" as const, target });
const path = (value: string) => ({ kind: "path" as const, path: value });

describe("the links a note makes", () => {
  it("reads wiki links, dropping headings, blocks and aliases", () => {
    const text = "See [[Plan]], [[Plan#Goals]], [[Road map|the map]] and [[Risks#^b1]].";
    expect(extractReferences(text).links).toEqual([wiki("Plan"), wiki("Road map"), wiki("Risks")]);
  });

  it("reads embeds as links", () => {
    expect(extractReferences("![[diagram.png]]\n![[Plan#Goals]]").links).toEqual([
      wiki("diagram.png"),
      wiki("Plan"),
    ]);
  });

  it("drops a link to a heading in the same note", () => {
    expect(extractReferences("Jump to [[#Later]].").links).toEqual([]);
  });

  it("reads markdown links to vault files, decoded, without fragments", () => {
    const text = "[a](Plan.md) [b](../Other%20note.md#top) [c](<Folder/Road map.md>) ![d](img/x.png?raw=1)";
    expect(extractReferences(text).links).toEqual([
      path("Plan.md"),
      path("../Other note.md"),
      path("Folder/Road map.md"),
      path("img/x.png"),
    ]);
  });

  it("ignores web addresses, other schemes and bare anchors", () => {
    const text = "[w](https://example.com/a.md) [m](mailto:ada@example.com) [f](file:///x.md) [h](#top)";
    expect(extractReferences(text).links).toEqual([]);
  });

  it("keeps a malformed escape out rather than throwing", () => {
    expect(extractReferences("[x](bad%E0%A4%A.md)").links).toEqual([]);
  });

  it("reads wiki links in front matter values", () => {
    const text = "---\nrelated: \"[[Plan]]\"\nup:\n  - \"[[Index]]\"\n---\nBody";
    expect(extractReferences(text).links).toEqual([wiki("Plan"), wiki("Index")]);
  });

  it("counts a repeated link once", () => {
    expect(extractReferences("[[Plan]] [[Plan]] [[plan#x]]").links).toEqual([wiki("Plan"), wiki("plan")]);
  });

  it("ignores links in code spans, fenced and indented code, and comments", () => {
    const text = [
      "Real [[One]].",
      "`[[InSpan]]`",
      "```",
      "[[InFence]]",
      "```",
      "~~~md",
      "[[InTilde]]",
      "~~~",
      "",
      "    [[Indented]]",
      "",
      "%% [[Hidden]] %%",
      "%%",
      "[[HiddenBlock]]",
      "%%",
      "Real [[Two]].",
    ].join("\n");
    expect(extractReferences(text).links).toEqual([wiki("One"), wiki("Two")]);
  });

  it("does not take a nested list item for indented code", () => {
    expect(extractReferences("- item\n    - [[Nested]]").links).toEqual([wiki("Nested")]);
  });

  it("does not take a nested list item for indented code across a loose list's blank line", () => {
    expect(extractReferences("- item\n\n    - [[Nested]]").links).toEqual([wiki("Nested")]);
  });

  it("still masks genuine indented code after a list, a fenced block and a blank line", () => {
    expect(extractReferences("- item\n```\nx\n```\n\n    [[ShouldBeMasked]]").links).toEqual([]);
  });
});

describe("the tags a note carries", () => {
  it("reads inline tags, lowercased and unique", () => {
    expect(extractReferences("#Inbox and (#project/atlas) then #inbox").tags).toEqual([
      "inbox",
      "project/atlas",
    ]);
  });

  it("rejects numbers, headings, words with a hash inside and URL fragments", () => {
    const text = "# Heading\n#2024 is a year, a#b is not a tag, see https://example.com/#frag";
    expect(extractReferences(text).tags).toEqual([]);
  });

  it("accepts a tag with digits when it has a letter", () => {
    expect(extractReferences("#y2024").tags).toEqual(["y2024"]);
  });

  it("reads front matter tags as a list or a string, with or without hashes", () => {
    expect(extractReferences("---\ntags: [Alpha, \"#beta\"]\n---\n").tags).toEqual(["alpha", "beta"]);
    expect(extractReferences("---\ntags:\n  - gamma\n---\n").tags).toEqual(["gamma"]);
    expect(extractReferences("---\ntag: delta, epsilon\n---\n").tags).toEqual(["delta", "epsilon"]);
  });

  it("ignores tags in code and comments", () => {
    expect(extractReferences("`#code`\n```\n#fence\n```\n%% #comment %%").tags).toEqual([]);
  });

  it("does not read a markdown link's URL fragment as a tag", () => {
    expect(extractReferences("[Section One](#section-one) [h](Note.md#top)").tags).toEqual([]);
  });

  it("still reads a tag written in plain parentheses, not a link destination", () => {
    expect(extractReferences("(#project/atlas)").tags).toEqual(["project/atlas"]);
  });

  it("reads a tag in a loose list item's continuation text", () => {
    expect(extractReferences("- item\n\n    More text about #tag here").tags).toEqual(["tag"]);
  });
});

describe("masking what Obsidian does not read", () => {
  it("keeps line structure so positions stay put", () => {
    const text = "a `b` c\n```\nx\n```\nd";
    const masked = maskIgnored(text);
    expect(masked.length).toBe(text.length);
    expect(masked.split("\n").length).toBe(text.split("\n").length);
    expect(masked).toContain("a");
    expect(masked).not.toContain("b");
    expect(masked).not.toContain("x");
  });
});
