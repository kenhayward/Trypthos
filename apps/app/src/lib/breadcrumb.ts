/// The path shown in the editor header, as segments.
///
/// Returned as segments rather than a joined string so the header can render its own separators - and
/// so it can ellipsise the middle of a deep path without cutting a name in half.
export function breadcrumbSegments(workspaceName: string | null, filePath: string | null): string[] {
  const parts = (filePath ?? "").split("/").filter((segment) => segment !== "");
  return workspaceName === null ? parts : [workspaceName, ...parts];
}

/// Caret position, one-based on both axes.
///
/// CodeMirror numbers lines from one and columns from zero; the caller converts. Showing "Col 0" at
/// the start of a line would contradict every other editor a person has used.
export function formatCaret(line: number, column: number): string {
  return `Ln ${line}, Col ${column}`;
}
