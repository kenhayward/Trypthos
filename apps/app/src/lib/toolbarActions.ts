import type { ToolbarAction } from "@trypthos/domain";

/// What the formatting toolbar draws, and what each button is called.
///
/// The actions themselves live in the domain, because what a button DOES is a rule about text and
/// belongs where it can be tested without a rendered editor. What is here is the renderer's own
/// business: which translation key each button reads from, and the order and grouping they appear
/// in.
///
/// Keys, not wording - the same rule the view modes follow. The words live in the catalogue with
/// every other string a user reads, and this file stays a mapping that a test can check against the
/// set of actions.

export const ACTION_LABEL_KEYS: Record<ToolbarAction, string> = {
  bold: "editor.toolbar.bold",
  italic: "editor.toolbar.italic",
  strikethrough: "editor.toolbar.strikethrough",
  code: "editor.toolbar.code",
  link: "editor.toolbar.link",
  image: "editor.toolbar.image",
  heading1: "editor.toolbar.heading1",
  heading2: "editor.toolbar.heading2",
  heading3: "editor.toolbar.heading3",
  quote: "editor.toolbar.quote",
  bulletList: "editor.toolbar.bulletList",
  orderedList: "editor.toolbar.orderedList",
  taskList: "editor.toolbar.taskList",
  codeBlock: "editor.toolbar.codeBlock",
  table: "editor.toolbar.table",
  rule: "editor.toolbar.rule",
};

/// The buttons, in the order they appear, with a divider between each group.
///
/// Grouped by what a press acts on, because that is what tells a user which buttons need a
/// selection: the first group marks up the characters you have selected, the middle groups change
/// the lines the cursor is on, and the last inserts a block of its own.
export const TOOLBAR_GROUPS: readonly (readonly ToolbarAction[])[] = [
  ["bold", "italic", "strikethrough", "code"],
  ["link", "image"],
  ["heading1", "heading2", "heading3"],
  ["quote", "bulletList", "orderedList", "taskList"],
  ["codeBlock", "table", "rule"],
];
