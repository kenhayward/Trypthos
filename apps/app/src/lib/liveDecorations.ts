/// The decisions Live mode makes, separated from the CodeMirror plumbing that applies them.
///
/// Live mode hides markdown's punctuation everywhere except the line the caret is on, which shows its
/// own scaffolding. The document is untouched throughout: hiding is a decoration, so the characters
/// are still there, still saved, still exactly what Source mode shows.
///
/// Kept pure so the rules can be tested without a DOM. CodeMirror measures text to decide what to
/// render, and jsdom has no geometry, so anything asserted through the rendered editor would be
/// testing the harness rather than the rules.

export interface SyntaxRange {
  /// Syntax node name from the markdown parser, e.g. "HeaderMark".
  name: string;
  /// The enclosing node's name. Needed because one marker name serves several constructs.
  parent: string;
  from: number;
  to: number;
}

export interface Range {
  from: number;
  to: number;
}

/// Markers hidden regardless of what encloses them.
const ALWAYS_HIDDEN = new Set(["HeaderMark", "EmphasisMark", "QuoteMark", "LinkMark"]);

/// Content nodes and the class that gives them their rendered appearance.
const FORMAT_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-live-h1",
  ATXHeading2: "cm-live-h2",
  ATXHeading3: "cm-live-h3",
  ATXHeading4: "cm-live-h4",
  ATXHeading5: "cm-live-h5",
  ATXHeading6: "cm-live-h6",
  StrongEmphasis: "cm-live-strong",
  Emphasis: "cm-live-em",
  InlineCode: "cm-live-code",
  Link: "cm-live-link",
  Blockquote: "cm-live-quote",
};

/// Whether this node is punctuation Live mode hides.
///
/// The parent matters in two places, and both are easy to get wrong by matching on name alone:
///
///  - `CodeMark` is the backtick of an inline span AND the fence of a code block. Fenced code has no
///    decoration yet, so hiding its fences would leave a block that is neither rendered nor readable.
///    Until a construct has a decoration it renders as source - a floor, deliberately.
///  - `URL` is a link's target, which is hidden so the link reads as its text. Elsewhere a bare URL
///    is the content itself and must stay.
export function isHiddenMarker(name: string, parent: string): boolean {
  if (ALWAYS_HIDDEN.has(name)) return true;
  if (name === "CodeMark") return parent === "InlineCode";
  if (name === "URL") return parent === "Link";
  return false;
}

/// Whether this marker owns the whitespace that follows it.
///
/// "# " is the heading syntax - the hash AND its space. Hiding only the hash leaves every heading and
/// every blockquote indented by one space, which reads as a wobbly left margin rather than as a bug,
/// and so survives review easily. Inline markers sit flush against their content and own nothing.
export function consumesTrailingSpace(name: string): boolean {
  return name === "HeaderMark" || name === "QuoteMark";
}

export function formatClassFor(name: string): string | null {
  return FORMAT_CLASSES[name] ?? null;
}

/// Every line touched by the selection.
///
/// Whole lines, not just the ends: a selection spanning three lines reveals all three, because the
/// text being worked on is the text whose markers you need to see.
export function revealedLines(
  selections: readonly Range[],
  lineOf: (pos: number) => number,
): Set<number> {
  const lines = new Set<number>();
  for (const selection of selections) {
    const first = lineOf(selection.from);
    const last = lineOf(selection.to);
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

/// The ranges to hide: every hideable marker not on a revealed line.
///
/// Sorted by position, because a decoration set must be built in document order - out of order it
/// throws at construction rather than rendering wrongly, but only for documents that happen to
/// produce one, so relying on the parser's order would be a latent trap.
export function markersToHide(
  nodes: readonly SyntaxRange[],
  lineOf: (pos: number) => number,
  revealed: ReadonlySet<number>,
): Range[] {
  return nodes
    .filter((node) => isHiddenMarker(node.name, node.parent))
    .filter((node) => !revealed.has(lineOf(node.from)))
    .map((node) => ({ from: node.from, to: node.to }))
    .sort((a, b) => a.from - b.from);
}
