import DOMPurify from "dompurify";

/// Math and diagrams in rendered markdown, drawn after the markdown itself.
///
/// The renderer only marks them - `span.md-math` / `div.md-math` for TeX, and marked's own
/// `code.language-mermaid` for a diagram - because both libraries are large, and loading them for
/// every document would put them on every page load. They are fetched the first time a document has
/// something for them, the way code grammars are.
///
/// **What they produce is sanitised again.** KaTeX runs with trust off, and Mermaid in its strict
/// security mode, and each already refuses what would reach outside the page. Their output still goes
/// through DOMPurify before it is written, because it lands in the app's own origin and what it was
/// made from is text in the user's file.

interface Katex {
  renderToString(tex: string, options: Record<string, unknown>): string;
}

interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface RichBlockLoaders {
  katex: () => Promise<{ default: Katex }>;
  mermaid: () => Promise<{ default: Mermaid }>;
}

const LOADERS: RichBlockLoaders = {
  katex: async () => {
    // The stylesheet and its fonts come with the library, and only with it.
    await import("katex/dist/katex.min.css");
    return (await import("katex")) as { default: Katex };
  },
  mermaid: async () => (await import("mermaid")) as unknown as { default: Mermaid },
};

let diagrams = 0;

/// Whether the app is showing its dark theme: an explicit choice, or the system's when none was made.
function darkTheme(): boolean {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen !== null) return chosen === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

/// Typesets every math mark and draws every mermaid block in `container` not already done.
///
/// Done ones are marked, so a pass over an unchanged document is a query and nothing more.
/// `cancelled` is checked after every await: the document can be replaced while a library loads, and
/// writing into it then would put one document's drawing into another.
export async function renderRichBlocks(
  container: HTMLElement,
  cancelled: () => boolean,
  loaders: Partial<RichBlockLoaders> = {},
): Promise<void> {
  const load = { ...LOADERS, ...loaders };
  await typesetMath(container, cancelled, load.katex);
  await drawDiagrams(container, cancelled, load.mermaid);
}

async function typesetMath(
  container: HTMLElement,
  cancelled: () => boolean,
  loadKatex: RichBlockLoaders["katex"],
): Promise<void> {
  const marks = [...container.querySelectorAll<HTMLElement>(".md-math:not([data-tp-rendered])")];
  if (marks.length === 0) return;

  let katex: Katex;
  try {
    katex = (await loadKatex()).default;
  } catch {
    // A chunk that will not load leaves the TeX as it was written. Unrendered math is still math.
    return;
  }
  if (cancelled()) return;

  for (const mark of marks) {
    if (!container.contains(mark)) continue;
    const html = katex.renderToString(mark.textContent ?? "", {
      displayMode: mark.hasAttribute("data-display"),
      // A mistake in the TeX is shown, in place, rather than thrown.
      throwOnError: false,
      // No \href, \url, \includegraphics or \htmlClass: nothing in a note may reach outside it.
      trust: false,
      strict: "ignore",
      output: "html",
      // Bounds on what one expression may cost, so a hostile macro cannot hang the window.
      maxExpand: 1000,
      maxSize: 100,
    });
    mark.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true } });
    mark.setAttribute("data-tp-rendered", "true");
  }
}

async function drawDiagrams(
  container: HTMLElement,
  cancelled: () => boolean,
  loadMermaid: RichBlockLoaders["mermaid"],
): Promise<void> {
  const blocks = [...container.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (blocks.length === 0) return;

  let mermaid: Mermaid;
  try {
    mermaid = (await loadMermaid()).default;
  } catch {
    return;
  }
  if (cancelled()) return;

  mermaid.initialize({
    startOnLoad: false,
    // Mermaid's own sanitising, and no click handlers or links in a diagram.
    securityLevel: "strict",
    // Mermaid 12's own look - redux colours, neo shapes, ELK layout - in its light or dark palette.
    // Only the palette is chosen here; the look and the layout are left to Mermaid's defaults, so a
    // diagram is drawn the way Mermaid 12 draws it everywhere else.
    theme: darkTheme() ? "redux-dark-color" : "redux-color",
    // Labels as SVG text rather than HTML inside foreignObject, which the SVG sanitiser would empty.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });

  for (const code of blocks) {
    const pre = code.parentElement;
    if (pre === null || !container.contains(pre)) continue;

    diagrams += 1;
    let svg: string;
    try {
      ({ svg } = await mermaid.render(`tp-mermaid-${diagrams}`, code.textContent ?? ""));
    } catch {
      // A diagram Mermaid cannot read stays as its source, which is where the mistake can be seen.
      continue;
    }
    if (cancelled() || !container.contains(pre)) return;

    const figure = document.createElement("div");
    figure.className = "md-mermaid";
    figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    pre.replaceWith(figure);
  }
}
