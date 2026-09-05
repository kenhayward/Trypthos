/// Caret position, one-based on both axes.
///
/// CodeMirror numbers lines from one and columns from zero; the caller converts. Showing "Col 0" at
/// the start of a line would contradict every other editor a person has used.
export function formatCaret(line: number, column: number): string {
  return `Ln ${line}, Col ${column}`;
}
