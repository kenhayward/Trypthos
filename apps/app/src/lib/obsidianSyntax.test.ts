import { describe, expect, it } from "vitest";
import { GFM, parser } from "@lezer/markdown";
import { OBSIDIAN_MARKDOWN } from "./obsidianSyntax";

/// Obsidian's marks in the editor's syntax tree, so Source can colour them and Live can hide their
/// punctuation. Parsed with GFM underneath, as the editor does.

const obsidian = parser.configure([GFM, OBSIDIAN_MARKDOWN]);
const gfm = parser.configure([GFM]);

/// Every node, as `Name "text"`, in document order.
function nodes(text: string, using = obsidian): string[] {
  const found: string[] = [];
  using.parse(text).iterate({
    enter(node) {
      if (node.name === "Document" || node.name === "Paragraph") return;
      found.push(`${node.name} ${JSON.stringify(text.slice(node.from, node.to))}`);
    },
  });
  return found;
}

describe("the editor's Obsidian syntax", () => {
  it("parses a wiki link into its marks and target", () => {
    expect(nodes("See [[Plan]].")).toEqual([
      'WikiLink "[[Plan]]"',
      'WikiLinkMark "[["',
      'WikiLinkTarget "Plan"',
      'WikiLinkMark "]]"',
    ]);
  });

  // With an alias, the target is what Live hides - so it is a different node from a target that is
  // the only thing shown.
  it("names an aliased target apart, with the bar and the alias", () => {
    expect(nodes("[[Plan#Goals|the goals]]")).toEqual([
      'WikiLink "[[Plan#Goals|the goals]]"',
      'WikiLinkMark "[["',
      'WikiLinkAliasedTarget "Plan#Goals"',
      'WikiLinkBar "|"',
      'WikiLinkAlias "the goals"',
      'WikiLinkMark "]]"',
    ]);
  });

  it("parses an embed", () => {
    expect(nodes("![[chart.png|100]]")[0]).toBe('Embed "![[chart.png|100]]"');
    expect(nodes("![[chart.png|100]]")[1]).toBe('EmbedMark "![["');
  });

  it("parses a highlight, with what is inside it", () => {
    expect(nodes("A ==**very** big== deal.")).toEqual([
      'Highlight "==**very** big=="',
      'HighlightMark "=="',
      'StrongEmphasis "**very**"',
      'EmphasisMark "**"',
      'EmphasisMark "**"',
      'HighlightMark "=="',
    ]);
  });

  it("parses inline comments and block comments", () => {
    expect(nodes("Shown %%hidden%% shown.")).toEqual(['Comment "%%hidden%%"', 'CommentMark "%%"', 'CommentMark "%%"']);
    expect(nodes("%%\nhidden\n%%\n\nAfter")[0]).toBe('BlockComment "%%\\nhidden\\n%%"');
  });

  it("parses tags, and not what only looks like one", () => {
    expect(nodes("Filed #inbox/to-read, not #1984 or page#anchor.")).toEqual(['Tag "#inbox/to-read"']);
  });

  it("parses inline and display math, and not money", () => {
    expect(nodes("Euler $e^{i\\pi}$ here.")).toEqual([
      'InlineMath "$e^{i\\\\pi}$"',
      'InlineMathMark "$"',
      'InlineMathMark "$"',
    ]);
    expect(nodes("$$\nx^2\n$$")[0]).toBe('BlockMath "$$\\nx^2\\n$$"');
    expect(nodes("It costs $5 and $10.")).toEqual([]);
  });

  it("parses a block id at the end of a line", () => {
    expect(nodes("Quotable. ^quote-1")).toEqual(['BlockId "^quote-1"']);
  });

  it("parses a callout's marker at the start of a quote", () => {
    expect(nodes("> [!tip]- Title\n> Body")).toContain('CalloutMark "[!tip]-"');
    expect(nodes("A [!tip] in a sentence.").filter((node) => node.startsWith("Callout"))).toEqual([]);
  });

  it("leaves code alone", () => {
    expect(nodes("`[[Plan]] ==x==`").filter((node) => !node.startsWith("InlineCode") && !node.startsWith("CodeMark"))).toEqual([]);
  });

  // The GFM parser underneath knows none of this, which is what a GFM document is edited with.
  it("is absent from GFM, which still parses tables and strikethrough", () => {
    // Lezer reads `[Plan]` as a link with nothing to point at, in both - so only Obsidian's own nodes
    // are looked for.
    const obsidianNodes = /^(WikiLink|Embed|Highlight|Comment|BlockComment|Tag|InlineMath|BlockMath|BlockId|Callout)/;
    expect(nodes("[[Plan]] ==x== #tag", gfm).filter((node) => obsidianNodes.test(node))).toEqual([]);
    expect(nodes("~~gone~~", gfm)[0]).toBe('Strikethrough "~~gone~~"');
    expect(nodes("| a |\n|---|\n| 1 |", gfm)[0]).toBe('Table "| a |\\n|---|\\n| 1 |"');
  });
});
