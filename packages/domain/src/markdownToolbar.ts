/// What each button on the editing toolbar does to the document.
///
/// Pure, and separate from the editor that dispatches the result: a toolbar button is a decision
/// about text - which markers to add, which to take away again, and where to leave the selection -
/// and none of that needs a rendered editor to be true. CodeMirror contributes the current document
/// and the current selection, and applies one change; every rule about what that change should be
/// lives here, where it can be read and tested as data.
///
/// **Every action is a toggle where a toggle makes sense.** A toolbar whose buttons only ever ADD
/// markers is a one-way trip: the way back is to delete the punctuation by hand, which is the work
/// the button existed to save. So bold on bold text removes it, and a heading pressed at its own
/// level goes back to a paragraph.
///
/// **Nothing here is a parser.** These are textual rules over the selection and the lines it
/// touches, not an understanding of the document - which is why the awkward pair of asterisks
/// (`*italic*` inside `**bold**`) is handled explicitly rather than falling out of a grammar.

export const TOOLBAR_ACTIONS = [
  "bold",
  "italic",
  "strikethrough",
  "code",
  "link",
  "image",
  "heading1",
  "heading2",
  "heading3",
  "quote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "table",
  "rule",
] as const;

export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

/// The actions that act on the selected characters. The rest act on whole lines or insert a block,
/// which is the split the toolbar draws as groups.
export const INLINE_ACTIONS: readonly ToolbarAction[] = [
  "bold",
  "italic",
  "strikethrough",
  "code",
  "link",
  "image",
];

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/// One replacement, and where the selection ends up afterwards.
///
/// Offsets in `selection` are into the document AS IT WILL BE, so the caller applies the change and
/// the selection in a single transaction - one undo step, and never a frame in which the selection
/// points into a document that no longer exists.
export interface ToolbarEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selection: TextRange;
}

/// The paired markers, for the actions that are nothing more than a pair.
const MARKERS: Record<"bold" | "italic" | "strikethrough" | "code", string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  code: "`",
};

/// Placeholders written into the document when there is nothing to use.
///
/// Content rather than interface text, which is why they are here and not in the translation
/// catalogue: they are typed over immediately, and the selection is placed on them precisely so
/// that the next keystroke replaces them.
const PLACEHOLDER = { text: "text", alt: "alt", url: "url" } as const;

const TABLE_BLOCK = "| Heading | Heading |\n| --- | --- |\n| Cell | Cell |\n";
const RULE_BLOCK = "---\n\n";

/// A word character, for the expansion below. Letters and digits in any script, because a document
/// is prose and prose is not ASCII.
const WORD = /[\p{L}\p{N}_]/u;

/// A list marker at the start of a line, with the indent that precedes it.
///
/// The task-list alternative comes first: `- [ ] one` matches the bullet alternative too, and a
/// bullet match would leave `[ ] one` behind as the content.
const LIST_MARKER = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
const QUOTE_MARKER = /^(\s*)> ?/;
const HEADING_MARKER = /^(\s*)(#{1,6}) /;

export function toolbarEdit(action: ToolbarAction, doc: string, range: TextRange): ToolbarEdit {
  switch (action) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "code":
      return wrapEdit(doc, range, MARKERS[action]);
    case "link":
      return linkEdit(doc, range, "");
    case "image":
      return linkEdit(doc, range, "!");
    case "heading1":
      return lineEdit(doc, range, heading(1));
    case "heading2":
      return lineEdit(doc, range, heading(2));
    case "heading3":
      return lineEdit(doc, range, heading(3));
    case "quote":
      return lineEdit(doc, range, QUOTE);
    case "bulletList":
      return lineEdit(doc, range, BULLET);
    case "orderedList":
      return lineEdit(doc, range, ORDERED);
    case "taskList":
      return lineEdit(doc, range, TASK);
    case "codeBlock":
      return fenceEdit(doc, range);
    case "table":
      return blockEdit(doc, range, TABLE_BLOCK, "Heading");
    case "rule":
      return blockEdit(doc, range, RULE_BLOCK, null);
  }
}

