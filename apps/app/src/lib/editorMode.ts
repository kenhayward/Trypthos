/// The editor's view modes, as the renderer needs them.
///
/// The modes themselves live in the domain, because a stored setting names one and the schema that
/// reads it must agree with the switcher that draws it. What is here is the part that is the
/// renderer's own business: which translation key each mode reads from.
export {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  isEditable,
  type EditorMode,
} from "@trypthos/domain";

import type { EditorMode } from "@trypthos/domain";

/// Translation keys, not wording. Keeping the mapping here means the set of modes and the set of
/// labels cannot drift apart, while the words themselves live in the catalogue with every other
/// string a user reads.
export const MODE_LABEL_KEYS: Record<EditorMode, string> = {
  live: "editor.mode.live",
  source: "editor.mode.source",
  preview: "editor.mode.preview",
};

export const MODE_HINT_KEYS: Record<EditorMode, string> = {
  live: "editor.modeHint.live",
  source: "editor.modeHint.source",
  preview: "editor.modeHint.preview",
};
