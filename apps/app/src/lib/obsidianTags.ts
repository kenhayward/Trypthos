import { Tag } from "@lezer/highlight";

/// Highlight tags for Obsidian's marks that markdown has no tag of its own for.
///
/// A module of their own, apart from the parser in `obsidianSyntax`, because two things need them at
/// different times: the editor's colour table, which is loaded with every editor, and the parser,
/// which is loaded only for an Obsidian document.
export const obsidianTags = {
  highlight: Tag.define(),
  tag: Tag.define(),
  math: Tag.define(),
  callout: Tag.define(),
};
