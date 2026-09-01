/// How the editor is currently drawn.
///
/// A mode is a VIEW, never a transform. The bytes on disk are identical in every mode, and switching
/// one must never write. That invariant is what lets a reader and a maintainer share a document, and
/// it is why there is no rich-text serialiser anywhere near a user's files.
///
export type EditorMode = "live" | "source" | "preview";

/// Live first, because it is the default and the one most people stay in.
export const EDITOR_MODES: readonly EditorMode[] = ["live", "source", "preview"];

export const MODE_LABELS: Record<EditorMode, string> = {
  live: "Live",
  source: "Source",
  preview: "Preview",
};

export const MODE_DESCRIPTIONS: Record<EditorMode, string> = {
  live: "Markers hidden except on the line you are editing",
  source: "Every character, colour-coded by role",
  preview: "Read-only rendered prose",
};

export const DEFAULT_MODE: EditorMode = "live";

/// Live and Source are the same editing surface with different decorations, which is why both are
/// editable and switching between them keeps undo history.
///
/// Preview is read-only. It is not an editor with editing switched off - there is no caret and no
/// gutter, because it stopped being an editing surface.
export function isEditable(mode: EditorMode): boolean {
  return mode !== "preview";
}
