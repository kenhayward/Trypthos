import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/// Source-mode colouring.
///
/// The organising idea: in Source mode colour STANDS IN for formatting rather than applying it.
/// Nothing is resized, bolded or italicised here - a heading is blue, not big. That is what makes
/// Source a faithful view of the bytes: every character is on screen at the same size, and the only
/// thing added is a hint about each one's role.
///
/// Markers (`#`, `**`, backticks, `>`) are deliberately the dimmest thing on screen. They are
/// scaffolding, and in Live mode they will disappear entirely except on the caret line.
const PALETTE = {
  marker: "#9aa3b0",
  heading: "#2a5d9f",
  strong: "#b0651e",
  code: "#a6386b",
  link: "#2e7d6b",
  quote: "#6b6280",
};

export const markdownHighlighting = HighlightStyle.define([
  // The punctuation that makes markdown markdown. Dim, never hidden - this is Source mode.
  { tag: tags.processingInstruction, color: PALETTE.marker },
  { tag: tags.contentSeparator, color: PALETTE.marker },

  { tag: tags.heading, color: PALETTE.heading },
  { tag: tags.heading1, color: PALETTE.heading },
  { tag: tags.heading2, color: PALETTE.heading },
  { tag: tags.heading3, color: PALETTE.heading },

  { tag: tags.strong, color: PALETTE.strong },
  { tag: tags.emphasis, color: PALETTE.strong },

  { tag: tags.monospace, color: PALETTE.code },

  { tag: tags.link, color: PALETTE.link },
  { tag: tags.url, color: PALETTE.link },

  { tag: tags.quote, color: PALETTE.quote },
  // Deliberately no rule for tags.list: it covers the whole list ITEM, not the bullet, so styling it
  // dims the text of every list entry. The bullet is already covered by processingInstruction above.
]);

/// Layout only - no colour decisions here beyond the chrome, so the palette above stays the single
/// place a token's meaning is expressed.
export const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    padding: "12px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "#c2c8d0",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export const editorTheme: Extension = [editorChrome, syntaxHighlighting(markdownHighlighting)];
