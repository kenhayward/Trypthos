import { describe, expect, it, vi } from "vitest";
import { renderRichBlocks, type RichBlockLoaders } from "./richBlocks";

/// Typesetting math and drawing diagrams, after the markdown has been rendered.
///
/// Both libraries are loaded only when a document has something for them, so they are handed in as
/// loaders - which is also what lets a diagram be tested here, where there is no layout for Mermaid
/// to measure. Math uses the real KaTeX: it typesets to a string and needs no layout.

function container(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

const never = () => false;

function fakeMermaid(render: (id: string, text: string) => Promise<{ svg: string }>) {
  const mermaid = { initialize: vi.fn(), render: vi.fn(render) };
  return { mermaid, load: vi.fn(async () => ({ default: mermaid })) };
}

const noDiagrams = { mermaid: vi.fn(async () => { throw new Error("not asked for"); }) };

describe("math", () => {
  it("typesets inline and display math with KaTeX", async () => {
    const element = container('<p><span class="md-math">x^2</span></p><div class="md-math" data-display="">\\frac{a}{b}</div>');

    await renderRichBlocks(element, never, noDiagrams as unknown as Partial<RichBlockLoaders>);

    const [inline, display] = element.querySelectorAll(".md-math");
    expect(inline!.querySelector(".katex")).not.toBeNull();
    expect(inline!.querySelector(".katex-display")).toBeNull();
    expect(display!.querySelector(".katex-display")).not.toBeNull();
    expect(inline!.getAttribute("data-tp-rendered")).toBe("true");
  });

  it("shows TeX it cannot typeset as an error, without throwing", async () => {
    const element = container('<span class="md-math">\\frac{</span>');

    await renderRichBlocks(element, never, noDiagrams as unknown as Partial<RichBlockLoaders>);

    expect(element.querySelector(".katex-error")?.textContent).toContain("\\frac{");
  });

  // KaTeX's \href and friends would put a link to anywhere into the page. Trust is off, so the
  // command renders as an error instead.
  it("refuses commands that would reach outside the page", async () => {
    const element = container('<span class="md-math">\\href{javascript:alert(1)}{click}</span>');

    await renderRichBlocks(element, never, noDiagrams as unknown as Partial<RichBlockLoaders>);

    expect(element.querySelector("a")).toBeNull();
    expect(element.innerHTML).not.toContain('href="javascript');
  });

  it("loads nothing for a document with no math", async () => {
    const katex = vi.fn();
    await renderRichBlocks(container("<p>Plain</p>"), never, { katex, ...noDiagrams } as unknown as Partial<RichBlockLoaders>);
    expect(katex).not.toHaveBeenCalled();
  });
});

describe("diagrams", () => {
  it("draws a mermaid block as the diagram, strictly", async () => {
    const { mermaid, load } = fakeMermaid(async () => ({ svg: '<svg viewBox="0 0 10 10"><text>A</text></svg>' }));
    const element = container('<pre><code class="language-mermaid">graph TD\nA--&gt;B</code></pre>');

    await renderRichBlocks(element, never, { mermaid: load });

    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", startOnLoad: false }));
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), "graph TD\nA-->B");
    expect(element.querySelector("pre")).toBeNull();
    expect(element.querySelector(".md-mermaid svg text")?.textContent).toBe("A");
  });

  // Mermaid 12's own look - its redux colours, neo shapes and ELK layout - in the colours that match
  // the app's theme. Only the theme is named: the look and the layout are Mermaid's defaults, so a
  // diagram here is drawn as it is anywhere else Mermaid 12 draws one.
  it("draws in Mermaid's current look, light or dark to match the app", async () => {
    const source = '<pre><code class="language-mermaid">graph TD\nA--&gt;B</code></pre>';
    const svg = async () => ({ svg: "<svg></svg>" });

    const light = fakeMermaid(svg);
    await renderRichBlocks(container(source), never, { mermaid: light.load });
    expect(light.mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "redux-color" }));

    document.documentElement.setAttribute("data-theme", "dark");
    try {
      const dark = fakeMermaid(svg);
      await renderRichBlocks(container(source), never, { mermaid: dark.load });
      expect(dark.mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "redux-dark-color" }));
      expect(dark.mermaid.initialize).not.toHaveBeenCalledWith(expect.objectContaining({ look: expect.anything() }));
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  // Mermaid sanitises in strict mode, and the SVG is sanitised again here: it goes into the app's own
  // origin, and a diagram is text from the user's file.
  it("strips anything active from the drawing", async () => {
    const { load } = fakeMermaid(async () => ({
      svg: '<svg><script>alert(1)</script><a href="javascript:alert(1)"><text onclick="alert(1)">A</text></a></svg>',
    }));
    const element = container('<pre><code class="language-mermaid">graph TD</code></pre>');

    await renderRichBlocks(element, never, { mermaid: load });

    expect(element.querySelector("script, [onclick]")).toBeNull();
    expect(element.innerHTML).not.toContain("javascript:");
  });

  it("leaves a block it cannot draw as the code it was", async () => {
    const { load } = fakeMermaid(async () => {
      throw new Error("Parse error");
    });
    const element = container('<pre><code class="language-mermaid">not a diagram</code></pre>');

    await renderRichBlocks(element, never, { mermaid: load });

    expect(element.querySelector("pre code")?.textContent).toBe("not a diagram");
    expect(element.querySelector(".md-mermaid")).toBeNull();
  });

  it("writes nothing into a document that has been replaced meanwhile", async () => {
    const { load } = fakeMermaid(async () => ({ svg: "<svg></svg>" }));
    const element = container('<pre><code class="language-mermaid">graph TD</code></pre>');

    await renderRichBlocks(element, () => true, { mermaid: load });

    expect(element.querySelector("pre")).not.toBeNull();
  });
});
