import type { FindMatch } from "@trypthos/domain";

/// Highlighting what Find found in Preview mode, where there is no CodeMirror to decorate.
///
/// The editing surface shows the document's SOURCE and its find offsets are into that source, so a
/// match can be painted straight on. Preview shows the RENDERED prose instead - the same words with
/// their markdown scaffolding stripped away - so an offset into the source would land over nothing.
/// These two functions answer for that gap: they read the rendered document as its visible text (what
/// a reader actually sees) and wrap the ranges found in it, which is what makes a search while
/// reading highlight where the reader is rather than dragging them into another view to do it.
///
/// Both halves walk the very same characters - `previewVisibleText` is what Find searches and
/// `markPreviewMatches` wraps - so an offset one produces is a position the other understands. That
/// agreement is the whole thing: drift between them and a highlight sits over the wrong words, which
/// reads as an answer when it is not one.

/// What Preview draws as something other than its text, after the markup lands: maths is typeset from
/// its TeX, a diagram drawn from its code, an embed placeholder replaced by the note it names. Their
/// text here is not what a reader sees, and a mark wrapped into one is wiped when it is drawn - so
/// they are not searched. Counting a match there would report an answer that can never be shown, and
/// shift every later match's index off the mark it belongs to.
const DRAWN = ".md-math, pre > code.language-mermaid, .md-transclusion";

/// Stands in for a skipped element in the searched text. One character that nobody types, so the words
/// either side of a formula or a diagram are never read as one - a query cannot match across it.
const GAP = "\uFFFC";

interface TextRun {
  node: Text;
  start: number;
  end: number;
  /// The run as searched: its text, with a soft wrap read as the space a reader sees. Same length as
  /// the node's text, so offsets into one are offsets into the other.
  text: string;
}

/// Every searchable text run of a rendered document, in reading order, with its position in that
/// reading - and the whole reading as one string, gaps included.
function textRuns(root: Element): { runs: TextRun[]; text: string } {
  const runs: TextRun[] = [];
  let text = "";

  const visit = (node: Node, inPre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node as Text).nodeValue ?? "";
      // A line break inside a paragraph is where the source wrapped, not where the prose does - a
      // reader sees a space. Inside a code block it is a real break.
      const read = inPre ? value : value.replace(/\n/g, " ");
      runs.push({ node: node as Text, start: text.length, end: text.length + value.length, text: read });
      text += read;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(DRAWN)) {
      text += GAP;
      return;
    }
    const pre = inPre || element.tagName === "PRE";
    for (const child of [...element.childNodes]) visit(child, pre);
  };

  for (const child of [...root.childNodes]) visit(child, root.tagName === "PRE");
  return { runs, text };
}

/// The rendered markup as an element to read, in a document of its own.
///
/// A DOMParser document is inert: nothing in it loads or runs. Markup set on an element of the live
/// page, even a detached one, starts fetching every picture it names - here, on every search.
function elementFor(html: string): HTMLElement {
  // The html is already sanitised by `renderMarkdown` before it reaches here - this is the same
  // trust boundary that makes `dangerouslySetInnerHTML` acceptable in the preview.
  return new DOMParser().parseFromString(html, "text/html").body;
}

/// What a reader sees in a rendered document: its text, tags stripped, in reading order.
export function previewVisibleText(html: string): string {
  if (html === "") return "";
  return textRuns(elementFor(html)).text;
}

/// Wraps each found range in a mark, returning the document's markup with them painted on.
///
/// The ranges are offsets into `previewVisibleText`'s answer. A range can sit inside one run of text
/// or straddle the seam where an inline element ends - `bold` drawn as `<strong>bo</strong>ld` is two
/// runs to the markup but one word to a reader - so the runs are split at every range boundary first,
/// which leaves each match tiling whole runs rather than slicing through the middle of one.
export function markPreviewMatches(html: string, matches: readonly FindMatch[]): string {
  const ranges = matches.filter((match) => match.from >= 0 && match.to > match.from);
  if (html === "" || ranges.length === 0) return html;

  const root = elementFor(html);
  wrapRanges(root, ranges, () => "cm-find-match");
  return root.innerHTML;
}

/// Wraps each range of `root`'s searchable text in a span with the class `classFor` gives it.
function wrapRanges(
  root: Element,
  ranges: readonly FindMatch[],
  classFor: (index: number) => string,
): void {
  // Split every run at each boundary that falls inside it. Collected against the original runs, then
  // applied highest-first per run so an earlier offset stays valid as its neighbours are cut away -
  // which is why every split is made on the original node rather than a moving cursor.
  const { runs } = textRuns(root);
  const pointsByRun = new Map<Text, number[]>();
  for (const { from, to } of ranges) {
    for (const run of runs) {
      if (run.start < from && from < run.end) pushPoint(pointsByRun, run.node, from - run.start);
      if (run.start < to && to < run.end) pushPoint(pointsByRun, run.node, to - run.start);
    }
  }
  for (const [node, points] of pointsByRun) {
    for (const offset of [...new Set(points)].sort((a, b) => b - a)) node.splitText(offset);
  }

  // Re-read the runs: every boundary now sits on an edge, so each match is a run of whole ones.
  const startToRun = new Map<number, TextRun>();
  for (const run of textRuns(root).runs) {
    if (!startToRun.has(run.start)) startToRun.set(run.start, run);
  }

  ranges.forEach(({ from, to }, index) => {
    let position = from;
    while (position < to) {
      const run = startToRun.get(position);
      if (run === undefined) break;
      wrapInMark(run.node, classFor(index));
      position = run.end;
    }
  });
}

function pushPoint(points: Map<Text, number[]>, node: Text, offset: number): void {
  const list = points.get(node);
  if (list === undefined) points.set(node, [offset]);
  else list.push(offset);
}

/// Moves a run of text inside a mark. The words are untouched - only the element around them changes.
function wrapInMark(node: Text, className: string): void {
  const mark = node.ownerDocument.createElement("span");
  // A span rather than `mark`, which this stylesheet already gives to an author's own `==highlight==`:
  // a search hit and a permanent emphasis are different things, and sharing one element would make
  // them indistinguishable on the page.
  mark.className = className;
  node.parentNode?.insertBefore(mark, node);
  mark.appendChild(node);
}

/// A find mark inside an element, as a range of that element's text and the classes it wore.
export interface HeldMark {
  from: number;
  to: number;
  className: string;
}

/// The find marks inside `element`, so something that rebuilds it from its text - code colouring - can
/// put them back. Adjacent pieces of one match, split across inline elements, come back as one range.
export function findMarksIn(element: Element): HeldMark[] {
  const held: HeldMark[] = [];
  let offset = 0;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.nodeValue?.length ?? 0;
    const mark = node.parentElement?.closest(".cm-find-match");
    if (mark && element.contains(mark)) {
      const last = held.at(-1);
      if (last !== undefined && last.to === offset && last.className === mark.className) last.to += length;
      else held.push({ from: offset, to: offset + length, className: mark.className });
    }
    offset += length;
  }
  return held;
}

/// Wraps `held` marks back into `element` after it has been rebuilt from the same text.
export function restoreFindMarks(element: Element, held: readonly HeldMark[]): void {
  if (held.length === 0) return;
  wrapRanges(element, held, (index) => held[index]!.className);
}
