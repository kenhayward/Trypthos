import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { MARKDOWN_GUIDE } from "./markdownGuide";

/// The guide is a document, so the things worth asserting about it are the things a reader would
/// only notice as damage: a fence left open swallows the rest of the page into a code block, a
/// character that is not ASCII renders as a box on a machine without the font, and a guide that
/// never names its flavour of markdown is the one question it exists to answer.

describe("the markdown guide", () => {
  it("names the flavour of markdown the app supports", () => {
    expect(MARKDOWN_GUIDE).toContain("GitHub Flavored Markdown");
  });

  it("opens with its title", () => {
    expect(MARKDOWN_GUIDE.startsWith("# ")).toBe(true);
  });

  // Help content is ASCII. A curly quote or a long dash arrives invisibly - pasted in, or produced
  // by a tool that "improves" punctuation - and shows up as a box or a question mark on somebody
  // else's machine rather than on the machine it was written on.
  it("is ASCII throughout", () => {
    const offences = MARKDOWN_GUIDE.split("\n")
      .map((line, index) => ({ line, index }))
      // eslint-disable-next-line no-control-regex
      .filter(({ line }) => /[^\x00-\x7f]/.test(line))
      .map(({ line, index }) => `${index + 1}: ${line}`);

    expect(offences).toEqual([]);
  });

  it("closes every code fence it opens", () => {
    const fences = MARKDOWN_GUIDE.split("\n").filter((line) => line.startsWith("```"));

    expect(fences.length % 2).toBe(0);
  });

  // It is rendered by the app's own renderer, in Preview and nowhere else special. Rendering it
  // here is what catches a guide that is fine as text and produces nothing at all as a document.
  it("renders as a document rather than as an empty page", () => {
    const html = renderMarkdown(MARKDOWN_GUIDE);

    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<blockquote>");
  });
});