/// Wrapping, unwrapping, and the two ways a selection can already be wrapped.
///
/// Both directions matter, and the second is the one that is easy to miss: double-clicking a word
/// selects `this`, not `**this**`, so the markers to remove are the ones just OUTSIDE the range the
/// editor reports. A button that only checks inside the selection appears to work, and then adds a
/// second pair of asterisks to text that was already bold.
function wrapEdit(doc: string, range: TextRange, marker: string): ToolbarEdit {
  const target = range.from === range.to ? wordAround(doc, range.from) : range;
  const text = doc.slice(target.from, target.to);

  // Nothing to wrap at all: the pair goes in and the caret sits between the two halves, ready for
  // what the user is about to type.
  if (text === "") {
    const at = range.from;
    return {
      from: at,
      to: at,
      insert: marker + marker,
      selection: { from: at + marker.length, to: at + marker.length },
    };
  }

  if (wrappedInside(text, marker)) {
    const inner = text.slice(marker.length, text.length - marker.length);
    return {
      from: target.from,
      to: target.to,
      insert: inner,
      selection: { from: target.from, to: target.from + inner.length },
    };
  }

  if (wrappedOutside(doc, target, marker)) {
    const from = target.from - marker.length;
    return {
      from,
      to: target.to + marker.length,
      insert: text,
      selection: { from, to: from + text.length },
    };
  }

  return {
    from: target.from,
    to: target.to,
    insert: marker + text + marker,
    selection: {
      from: target.from + marker.length,
      to: target.from + marker.length + text.length,
    },
  };
}

/// Whether the text carries the markers itself.
function wrappedInside(text: string, marker: string): boolean {
  if (text.length < marker.length * 2) return false;
  if (!(text.startsWith(marker) && text.endsWith(marker))) return false;
  return marker !== "*" || isItalic(text);
}

/// Whether the markers sit immediately either side of the range.
function wrappedOutside(doc: string, range: TextRange, marker: string): boolean {
  const before = doc.slice(range.from - marker.length, range.from);
  const after = doc.slice(range.to, range.to + marker.length);
  if (before !== marker || after !== marker) return false;
  // A third asterisk beyond the pair means this is bold, or bold and italic together, and one star
  // taken off each side would leave a marker with no partner.
  if (marker === "*") return doc[range.from - 2] !== "*" && doc[range.to + 1] !== "*";
  return true;
}

/// Whether a run of asterisks around some text is italic's single pair rather than bold's double.
///
/// `**this**` is bold: stripping one star from each end leaves `*this*`, which still renders - as
/// something else entirely, in a file the user will not notice until they read it back. `***this***`
/// is both, and taking a star off each side genuinely does leave bold behind.
function isItalic(text: string): boolean {
  return !text.startsWith("**") || text.startsWith("***");
}

/// The word the caret is inside or against, or an empty range when it is on whitespace.
function wordAround(doc: string, at: number): TextRange {
  let from = at;
  let to = at;
  while (from > 0 && WORD.test(doc[from - 1]!)) from -= 1;
  while (to < doc.length && WORD.test(doc[to]!)) to += 1;
  return { from, to };
}

/// A link, an image, and the one case where the button takes a link apart again.
function linkEdit(doc: string, range: TextRange, prefix: string): ToolbarEdit {
  const target = range.from === range.to ? wordAround(doc, range.from) : range;
  const text = doc.slice(target.from, target.to);

  // Already a link, so the button unlinks it. Otherwise a second press would nest one link inside
  // another, which renders as neither.
  const existing = /^!?\[([^\]]*)\]\([^)]*\)$/.exec(text);
  if (existing !== null) {
    const label = existing[1]!;
    return {
      from: target.from,
      to: target.to,
      insert: label,
      selection: { from: target.from, to: target.from + label.length },
    };
  }

  // With text to link, the address is what the user still has to supply, so that is what is
  // selected. With nothing, the label comes first: it is the half they are more likely to know.
  const label = text === "" ? (prefix === "!" ? PLACEHOLDER.alt : PLACEHOLDER.text) : text;
  const insert = `${prefix}[${label}](${PLACEHOLDER.url})`;
  const labelAt = target.from + prefix.length + 1;
  const urlAt = labelAt + label.length + 2;

  return {
    from: target.from,
    to: target.to,
    insert,
    selection:
      text === ""
        ? { from: labelAt, to: labelAt + label.length }
        : { from: urlAt, to: urlAt + PLACEHOLDER.url.length },
  };
}

/// How one line is rewritten, and how to tell whether it has been already.
///
/// The pair is what makes every line action a toggle: the marker comes OFF when every line in the
/// selection already carries it, and goes ON otherwise. Judged over the whole selection rather than
/// line by line, so a mixed selection ends up uniform instead of inverted line for line.
interface LineRule {
  has(line: string): boolean;
  add(line: string, index: number): string;
  remove(line: string): string;
}

/// The content of a line, with any indent, list marker or quote marker taken off.
function bare(line: string): { indent: string; text: string } {
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(indent.length).replace(LIST_MARKER, "").replace(QUOTE_MARKER, "");
  return { indent, text: rest };
}

