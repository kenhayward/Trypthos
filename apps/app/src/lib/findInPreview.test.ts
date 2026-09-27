import { describe, expect, it } from "vitest";
import { findMatches } from "@trypthos/domain";
import { markPreviewMatches, previewVisibleText } from "./findInPreview";

/// The two halves must agree on what the rendered prose's text IS: `previewVisibleText` is what Find
/// searches, and `markPreviewMatches` walks the very same characters to wrap them. A test that only
/// exercises one half would pass while the other drifts - which is how a highlight lands over the
/// wrong words.

describe("previewVisibleText", () => {
  it("reads the rendered prose as its visible text, in order", () => {
    // Tags are not part of what a reader sees; the words and their spacing are.
    expect(previewVisibleText("<h1>Title</h1><p>Some <strong>bold</strong> text.</p>")).toBe(
      "TitleSome bold text.",
    );
  });

  it("keeps the whitespace between inline elements", () => {
    // A phrase that spans a markup boundary is still one phrase to a reader - the space survives.
    expect(previewVisibleText("<p>a <strong>b</strong> c</p>")).toBe("a b c");
  });

  it("answers empty for an empty document", () => {
    expect(previewVisibleText("")).toBe("");
  });
});

describe("markPreviewMatches", () => {
  it("wraps a match that sits inside one run of text", () => {
    const html = "<p>The cat sat on the mat.</p>";
    const marked = markPreviewMatches(html, findMatches(previewVisibleText(html), "cat", { regex: false, caseSensitive: false })!);

    expect(marked).toBe('<p>The <span class="cm-find-match">cat</span> sat on the mat.</p>');
  });

  it("wraps every match, and leaves the text between them alone", () => {
    const html = "<p>One cat, two cats.</p>";
    // The query is `cat`, so the second hit marks only those three letters - the trailing `s` of
    // `cats` is not part of what was searched for and stays out of the highlight.
    const marked = markPreviewMatches(html, findMatches(previewVisibleText(html), "cat", { regex: false, caseSensitive: false })!);

    expect(marked).toBe(
      '<p>One <span class="cm-find-match">cat</span>, two <span class="cm-find-match">cat</span>s.</p>',
    );
  });

  it("wraps a match that spans an inline element's boundary", () => {
    // `bold` is drawn as `<strong>bo</strong>ld`: the word is one phrase to a reader but two text
    // runs in the markup. A highlight that stopped at the tag would mark only half of it - so both
    // runs are wrapped, each where it actually sits (the first inside its element).
    const html = "<p>Some <strong>bo</strong>ld text.</p>";
    const marked = markPreviewMatches(html, findMatches(previewVisibleText(html), "bold", { regex: false, caseSensitive: false })!);

    expect(marked).toBe(
      '<p>Some <strong><span class="cm-find-match">bo</span></strong><span class="cm-find-match">ld</span> text.</p>',
    );
  });

  it("wraps a match that crosses a block boundary on both sides", () => {
    // `lebo` spans the seam between the heading and the paragraph. The visible text joins them, so a
    // query can land across the break - and like CodeMirror's own multi-line highlight, both halves
    // are marked rather than one being quietly dropped.
    const html = "<h1>Title</h1><p>body</p>";
    const marked = markPreviewMatches(html, [{ from: 3, to: 7 }]);
    expect(marked).toBe(
      '<h1>Tit<span class="cm-find-match">le</span></h1><p><span class="cm-find-match">bo</span>dy</p>',
    );
  });

  it("skips a zero-length match rather than wrapping nothing", () => {
    const html = "<p>abc</p>";
    expect(markPreviewMatches(html, [{ from: 1, to: 1 }])).toBe("<p>abc</p>");
  });

  it("returns the document untouched when there is nothing to mark", () => {
    const html = "<p>Nothing here.</p>";
    expect(markPreviewMatches(html, [])).toBe(html);
  });

  it("keeps the visible text identical after marking", () => {
    // Wrapping must not add or drop a character: a highlight is a view of the same words.
    const html = "<h1>Title</h1><p>Some <strong>bold</strong> text.</p>";
    const marked = markPreviewMatches(html, findMatches(previewVisibleText(html), "Title", { regex: false, caseSensitive: false })!);
    expect(previewVisibleText(marked)).toBe(previewVisibleText(html));
  });
});
