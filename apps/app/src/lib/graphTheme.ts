import type { GraphNodeKind } from "@trypthos/domain";

/// The graph canvas's colours, read from the same tokens as the chrome around it.
///
/// Sigma draws in WebGL and cannot read a CSS variable, so the values are read with
/// `getComputedStyle` and handed over - and read again whenever the theme changes, which is why
/// `observeTheme` exists. A hex written here would be the second palette `index.css` warns about.

export interface GraphPalette {
  note: string;
  attachment: string;
  ghost: string;
  tag: string;
  edge: string;
  label: string;
  dim: string;
  pictogram: string;
  font: string;
}

export const GRAPH_TOKENS: Record<Exclude<keyof GraphPalette, "font">, string> = {
  note: "--tp-obsidian",
  attachment: "--tp-leaf",
  ghost: "--tp-ink-4",
  tag: "--tp-accent",
  edge: "--tp-rule",
  label: "--tp-ink-3",
  dim: "--tp-hairline",
  pictogram: "--tp-app",
};

export function readGraphPalette(style: { getPropertyValue(name: string): string }, font: string): GraphPalette {
  const read = (token: string) => style.getPropertyValue(token).trim();
  return {
    note: read(GRAPH_TOKENS.note),
    attachment: read(GRAPH_TOKENS.attachment),
    ghost: read(GRAPH_TOKENS.ghost),
    tag: read(GRAPH_TOKENS.tag),
    edge: read(GRAPH_TOKENS.edge),
    label: read(GRAPH_TOKENS.label),
    dim: read(GRAPH_TOKENS.dim),
    pictogram: read(GRAPH_TOKENS.pictogram),
    font,
  };
}

/// Calls `onChange` when the theme a user sees could have changed: an explicit choice stamped on the
/// root, or the OS setting flipping while "system" is chosen.
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  )}`;

/// One pictogram per kind, drawn in the disc in the palette's `pictogram` colour. A page for a note,
/// a picture for an attachment, a hash for a tag, and a plus on a ghost - the note it would create.
export const PICTOGRAMS: Record<GraphNodeKind, string> = {
  note: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  attachment: svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 16l4-4 4 4 3-3 5 5"/>'),
  tag: svg('<path d="M10 4L8 20M16 4l-2 16M5 9h15M4 15h15"/>'),
  ghost: svg('<path d="M12 6v12M6 12h12"/>'),
};