function heading(level: number): LineRule {
  const marker = "#".repeat(level);
  return {
    has: (line) => HEADING_MARKER.exec(line)?.[2] === marker,
    // Any existing heading marker is replaced rather than added to, so the button switches a line
    // between levels instead of stacking hashes on it.
    add: (line) => {
      const indent = /^\s*/.exec(line)![0];
      return `${indent}${marker} ${line.slice(indent.length).replace(HEADING_MARKER, "")}`;
    },
    remove: (line) => line.replace(HEADING_MARKER, "$1"),
  };
}

const QUOTE: LineRule = {
  has: (line) => QUOTE_MARKER.test(line),
  add: (line) => {
    const indent = /^\s*/.exec(line)![0];
    return `${indent}> ${line.slice(indent.length)}`;
  },
  remove: (line) => line.replace(QUOTE_MARKER, "$1"),
};

/// The three list rules differ only in the marker they write, and all three REPLACE whatever marker
/// a line already has - so pressing numbered on a bulleted list converts it rather than producing
/// `- 1. one`.
function listRule(marker: (index: number) => string, has: RegExp): LineRule {
  return {
    has: (line) => has.test(line),
    add: (line, index) => {
      const { indent, text } = bare(line);
      return `${indent}${marker(index)}${text}`;
    },
    remove: (line) => {
      const { indent, text } = bare(line);
      return `${indent}${text}`;
    },
  };
}

const BULLET = listRule(() => "- ", /^\s*[-*+] (?!\[[ xX]\] )/);
const ORDERED = listRule((index) => `${index + 1}. `, /^\s*\d+[.)] /);
const TASK = listRule(() => "- [ ] ", /^\s*[-*+] \[[ xX]\] /);

/// An action over whole lines: every line the selection touches, rewritten.
///
/// The selection afterwards is the whole rewritten span, which is the one answer that stays true
/// however much each line changed - the alternative, mapping the old offsets through, has to guess
/// whether the caret was before or after a marker that has just been replaced. A caret, having no
/// span to keep, moves with the line it is on instead.
function lineEdit(doc: string, range: TextRange, rule: LineRule): ToolbarEdit {
  const span = lineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");
  const off = lines.every((line) => rule.has(line));

  const next = lines.map((line, index) => (off ? rule.remove(line) : rule.add(line, index)));
  const insert = next.join("\n");

  if (range.from === range.to) {
    const shift = next[0]!.length - lines[0]!.length;
    // Clamped into the line: taking a marker off a line whose caret was inside that marker would
    // otherwise put the caret in the line above.
    const at = Math.max(span.from, range.from + shift);
    return { from: span.from, to: span.to, insert, selection: { from: at, to: at } };
  }

  return {
    from: span.from,
    to: span.to,
    insert,
    selection: { from: span.from, to: span.from + insert.length },
  };
}

/// A fenced code block: on if the selected lines are not already a fence, off if they are.
function fenceEdit(doc: string, range: TextRange): ToolbarEdit {
  const span = lineSpan(doc, range);
  const lines = doc.slice(span.from, span.to).split("\n");

  if (lines.length > 2 && isFence(lines[0]!) && isFence(lines.at(-1)!)) {
    const insert = lines.slice(1, -1).join("\n");
    return {
      from: span.from,
      to: span.to,
      insert,
      selection: { from: span.from, to: span.from + insert.length },
    };
  }

  const body = lines.join("\n");
  const insert = "```\n" + body + "\n```";
  const at = span.from + 4;
  return { from: span.from, to: span.to, insert, selection: { from: at, to: at + body.length } };
}

function isFence(line: string): boolean {
  return line.trimStart().startsWith("```");
}

/// A block that is inserted rather than toggled - a table, a horizontal rule.
///
/// It goes on the line the caret is on when that line is empty, and below it otherwise: a rule in
/// the middle of a paragraph is markdown that reads as a heading underline instead, and a table
/// pushed into the middle of a sentence is neither the sentence nor a table.
function blockEdit(
  doc: string,
  range: TextRange,
  block: string,
  placeholder: string | null,
): ToolbarEdit {
  const span = lineSpan(doc, range);
  const empty = doc.slice(span.from, span.to).trim() === "";

  const insert = empty ? block : `\n\n${block}`;
  const at = empty ? span.from : span.to;
  const start = at + insert.length - block.length;

  if (placeholder === null) {
    const end = at + insert.length;
    return { from: at, to: empty ? span.to : at, insert, selection: { from: end, to: end } };
  }

  const found = start + block.indexOf(placeholder);
  return {
    from: at,
    to: empty ? span.to : at,
    insert,
    selection: { from: found, to: found + placeholder.length },
  };
}

/// The whole of every line the range touches.
export function lineSpan(doc: string, range: TextRange): TextRange {
  const start = doc.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1;
  const ending = doc.indexOf("\n", range.to);
  return { from: start, to: ending === -1 ? doc.length : ending };
}
