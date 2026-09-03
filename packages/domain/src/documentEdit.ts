/// Turning an edit the model proposed into a range in the document.
///
/// This is where a mistake would do real damage: an anchor resolved to the wrong offset writes into
/// somebody's file at a plausible-looking place, and neither the panel nor a screenshot would show
/// anything wrong. So it is pure, it is here, and every case below is a test.
///
/// Two rules run through all of it:
///
///   - **Resolution happens at apply time, against the live document.** Not against the text the
///     model was sent. Between the question and the click the user may have renamed the heading,
///     deleted it, or moved it - and an offset computed from the old text would land anywhere.
///   - **Ambiguity refuses.** Two headings called "Objectives" means the edit does not apply. Taking
///     the first would insert into the wrong section while looking like it worked, which is the
///     worst outcome available.

export type EditOp =
  | "insert-before"
  | "insert-after"
  | "replace-section"
  | "replace-selection"
  | "append";

export interface ProposedEdit {
  op: EditOp;
  /// The heading this edit is anchored to, for the three heading ops. Null for the others.
  heading: string | null;
  content: string;
}

export interface Heading {
  level: number;
  /// The heading's text, with its hashes and any closing hashes removed.
  text: string;
  /// Offsets of the heading LINE, not of its section.
  from: number;
  to: number;
}

export type EditTarget =
  | { ok: true; from: number; to: number; insert: string }
  | { ok: false; reason: "heading-not-found" | "heading-ambiguous" | "no-selection" };

const ATX = /^(#{1,6})\s+(.*)$/;
/// An opening or closing code fence, and how long it is. CommonMark closes a fence only with a run
/// at least as long, which is what lets a ```` block contain ``` without ending early.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/// Every ATX heading in the document, in order.
///
/// Fenced code is skipped, and that is not a nicety: a markdown editor's documents are full of shell
/// samples, and `# not a heading` inside one would otherwise be an anchor - so an edit aimed at it
/// would insert a section into the middle of somebody's code block.
export function findHeadings(doc: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  /// The fence currently open, or null. Held as its text so the closing run can be measured.
  let fence: string | null = null;

  for (const line of doc.split("\n")) {
    const fenced = FENCE.exec(line);

    if (fence !== null) {
      // Only a run of the same character, at least as long as the opener, closes it.
      if (fenced !== null && fenced[1]![0] === fence[0] && fenced[1]!.length >= fence.length) {
        fence = null;
      }
    } else if (fenced !== null) {
      fence = fenced[1]!;
    } else {
      const heading = ATX.exec(line);
      if (heading !== null) {
        headings.push({
          level: heading[1]!.length,
          // A closed ATX heading ends in its own hashes, which are syntax rather than title.
          text: heading[2]!.replace(/\s*#*\s*$/, "").trim(),
          from: offset,
          to: offset + line.length,
        });
      }
    }

    offset += line.length + 1; // the newline the split consumed
  }

  return headings;
}

/// Heading names compare loosely: trimmed, case-folded, and with any leading hashes removed.
///
/// The model is asked for a name and will sometimes send the markdown for it instead. Refusing over
/// that would be pedantry at the user's expense, and "objectives" and "Objectives" are the same
/// heading to everyone except a string comparison.
function normaliseHeading(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s*#*\s*$/, "")
    .trim()
    .toLowerCase();
}

/// Where a heading's section ends: at the next heading of the same or higher level, or the end.
///
/// A subsection goes with its parent. Replacing "## A" when it contains "### A.1" has to take the
/// subsection too, because the subsection is part of the section being replaced.
function sectionEnd(doc: string, headings: Heading[], index: number): number {
  const level = headings[index]!.level;
  for (let next = index + 1; next < headings.length; next += 1) {
    if (headings[next]!.level <= level) return headings[next]!.from;
  }
  return doc.length;
}

/// Ensures the inserted text does not weld itself to what surrounds it.
///
/// Markdown is whitespace-sensitive between blocks: a heading on the line directly after a paragraph
/// is still a heading, but a paragraph directly after a paragraph is one paragraph. Getting this
/// wrong produces a document that looks subtly wrong in Preview and is annoying to unpick by hand.
function spaced(content: string, { before = "", after = "" }): string {
  return `${before}${content.trim()}${after}`;
}

export function resolveEdit(
  edit: ProposedEdit,
  document: { doc: string; selection: { from: number; to: number } | null },
): EditTarget {
  const { doc, selection } = document;

  if (edit.op === "replace-selection") {
    // The selection can be gone by the time Apply is pressed - the user clicked into the document to
    // read it before deciding. Writing at the caret instead would drop text at an arbitrary point.
    if (selection === null || selection.from === selection.to) return { ok: false, reason: "no-selection" };
    return { ok: true, from: selection.from, to: selection.to, insert: edit.content.trim() };
  }

  if (edit.op === "append") {
    // Only the trailing whitespace is replaced, never the whole document. A range covering
    // everything would round-trip the entire file through one CodeMirror change: a heavier undo
    // step than the edit deserves, and it would move the caret from wherever the user left it.
    // Trailing blank lines are absorbed rather than added to, so appending twice does not leave a
    // widening gap down the file.
    const trimmed = doc.replace(/\s*$/, "");
    return {
      ok: true,
      from: trimmed.length,
      to: doc.length,
      insert:
        trimmed === ""
          ? spaced(edit.content, { after: "\n" })
          : `\n\n${edit.content.trim()}\n`,
    };
  }

  const headings = findHeadings(doc);
  const wanted = normaliseHeading(edit.heading ?? "");
  const matches = headings
    .map((heading, index) => ({ heading, index }))
    .filter(({ heading }) => normaliseHeading(heading.text) === wanted);

  if (matches.length === 0) return { ok: false, reason: "heading-not-found" };
  if (matches.length > 1) return { ok: false, reason: "heading-ambiguous" };

  const { heading, index } = matches[0]!;

  if (edit.op === "insert-before") {
    // No leading newline at the very start of the document: it would strand a blank first line.
    return {
      ok: true,
      from: heading.from,
      to: heading.from,
      insert: spaced(edit.content, { after: "\n\n" }),
    };
  }

  if (edit.op === "insert-after") {
    return {
      ok: true,
      from: heading.to,
      to: heading.to,
      insert: spaced(edit.content, { before: "\n\n" }),
    };
  }

  // replace-section
  const end = sectionEnd(doc, headings, index);
  const trailing = doc.slice(end - 2, end) === "\n\n" ? "\n\n" : "\n";
  return {
    ok: true,
    from: heading.from,
    to: end,
    insert: end === doc.length ? spaced(edit.content, { after: "\n" }) : spaced(edit.content, { after: trailing }),
  };
}
