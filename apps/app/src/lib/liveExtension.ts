import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { Range as CmRange } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import {
  consumesTrailingSpace,
  substituteFor,
  formatClassFor,
  isFollowClick,
  isHiddenMarker,
  revealedLines,
  type SyntaxRange,
} from "./liveDecorations";

type DecorationRange = CmRange<Decoration>;

/// Live mode as a CodeMirror extension.
///
/// Thin on purpose: every decision lives in liveDecorations.ts, where it can be tested without a DOM.
/// What is here is the plumbing - walking the syntax tree, and rebuilding when something that affects
/// the result changes.

const hidden = Decoration.replace({});

/// Renders a marker's stand-in glyph, currently only a list bullet.
///
/// A widget rather than CSS, because the character on screen is not the character in the file - and
/// `ignoreEvent: false` lets a click on the bullet place the caret, which then reveals the real
/// marker underneath. A widget that swallowed clicks would be a small dead zone on every list item.
class GlyphWidget extends WidgetType {
  constructor(private readonly glyph: string) {
    super();
  }

  override eq(other: GlyphWidget): boolean {
    return other.glyph === this.glyph;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = this.glyph;
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/// Where a hidden marker's range ends, extended past the whitespace a block marker owns.
///
/// Bounded to the marker's own line: a trailing space run must never swallow the newline and pull the
/// next line up into this one.
function hideTo(view: EditorView, range: SyntaxRange): number {
  if (!consumesTrailingSpace(range.name)) return range.to;

  const lineEnd = view.state.doc.lineAt(range.from).to;
  let to = range.to;
  while (to < lineEnd && view.state.doc.sliceString(to, to + 1) === " ") to += 1;
  return to;
}

/// Where a link's target is written on the rendered element.
const LINK_TARGET = "data-link-target";

/// A link's target, read out of the document.
///
/// Null for a reference link (`[text][ref]`), which has no URL of its own to read - the definition it
/// points at lives elsewhere in the document, and resolving that is a different job. Until then such
/// a link is text, which is the same graceful floor a construct with no decoration gets.
function linkTargetOf(view: EditorView, node: SyntaxNode): string | null {
  const url = node.getChild("URL");
  if (url === null) return null;

  // `<https://example.com>` is the angle-bracket form of the same target. The brackets are the
  // syntax, not part of the address.
  const text = view.state.doc.sliceString(url.from, url.to).trim().replace(/^<|>$/g, "");
  return text === "" ? null : text;
}

/// Following a link from the editing surface.
///
/// `mousedown` rather than `click`, because CodeMirror places the caret on mousedown: by the time a
/// click event arrives the selection has already moved, so the modified click would follow the link
/// AND scatter the caret into the middle of its text.
export function followLinks(options: {
  platform: "darwin" | "win32" | "linux";
  onFollow: (href: string) => void;
}) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (!isFollowClick(event, options.platform)) return false;

      const target = event.target;
      if (!(target instanceof Element)) return false;

      const href = target.closest(`[${LINK_TARGET}]`)?.getAttribute(LINK_TARGET);
      if (!href) return false;

      event.preventDefault();
      options.onFollow(href);
      return true;
    },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  // Collected then sorted, rather than appended to a RangeSetBuilder as the tree is walked. The walk
  // is in document order but nesting is not: a heading node starts at the same offset as its own
  // hash, so the parent's mark is produced before the child's replacement at an equal `from`. A
  // builder rejects that outright - "Ranges must be added sorted by from position and startSide" -
  // and it happens on the very first heading, so there is no subtle version of this bug.
  const collected: DecorationRange[] = [];
  const lineOf = (pos: number) => view.state.doc.lineAt(pos).number;
  const revealed = revealedLines(
    view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })),
    lineOf,
  );

  // The caret line gets a tint, so its revealed markers read as a state rather than as the document
  // having suddenly grown extra characters. A LINE decoration, added at the line start - a mark
  // spanning the line would not paint the full width past the end of the text.
  for (const line of revealed) {
    if (line < 1 || line > view.state.doc.lines) continue;
    const at = view.state.doc.line(line).from;
    collected.push(Decoration.line({ class: "cm-live-caret-line" }).range(at));
  }

  // Only the visible ranges: decorating the whole document would walk the entire tree on every
  // keystroke, which is what makes naive live-preview implementations crawl on long files.
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const parent = node.node.parent?.name ?? "Document";
        const range: SyntaxRange = { name: node.name, parent, from: node.from, to: node.to };

        // Zero-length nodes are rejected by both decoration kinds, and an empty heading produces one.
        if (node.to === node.from) return;

        const formatClass = formatClassFor(node.name);
        if (formatClass) {
          // A link's target is hidden in this mode, so it is put on the element instead: `title` is
          // the hover readout, which is the only way to see where a link goes without moving the
          // caret onto its line, and the data attribute is what a modified click reads.
          const target = node.name === "Link" ? linkTargetOf(view, node.node) : null;
          const spec =
            target === null
              ? { class: formatClass }
              : { class: formatClass, attributes: { title: target, [LINK_TARGET]: target } };
          collected.push(Decoration.mark(spec).range(node.from, node.to));
          // Deliberately no early return: the heading still has a hash inside it to hide.
        }

        if (revealed.has(lineOf(node.from))) return;

        const glyph = substituteFor(range.name, range.parent);
        if (glyph !== null) {
          collected.push(
            Decoration.replace({ widget: new GlyphWidget(glyph) }).range(node.from, node.to),
          );
          return;
        }

        if (isHiddenMarker(range.name, range.parent)) {
          collected.push(hidden.range(node.from, hideTo(view, range)));
        }
      },
    });
  }

  // `true` sorts. Doing it here rather than trusting the walk is the whole fix above.
  return Decoration.set(collected, true);
}

export function livePreview() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        // Selection is in the list because the caret moving between lines is precisely what reveals
        // and re-hides scaffolding - the mode does nothing visible without it.
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      // Hidden markers must not be atomic: the caret has to be able to move through a range that is
      // about to reveal itself, or arrowing into a heading would skip its own hash.
    },
  );
}

/// The rendered appearance. Live mode applies real formatting rather than colour, which is the
/// difference from Source: there a heading is blue, here it is big.
export const liveTheme = EditorView.theme({
  ".cm-live-h1": { fontSize: "1.5em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-live-h2": { fontSize: "1.3em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-live-h3": { fontSize: "1.15em", fontWeight: "600" },
  ".cm-live-h4": { fontWeight: "600" },
  ".cm-live-h5": { fontWeight: "600" },
  ".cm-live-h6": { fontWeight: "600" },
  ".cm-live-strong": { fontWeight: "700" },
  ".cm-live-em": { fontStyle: "italic" },
  ".cm-live-code": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    backgroundColor: "var(--color-sunken)",
    borderRadius: "3px",
    padding: "0.05em 0.3em",
  },
  ".cm-live-link": {
    color: "var(--color-leaf)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-live-quote": { color: "var(--color-tok-quote)", fontStyle: "italic" },
  ".cm-live-bullet": { color: "var(--color-ink-4)" },

  // The line the caret is on, tinted so the revealed markers read as a state rather than as the
  // document suddenly containing extra characters.
  ".cm-line.cm-live-caret-line": { backgroundColor: "var(--color-caret-line)" },
});

export const liveMode = [livePreview(), liveTheme];
