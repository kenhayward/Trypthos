/// Facts about the open document that the status bar reports.
///
/// Pure, so they can be tested exhaustively - and because both are shown to the user as plain claims
/// about their file, which means being wrong is worse than being absent.

/// A word is a run of letters, digits, apostrophes or hyphens.
///
/// Written as what a word IS rather than as "split on whitespace", because the latter counts markdown
/// syntax as content: `**bold**` becomes one word either way, but `---` and `***` become words too,
/// and a document of horizontal rules reports a word count it does not have.
///
/// Apostrophes and hyphens are inside the class so "don't" and "well-known" each count once, which is
/// what a person counting by eye would say.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

export type LineEnding = "LF" | "CRLF" | "Mixed";

/// What the file uses to end its lines.
///
/// Reported rather than assumed, because the status bar shows it as a fact about the user's file. A
/// document edited on both Windows and elsewhere genuinely is mixed, and saying so is more useful
/// than picking whichever appears first.
///
/// A file with no line break at all has no evidence either way; LF is the neutral answer and matches
/// what a new document is written with.
export function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  // Line feeds not preceded by a carriage return. A lone CR inside a line is not a line ending on any
  // platform this app targets, so it is not counted as evidence of anything.
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;

  if (crlf > 0 && lf > 0) return "Mixed";
  if (crlf > 0) return "CRLF";
  return "LF";
}
