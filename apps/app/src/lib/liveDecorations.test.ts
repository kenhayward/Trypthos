import { describe, expect, it } from "vitest";
import {
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

  // The bullet is the rendered form of a list item. Hiding it would leave the item indented under
  // nothing, which reads worse than the marker it removed.
  it("keeps list bullets", () => {
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
