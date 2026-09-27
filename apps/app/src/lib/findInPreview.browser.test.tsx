import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { findMatches } from "@trypthos/domain";
import MarkdownPreview from "../components/MarkdownPreview";
import { previewVisibleText } from "./findInPreview";
import { renderMarkdown } from "./markdown";

/// Find in Preview, where the document is actually drawn: coloured code, typeset maths and diagrams
/// all rewrite parts of the rendered markup after it lands, which jsdom does not do and a real page
/// does.

const find = (source: string, query: string) =>
  findMatches(previewVisibleText(renderMarkdown(source, { flavour: "gfm" })), query, {
    regex: false,
    caseSensitive: false,
  })!;

describe("Find in Preview, drawn", () => {
  // The count, the marks on screen and the index Find steps through must stay one list. A code block
  // is coloured after the marks are painted, and colouring rebuilds it from its text - which once
  // wiped the mark inside it, so the count said two, one was shown, and stepping to the first match
  // highlighted the second.
  it("keeps a match inside a coloured code block, and steps to the right one", async () => {
    const source = "```javascript\nconst total = 1;\n```\n\nThe total is here.\n";
    const matches = find(source, "total");
    expect(matches).toHaveLength(2);

    const { container, rerender } = render(
      <MarkdownPreview source={source} fileTypes={["markdown", "javascript"]} matches={matches} activeMatch={1} />,
    );
    await expect.poll(() => container.querySelectorAll("pre code span[class^='tp-tok']").length).toBeGreaterThan(0);

    expect(container.querySelectorAll(".cm-find-match")).toHaveLength(2);
    expect(container.querySelector(".cm-find-active")?.closest("pre")).toBeNull();

    rerender(<MarkdownPreview source={source} fileTypes={["markdown", "javascript"]} matches={matches} activeMatch={0} />);
    await expect.poll(() => container.querySelector(".cm-find-active")?.closest("pre") ?? null).not.toBeNull();
  });

  // Reading the rendered prose as text must not load anything it names. Preview reads a picture from
  // the user's folder itself; a parse that fetched `images/chart.png` against the app's own origin, or a
  // web address, on every search would be requests nobody asked for.
  it("reads the prose as text without requesting its pictures", async () => {
    const name = `probe-${Date.now()}.png`;
    previewVisibleText(renderMarkdown(`![chart](${name})`, { flavour: "gfm" }));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const requested = performance.getEntriesByType("resource").some((entry) => entry.name.includes(name));
    expect(requested).toBe(false);
  });
});
