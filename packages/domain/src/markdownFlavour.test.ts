import { describe, expect, it } from "vitest";
import { detectFlavour, effectiveFlavour } from "./markdownFlavour";

/// Which markdown a document is written in, read from the document itself.
///
/// Obsidian's marks are plain text to GFM, so a file with none of them renders the same either way -
/// and GFM is the answer until something only Obsidian writes turns up.

const gfm = (text: string) => detectFlavour(text).flavour;

describe("detectFlavour", () => {
  it("answers GFM for a document with nothing Obsidian writes", () => {
    const text = "# Plan\n\nSome **bold** text, a [link](notes.md) and a table.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    expect(detectFlavour(text)).toEqual({ flavour: "gfm", signals: {}, vault: false });
  });

  it.each([
    ["a wiki link", "See [[Plan]] for more.", "wikilink"],
    ["a wiki link with an alias", "See [[Plan|the plan]].", "wikilink"],
    ["an embed", "![[diagram.png]]", "embed"],
    ["an inline comment", "Visible %%hidden%% text.", "comment"],
    ["a block comment", "Before\n\n%%\nhidden\n%%\n\nAfter", "comment"],
    ["a highlight", "This is ==important== here.", "highlight"],
    ["an inline footnote", "A claim.^[Source needed.]", "inlineFootnote"],
    ["a block id", "A paragraph worth linking to. ^quote-1", "blockId"],
    ["an Obsidian-only callout", "> [!tip] Remember\n> Drink water.", "callout"],
    ["a foldable callout", "> [!NOTE]-\n> Folded.", "callout"],
    ["Obsidian properties", "---\naliases:\n  - Plan\n---\n\n# Plan", "properties"],
  ])("answers Obsidian for %s", (_name, text, signal) => {
    const detected = detectFlavour(text);
    expect(detected.flavour).toBe("obsidian");
    expect(detected.signals).toMatchObject({ [signal]: 1 });
  });

  it("counts every occurrence", () => {
    expect(detectFlavour("[[a]] and [[b]] and ![[c.png]]").signals).toEqual({ wikilink: 2, embed: 1 });
  });

  // Each of these is ordinary GFM, and each looks a little like something Obsidian writes. None may
  // turn a GitHub README into an Obsidian note.
  it.each([
    ["money", "It costs $5 and $10."],
    ["SQL with a percent pattern", "WHERE name LIKE '%%' OR x = 1"],
    ["an issue number", "Fixed in #123."],
    ["a URL fragment", "See https://example.com/page#section for details."],
    ["comparison operators with spaces", "if a == b == c then"],
    ["a setext heading", "Title\n=====\n\nBody"],
    ["a tag", "Filed under #inbox."],
    ["a GitHub alert", "> [!NOTE]\n> Useful information."],
    ["front matter with ordinary keys", "---\ntitle: Plan\ntags: [a, b]\n---\n\n# Plan"],
    ["a footnote", "A claim.[^1]\n\n[^1]: The source."],
    ["an escaped bracket pair", "Use \\[\\[ to type two brackets."],
  ])("stays GFM for %s", (_name, text) => {
    expect(gfm(text)).toBe("gfm");
  });

  // Code shows syntax rather than using it - a note ABOUT wiki links is not written in them.
  it("ignores what is inside fenced and inline code", () => {
    const text = "Type `[[Note]]` to link.\n\n```md\n![[image.png]]\n==highlight==\n```\n\n~~~\n%%comment%%\n~~~\n";
    expect(detectFlavour(text)).toEqual({ flavour: "gfm", signals: {}, vault: false });
  });

  // An `.obsidian` folder at or above the workspace is Obsidian's own marker, and settles it even for
  // a note that happens to use none of the marks yet.
  it("answers Obsidian for any document in an Obsidian vault", () => {
    expect(detectFlavour("# Plain note", { vault: true })).toEqual({
      flavour: "obsidian",
      signals: {},
      vault: true,
    });
  });
});

describe("effectiveFlavour", () => {
  const detected = detectFlavour("See [[Plan]].");

  it("follows the detection on Auto", () => {
    expect(effectiveFlavour(detected, "auto")).toBe("obsidian");
  });

  it("follows the reader's choice otherwise", () => {
    expect(effectiveFlavour(detected, "gfm")).toBe("gfm");
    expect(effectiveFlavour(detectFlavour("plain"), "obsidian")).toBe("obsidian");
  });
});
