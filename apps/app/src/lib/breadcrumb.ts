/// What the editor header calls the document: its own name, not the path to it.
///
/// The header used to draw the whole path as segments. A long workspace or folder name then had
/// nowhere to go - the leading segments could not shrink, so they overflowed their spans and printed
/// over the next one, and the result was unreadable rather than merely long. The name is what
/// identifies a document; where it lives is in the tree beside it, and in the header's tooltip.
export function documentName(filePath: string | null): string | null {
  const parts = (filePath ?? "").split("/").filter((segment) => segment !== "");
  return parts.at(-1) ?? null;
}

/// Caret position, one-based on both axes.
///
/// CodeMirror numbers lines from one and columns from zero; the caller converts. Showing "Col 0" at
/// the start of a line would contradict every other editor a person has used.
export function formatCaret(line: number, column: number): string {
  return `Ln ${line}, Col ${column}`;
}
