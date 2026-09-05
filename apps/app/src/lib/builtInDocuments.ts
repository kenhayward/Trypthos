import { GUIDE_PATH } from "@trypthos/domain";

/// Documents the app carries rather than reads from a folder, and what they are called.
///
/// A built-in document is identified by a path like any other - that is what makes it a tab, a
/// selection and a document set entry without a special case anywhere in the domain. What it cannot
/// borrow from its path is its NAME: the last segment of `trypthos:markdown-guide` is not something
/// to put on a tab, and the name a user reads has to come from the catalogue like every other
/// string.
///
/// Keys, not wording, so this stays a mapping the guard test can check and the components translate
/// at the edge where they already have `t`.
const TITLE_KEYS: Record<string, string> = {
  [GUIDE_PATH]: "editor.guide",
};

/// The translation key naming this document, or null for an ordinary file - whose name is its own.
export function builtInTitleKey(path: string | null): string | null {
  if (path === null) return null;
  return TITLE_KEYS[path] ?? null;
}
