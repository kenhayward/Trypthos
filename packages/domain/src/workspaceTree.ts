/// How the workspace tree is presented, separated from how it is read.
///
/// Pure, so it is shared by every storage backend rather than reimplemented per provider. A local
/// directory and a cloud folder disagree about almost everything underneath, but they must agree
/// about what the user sees: the same ordering, the same idea of what counts as hidden.

export interface TreeEntry {
  name: string;
  kind: "file" | "directory";
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);

/// Whether a name is a markdown file.
///
/// Matches the extension, not a substring: `archive.md.bak` ends in `.bak`, and offering to open a
/// backup as markdown is the kind of thing that looks like it works until someone saves over it.
export function isMarkdownFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/// Dot-prefixed entries. Not a security boundary - `.git` and `.env` are simply noise in a document
/// tree, and the user can still reach them by other means.
export function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/// Directories first, then files, each group ordered naturally.
///
/// "Natural" means `ch9` before `ch10`. Plain string comparison puts `ch10` first, which in a list of
/// chapters reads as the file browser being broken rather than as a sorting choice. `Intl.Collator`
/// with numeric ordering also gets case and accents right, which a hand-rolled comparison would not.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortNodes<T extends TreeEntry>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}
