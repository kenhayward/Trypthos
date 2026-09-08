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
  | "accounts"
  | "editor"
  | "fileTypes"
  | "about";

/// In rail order. About is last because it is set apart from the working settings above it - the
/// rail draws a separator before it, and a separator in the middle of the settings is a different
/// statement entirely.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "window",
  "chatModels",
  "ai",
  // After the chat models, because it is the other place a credential is entered - and before the
  // editor, which is where the settings turn from connections to how a document is drawn.
  "accounts",
  "editor",
  // Beside Editor, because it is the other half of the same question: Editor is how a document is
  // drawn, this is which documents there are.
  "fileTypes",
  "about",
];

export const SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  appearance: "settings.section.appearance",
  window: "settings.section.window",
  chatModels: "settings.section.chatModels",
  ai: "settings.section.ai",
  accounts: "settings.section.accounts",
  editor: "settings.section.editor",
  fileTypes: "settings.section.fileTypes",
  about: "settings.section.about",
};
