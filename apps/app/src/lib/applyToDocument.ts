/// Puts a resolved edit into the open document, or says it could not.
///
/// A read-only document is refused FIRST, before the editor is touched: a mounted CodeMirror blocks
/// typing but not a programmatic change, so asking it anyway would change what is on screen while the
/// document state ignored the edit - a card that says Applied over text that can never be saved.
export function applyToDocument(args: {
  readOnly: boolean;
  content: string;
  target: { from: number; to: number; insert: string };
  /// The live editor's change, or undefined/false when none is mounted (Preview).
  applyInEditor: (from: number, to: number, insert: string) => boolean | undefined;
  /// The same path typing takes, for a document with no editor mounted.
  commit: (text: string) => void;
}): boolean {
  const { readOnly, content, target, applyInEditor, commit } = args;
  if (readOnly) return false;
  if (applyInEditor(target.from, target.to, target.insert) === true) return true;
  commit(content.slice(0, target.from) + target.insert + content.slice(target.to));
  return true;
}
