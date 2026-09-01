/// How the editor is currently drawn.
///
/// A mode is a VIEW, never a transform. The bytes on disk are identical in every mode, and switching
/// one must never write. That invariant is what lets a reader and a maintainer share a document, and
/// it is why there is no rich-text serialiser anywhere near a user's files.
///
/// "live" joins this union next - markers hidden except on the caret line. It is absent rather than
/// stubbed, so nothing offers a mode that does not exist yet.
export type EditorMode = "source" | "preview";

export const EDITOR_MODES: readonly EditorMode[] = ["source", "preview"];

export const MODE_LABELS: Record<EditorMode, string> = {
  source: "Source",
  preview: "Preview",
};

export const MODE_DESCRIPTIONS: Record<EditorMode, string> = {
  source: "Every character, colour-coded by role",
  preview: "Read-only rendered prose",
};

/// Preview is read-only. It is not an editor with editing switched off - there is no caret and no
/// gutter, because it stopped being an editing surface.
export function isEditable(mode: EditorMode): boolean {
  return mode === "source";
}
