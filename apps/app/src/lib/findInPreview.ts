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

interface TextRun {
  node: Text;
  start: number;
  end: number;
}

/// Every text run of a rendered document, in reading order, with its position in that reading.
///
/// A tree walker rather than `querySelectorAll`, because the runs are what you get by reading the
/// element aloud - every piece of text in the order it appears, tags and all between them ignored.
function textRuns(root: Element): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    runs.push({ node, start: offset, end: offset + value.length });
    offset += value.length;
  }
  return runs;
}

function elementFor(html: string): HTMLDivElement {
  const root = document.createElement("div");
  // The html is already sanitised by `renderMarkdown` before it reaches here - this is the same
  // trust boundary that makes `dangerouslySetInnerHTML` acceptable in the preview.
  root.innerHTML = html;
  return root;
}

/// What a reader sees in a rendered document: its text, tags stripped, in reading order.
export function previewVisibleText(html: string): string {
  if (html === "") return "";
  // `textContent` is exactly the reading-order concatenation of every text run - the same sequence
  // `markPreviewMatches` walks - so an offset into this string is a position it understands.
  return elementFor(html).textContent ?? "";
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

  // Split every run at each boundary that falls inside it. Collected against the original runs, then
  // applied highest-first per run so an earlier offset stays valid as its neighbours are cut away -
  // which is why every split is made on the original node rather than a moving cursor.
  const runs = textRuns(root);
  const pointsByRun = new Map<Text, number[]>();
  for (const { from, to } of ranges) {
    for (const run of runs) {
      if (run.start < from && from < run.end) pushPoint(pointsByRun, run.node, from - run.start);
      if (run.start < to && to < run.end) pushPoint(pointsByRun, run.node, to - run.start);
    }
  }
  for (const [node, points] of pointsByRun) {
    for (const offset of [...points].sort((a, b) => b - a)) node.splitText(offset);
  }

  // Re-read the runs: every boundary now sits on an edge, so each match is a run of whole ones.
  const startToRun = new Map<number, Text>();
  const startToEnd = new Map<number, number>();
  for (const run of textRuns(root)) {
    if (!startToRun.has(run.start)) {
      startToRun.set(run.start, run.node);
      startToEnd.set(run.start, run.end);
    }
  }

  for (const { from, to } of ranges) {
    let position = from;
    while (position < to) {
      const node = startToRun.get(position);
      const end = startToEnd.get(position);
      if (node === undefined || end === undefined) break;
      wrapInMark(node);
      position = end;
    }
  }

  return root.innerHTML;
}

function pushPoint(points: Map<Text, number[]>, node: Text, offset: number): void {
  const list = points.get(node);
  if (list === undefined) points.set(node, [offset]);
  else list.push(offset);
}

/// Moves a run of text inside a mark. The words are untouched - only the element around them changes.
function wrapInMark(node: Text): void {
  const mark = document.createElement("span");
  // A span rather than `mark`, which this stylesheet already gives to an author's own `==highlight==`:
  // a search hit and a permanent emphasis are different things, and sharing one element would make
  // them indistinguishable on the page.
  mark.className = "cm-find-match";
  node.parentNode?.insertBefore(mark, node);
  mark.appendChild(node);
}
