import { syntaxTree } from "@codemirror/language";
import type { Range as CmRange } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import {
  consumesTrailingSpace,
  formatClassFor,
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
          collected.push(Decoration.mark({ class: formatClass }).range(node.from, node.to));
          // Deliberately no early return: the heading still has a hash inside it to hide.
        }

        if (isHiddenMarker(range.name, range.parent) && !revealed.has(lineOf(node.from))) {
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
});

export const liveMode = [livePreview(), liveTheme];
