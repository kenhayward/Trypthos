import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownPreview from "./MarkdownPreview";

/// Math and diagrams, drawn for real.
///
/// The only place a Mermaid diagram can be drawn at all: it measures its text to lay the diagram
/// out, and jsdom has no layout to measure with.

async function until<T>(find: () => T | null, timeout = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const found = find();
    if (found !== null) return found;
    if (Date.now() - started > timeout) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("math and diagrams in Preview, rendered", () => {
  it("typesets Obsidian math with KaTeX, styled", async () => {
    const { container } = render(
      <MarkdownPreview source={"Inline $x^2$ here.\n\n$$\n\\sum_{i=1}^{n} i\n$$\n"} fileTypes={["markdown"]} flavour="obsidian" />,
    );

    const display = await until(() => container.querySelector(".katex-display"));
    expect(container.querySelector("span.md-math .katex")).not.toBeNull();
    // The stylesheet arrived with the library: KaTeX's own font is what the glyphs are set in.
    expect(getComputedStyle(display.querySelector(".katex")!).fontFamily).toContain("KaTeX");
  });

  it("draws a mermaid block as a diagram", async () => {
    const { container } = render(
      <MarkdownPreview source={"```mermaid\ngraph TD\n  Plan --> Ship\n```\n"} fileTypes={["markdown"]} />,
    );

    const svg = await until(() => container.querySelector(".md-mermaid svg"));
    expect(container.querySelector("pre")).toBeNull();
    expect(svg.textContent).toContain("Plan");
    expect(svg.textContent).toContain("Ship");
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  // The dark theme is a different set of colours, drawn by the real library - and its labels are
  // still SVG text after the drawing has been through the sanitiser, which is what would empty them
  // if Mermaid put them in a foreignObject.
  it("draws a diagram in the dark theme, with its labels intact", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    try {
      const { container } = render(
        <MarkdownPreview source={"```mermaid\ngraph LR\n  Draft --> Review --> Publish\n```\n"} fileTypes={["markdown"]} />,
      );

      const svg = await until(() => container.querySelector(".md-mermaid svg"));
      expect(container.querySelector("pre")).toBeNull();
      for (const label of ["Draft", "Review", "Publish"]) expect(svg.textContent).toContain(label);
      expect(svg.querySelector("foreignObject")).toBeNull();
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });
});
