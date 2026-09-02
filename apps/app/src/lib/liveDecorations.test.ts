import { describe, expect, it } from "vitest";
import {
  consumesTrailingSpace,
  substituteFor,
  formatClassFor,
  isHiddenMarker,
  markersToHide,
  revealedLines,
  type SyntaxRange,
} from "./liveDecorations";

/// Stands in for the document's line index. Ten characters per line keeps the arithmetic obvious.
const lineOf = (pos: number): number => Math.floor(pos / 10) + 1;

describe("isHiddenMarker", () => {
  it("hides the punctuation that makes markdown markdown", () => {
    expect(isHiddenMarker("HeaderMark", "ATXHeading1")).toBe(true);
    expect(isHiddenMarker("EmphasisMark", "StrongEmphasis")).toBe(true);
    expect(isHiddenMarker("QuoteMark", "Blockquote")).toBe(true);
    expect(isHiddenMarker("LinkMark", "Link")).toBe(true);
  });

  it("hides a link's target, leaving its text", () => {
    expect(isHiddenMarker("URL", "Link")).toBe(true);
  });

  // A list bullet is substituted rather than hidden, so it must not also be reported as hidden -
  // doing both would replace the marker AND remove the replacement.
  it("does not hide a marker that is substituted instead", () => {
    expect(isHiddenMarker("ListMark", "ListItem")).toBe(false);
  });

  // CodeMark serves both `inline` and fenced blocks. Fenced code is deliberately not decorated yet,
  // so its fences must stay visible - a construct with no decoration renders as source.
  it("hides inline code backticks but not fence markers", () => {
    expect(isHiddenMarker("CodeMark", "InlineCode")).toBe(true);
    expect(isHiddenMarker("CodeMark", "FencedCode")).toBe(false);
  });

  it("leaves ordinary content alone", () => {
    expect(isHiddenMarker("Paragraph", "Document")).toBe(false);
    expect(isHiddenMarker("CodeText", "FencedCode")).toBe(false);
  });
});

describe("consumesTrailingSpace", () => {
  // A block marker owns the space after it: "# " is the syntax, not "#" plus content that happens to
  // start with a space. Hiding only the hash leaves every heading and quote indented by one space -
  // visible immediately in a browser, and invisible to any test that cannot lay text out.
  it("is true for the block markers that are followed by one", () => {
    expect(consumesTrailingSpace("HeaderMark")).toBe(true);
    expect(consumesTrailingSpace("QuoteMark")).toBe(true);
  });

  it("is false for inline markers, which sit flush against their content", () => {
    expect(consumesTrailingSpace("EmphasisMark")).toBe(false);
    expect(consumesTrailingSpace("CodeMark")).toBe(false);
    expect(consumesTrailingSpace("LinkMark")).toBe(false);
  });

  // The bullet stays visible, so its space is part of what is drawn.
  it("is false for list bullets", () => {
    expect(consumesTrailingSpace("ListMark")).toBe(false);
  });
});

describe("substituteFor", () => {
  // Hiding "-" leaves the item indented under nothing, which reads worse than the marker it removed.
  // Substituting a bullet is the option that resolves it, and the one we had not taken.
  it("replaces an unordered list marker with a bullet", () => {
    expect(substituteFor("ListMark", "ListItem")).toBe("•");
  });

  it("leaves every other marker to be hidden outright", () => {
    expect(substituteFor("HeaderMark", "ATXHeading1")).toBeNull();
    expect(substituteFor("EmphasisMark", "StrongEmphasis")).toBeNull();
    expect(substituteFor("QuoteMark", "Blockquote")).toBeNull();
  });

  it("does not substitute a ListMark outside a list item", () => {
    expect(substituteFor("ListMark", "Document")).toBeNull();
  });
});

describe("formatClassFor", () => {
  it("maps content nodes to their rendered appearance", () => {
    expect(formatClassFor("ATXHeading1")).toBe("cm-live-h1");
    expect(formatClassFor("StrongEmphasis")).toBe("cm-live-strong");
    expect(formatClassFor("Emphasis")).toBe("cm-live-em");
    expect(formatClassFor("InlineCode")).toBe("cm-live-code");
    expect(formatClassFor("Link")).toBe("cm-live-link");
  });

  it("returns null for nodes with no rendered form", () => {
    expect(formatClassFor("Paragraph")).toBeNull();
    expect(formatClassFor("Document")).toBeNull();
  });
});

describe("revealedLines", () => {
  it("reveals the line the caret sits on", () => {
    expect([...revealedLines([{ from: 4, to: 4 }], lineOf)]).toEqual([1]);
  });

  it("reveals every line a selection spans, not just its ends", () => {
    expect([...revealedLines([{ from: 4, to: 25 }], lineOf)]).toEqual([1, 2, 3]);
  });

  it("reveals every cursor when there are several", () => {
    const lines = revealedLines([{ from: 4, to: 4 }, { from: 34, to: 34 }], lineOf);
    expect([...lines].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("reveals nothing when there is no selection at all", () => {
    expect([...revealedLines([], lineOf)]).toEqual([]);
  });
});

describe("markersToHide", () => {
  const markers: SyntaxRange[] = [
    { name: "HeaderMark", parent: "ATXHeading1", from: 0, to: 1 },
    { name: "EmphasisMark", parent: "StrongEmphasis", from: 12, to: 14 },
    { name: "ListMark", parent: "ListItem", from: 22, to: 23 },
  ];

  it("hides markers on lines the caret is not on", () => {
    expect(markersToHide(markers, lineOf, new Set())).toEqual([
      { from: 0, to: 1 },
      { from: 12, to: 14 },
    ]);
  });

  // The whole point of the mode: the line you are editing shows its own scaffolding, so you can see
  // and change the characters you are actually typing.
  it("leaves the caret line's markers visible", () => {
    expect(markersToHide(markers, lineOf, new Set([2]))).toEqual([{ from: 0, to: 1 }]);
  });

  it("hides nothing when every line is revealed", () => {
    expect(markersToHide(markers, lineOf, new Set([1, 2, 3]))).toEqual([]);
  });

  it("never hides a marker that is not a hidden kind", () => {
    const hidden = markersToHide(markers, lineOf, new Set());
    expect(hidden).not.toContainEqual({ from: 22, to: 23 });
  });

  it("returns ranges in document order, as a decoration set requires", () => {
    const shuffled: SyntaxRange[] = [
      { name: "EmphasisMark", parent: "Emphasis", from: 30, to: 31 },
      { name: "HeaderMark", parent: "ATXHeading1", from: 0, to: 1 },
    ];
    expect(markersToHide(shuffled, lineOf, new Set())).toEqual([
      { from: 0, to: 1 },
      { from: 30, to: 31 },
    ]);
  });
});
