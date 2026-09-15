import { describe, expect, it } from "vitest";
import { splitFrontMatter } from "./frontMatter";

/// YAML front matter - Obsidian's properties, and what Jekyll, Hugo and GitHub all read.
///
/// Not a YAML parser. What is shown is a list of properties, each a key with its values as written,
/// which is what both Obsidian's properties view and GitHub's front matter table show.

describe("splitFrontMatter", () => {
  it("takes the block off the top and lists its properties", () => {
    const text = "---\ntitle: The plan\ndate: 2026-09-15\n---\n\n# Plan\n";
    expect(splitFrontMatter(text)).toEqual({
      properties: [
        { key: "title", values: ["The plan"] },
        { key: "date", values: ["2026-09-15"] },
      ],
      body: "\n# Plan\n",
    });
  });

  it("reads a list written either way, and strips quotes", () => {
    const text = '---\ntags:\n  - one\n  - "two"\naliases: [Plan, \'The plan\']\nempty:\n---\nBody';
    expect(splitFrontMatter(text).properties).toEqual([
      { key: "tags", values: ["one", "two"] },
      { key: "aliases", values: ["Plan", "The plan"] },
      { key: "empty", values: [] },
    ]);
  });

  it("accepts Windows line endings and a closing '...'", () => {
    expect(splitFrontMatter("---\r\ntitle: Plan\r\n...\r\nBody").properties).toEqual([
      { key: "title", values: ["Plan"] },
    ]);
  });

  // Only the very first line may open it. A rule further down is a rule.
  it.each([
    ["no front matter", "# Plan\n\n---\n\ntext"],
    ["a rule that is not at the top", "\n---\ntitle: x\n---\n"],
    ["an opening with no close", "---\ntitle: x\n\nBody"],
  ])("leaves the document alone for %s", (_name, text) => {
    expect(splitFrontMatter(text)).toEqual({ properties: null, body: text });
  });

  // Something that is not key-and-value is kept as it was written rather than guessed at.
  it("keeps a line it cannot read as a property, under no key", () => {
    expect(splitFrontMatter("---\n  stray\n---\n").properties).toEqual([{ key: "", values: ["stray"] }]);
  });
});
