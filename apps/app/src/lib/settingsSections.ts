/// The pages of the settings dialog.
///
/// A list rather than a set of components, so the rail, the heading and the routing all read the
/// same order and cannot disagree about which pages exist. Keys, not wording: this module stays
/// pure and testable without rendering, and translation happens at the edge where a component
/// already has `t`.

export type SettingsSection =
  | "appearance"
  | "window"
  | "chatModels"
  | "ai"
  | "editor"
  | "about";

/// In rail order. About is last because it is set apart from the working settings above it - the
/// rail draws a separator before it, and a separator in the middle of the settings is a different
/// statement entirely.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "window",
  "chatModels",
  "ai",
  "editor",
  "about",
];

export const SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  appearance: "settings.section.appearance",
  window: "settings.section.window",
  chatModels: "settings.section.chatModels",
  ai: "settings.section.ai",
  editor: "settings.section.editor",
  about: "settings.section.about",
};
