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
/// Every value is a token, not a hex. CodeMirror themes are CSS, so the editor resolves the same
/// variables as the chrome around it - which is the only reason the two stay in step across themes.
/// A hex here would be a second palette that only ever matched in the theme it was written for.
const PALETTE = {
  marker: "var(--color-marker)",
  heading: "var(--color-tok-head)",
  strong: "var(--color-tok-strong)",
  code: "var(--color-tok-code)",
  link: "var(--color-leaf)",
  quote: "var(--color-tok-quote)",
  keyword: "var(--color-tok-keyword)",
  string: "var(--color-tok-string)",
  comment: "var(--color-tok-comment)",
  number: "var(--color-tok-number)",
  type: "var(--color-tok-type)",
  func: "var(--color-tok-func)",
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

  // Code, in the SAME style rather than a second one. Markdown's tags and these barely collide, one
  // style is one thing to reason about, and - the reason that actually decides it - a single style
  // means a fenced code block inside a markdown document is coloured by the same rules as a
  // standalone source file, without anybody arranging for that separately.
  { tag: tags.keyword, color: PALETTE.keyword },
  { tag: tags.controlKeyword, color: PALETTE.keyword },
  { tag: tags.modifier, color: PALETTE.keyword },
  { tag: tags.operatorKeyword, color: PALETTE.keyword },

  { tag: tags.string, color: PALETTE.string },
  { tag: tags.special(tags.string), color: PALETTE.string },
  { tag: tags.regexp, color: PALETTE.string },

  { tag: tags.comment, color: PALETTE.comment, fontStyle: "italic" },
  { tag: tags.lineComment, color: PALETTE.comment, fontStyle: "italic" },
  { tag: tags.blockComment, color: PALETTE.comment, fontStyle: "italic" },

  { tag: tags.number, color: PALETTE.number },
  { tag: tags.bool, color: PALETTE.number },
  { tag: tags.null, color: PALETTE.number },
  { tag: tags.atom, color: PALETTE.number },

  { tag: tags.typeName, color: PALETTE.type },
  { tag: tags.className, color: PALETTE.type },
  { tag: tags.namespace, color: PALETTE.type },
  // The tag XML and HTML give an element name, and what a reader of markup is actually scanning for.
  { tag: tags.tagName, color: PALETTE.type },

  { tag: tags.function(tags.variableName), color: PALETTE.func },
  { tag: tags.function(tags.propertyName), color: PALETTE.func },
  // A JSON key, and an attribute name in HTML or XML. The single most useful thing to colour in a
  // configuration file, which is most of what this catalogue is for.
  { tag: tags.propertyName, color: PALETTE.func },
  { tag: tags.attributeName, color: PALETTE.func },

  { tag: tags.operator, color: PALETTE.marker },
  { tag: tags.punctuation, color: PALETTE.marker },
  // Italic like a comment, because that is what it is doing: `#!/bin/sh`, an XML declaration.
  { tag: tags.meta, color: PALETTE.comment, fontStyle: "italic" },
]);

/// Layout only - no colour decisions here beyond the chrome, so the palette above stays the single
/// place a token's meaning is expressed.
export const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  "&, .cm-content": {
    color: "var(--color-ink-2)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-ink)",
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
    color: "var(--color-gutter)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export const editorTheme: Extension = [editorChrome, syntaxHighlighting(markdownHighlighting)];
