import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tagHighlighter, tags, type Highlighter, type Tag } from "@lezer/highlight";
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

/// Which ROLE each syntax tag plays, as data.
///
/// One table, two consumers. The editor turns it into a CodeMirror `HighlightStyle`; Preview and
/// the chat panel turn it into a `tagHighlighter` that writes class names into rendered HTML.
/// Deriving both from one list is the only thing stopping the same code being one colour in the
/// editor and another three pixels away in Preview - and a drift like that is invisible until
/// somebody looks at the two side by side.
export interface TokenRole {
  tag: Tag;
  role: keyof typeof PALETTE;
  /// Comments and metadata. The one place this file departs from "colour, never formatting": a
  /// comment is not part of what the code does, and italic says so faster than a hue can.
  italic?: boolean;
}

export const TOKEN_ROLES: readonly TokenRole[] = [
  // The punctuation that makes markdown markdown. Dim, never hidden - this is Source mode.
  { tag: tags.processingInstruction, role: "marker" },
  { tag: tags.contentSeparator, role: "marker" },

  { tag: tags.heading, role: "heading" },
  { tag: tags.heading1, role: "heading" },
  { tag: tags.heading2, role: "heading" },
  { tag: tags.heading3, role: "heading" },

  { tag: tags.strong, role: "strong" },
  { tag: tags.emphasis, role: "strong" },

  { tag: tags.monospace, role: "code" },

  { tag: tags.link, role: "link" },
  { tag: tags.url, role: "link" },

  { tag: tags.quote, role: "quote" },
  // Deliberately no rule for tags.list: it covers the whole list ITEM, not the bullet, so styling it
  // dims the text of every list entry. The bullet is already covered by processingInstruction above.

  // Code, in the SAME style rather than a second one. Markdown's tags and these barely collide, one
  // style is one thing to reason about, and - the reason that actually decides it - a single style
  // means a fenced code block inside a markdown document is coloured by the same rules as a
  // standalone source file, without anybody arranging for that separately.
  { tag: tags.keyword, role: "keyword" },
  { tag: tags.controlKeyword, role: "keyword" },
  { tag: tags.modifier, role: "keyword" },
  { tag: tags.operatorKeyword, role: "keyword" },

  { tag: tags.string, role: "string" },
  { tag: tags.special(tags.string), role: "string" },
  { tag: tags.regexp, role: "string" },

  { tag: tags.comment, role: "comment", italic: true },
  { tag: tags.lineComment, role: "comment", italic: true },
  { tag: tags.blockComment, role: "comment", italic: true },

  { tag: tags.number, role: "number" },
  { tag: tags.bool, role: "number" },
  { tag: tags.null, role: "number" },
  { tag: tags.atom, role: "number" },

  { tag: tags.typeName, role: "type" },
  { tag: tags.className, role: "type" },
  { tag: tags.namespace, role: "type" },
  // The tag XML and HTML give an element name, and what a reader of markup is actually scanning for.
  { tag: tags.tagName, role: "type" },

  { tag: tags.function(tags.variableName), role: "func" },
  { tag: tags.function(tags.propertyName), role: "func" },
  // A JSON key, and an attribute name in HTML or XML. The single most useful thing to colour in a
  // configuration file, which is most of what this catalogue is for.
  { tag: tags.propertyName, role: "func" },
  { tag: tags.attributeName, role: "func" },

  { tag: tags.operator, role: "marker" },
  { tag: tags.punctuation, role: "marker" },
  // Italic like a comment, because that is what it is doing: `#!/bin/sh`, an XML declaration.
  { tag: tags.meta, role: "comment", italic: true },
];

export const markdownHighlighting = HighlightStyle.define(
  TOKEN_ROLES.map(({ tag, role, italic }) => ({
    tag,
    color: PALETTE[role],
    ...(italic === true ? { fontStyle: "italic" } : {}),
  })),
);

/// The same table, as class names for rendered HTML.
///
/// Preview and the chat panel have no CodeMirror to carry a theme, so the roles arrive as classes
/// and `index.css` resolves them to the same tokens `PALETTE` names. Classes rather than inline
/// styles because colour in this app lives in the stylesheet, and a code block is a lot of spans.
export const codeHighlighter: Highlighter = tagHighlighter(
  TOKEN_ROLES.map(({ tag, role }) => ({ tag, class: `tp-tok-${role}` })),
);

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
