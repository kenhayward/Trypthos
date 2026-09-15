import { FILE_TYPES } from "./fileTypes";

/// Obsidian's internal links, `[[Note#Heading|shown text]]`, and which file one means.
///
/// Obsidian finds a note by its NAME anywhere in the vault rather than by a path from the linking
/// note, so resolving one is a search rather than a walk. The search itself happens in the shell,
/// through the guarded name filter; what is here is reading the link and choosing among the matches.

export interface WikiLink {
  /// The note or file named, as written. Empty for a link within the same note (`[[#Heading]]`).
  target: string;
  /// The heading linked to - the last one written, for `[[Note#Section#Subsection]]`.
  heading: string | null;
  /// The block id linked to, without its caret.
  block: string | null;
  /// What is shown instead of the target. For an embedded image, its size (`100` or `100x145`).
  alias: string | null;
}

export function parseWikiLink(inner: string): WikiLink {
  const bar = inner.indexOf("|");
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim();
  const [target = "", ...parts] = (bar === -1 ? inner : inner.slice(0, bar)).split("#");
  const last = parts.at(-1)?.trim() ?? null;

  return {
    target: target.trim(),
    heading: last !== null && !last.startsWith("^") && last !== "" ? last : null,
    block: last !== null && last.startsWith("^") ? last.slice(1) : null,
    alias: alias === "" ? null : alias,
  };
}

/// Extensions a wiki link names a file by: everything the app knows a type for, plus what Obsidian
/// embeds that the app does not open. A dot followed by anything else is part of a note's name.
const FILE_EXTENSIONS = new Set([
  ...FILE_TYPES.flatMap((type) => type.extensions),
  "pdf",
  "canvas",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "webm",
  "mp4",
  "mov",
]);

/// The file a wiki link's target names: a note's name gains `.md`, a file named with its extension
/// keeps it.
export function wikiLinkFileName(target: string): string {
  const name = target.slice(target.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  return FILE_EXTENSIONS.has(extension) ? target : `${target}.md`;
}

/// Which of the files a name search found this link means, or null for none.
///
/// `found` are qualified paths and `fileName` what `wikiLinkFileName` made of the link. A match is a
/// file whose path ENDS with the link's own path, ignoring case - the whole name, so `Plan.md` is not
/// `MyPlan.md`, and every folder the link names. Among several, the one in the linking note's own
/// folder wins, then the shortest path, which is how Obsidian prefers the nearest note.
export function pickWikiTarget(
  found: readonly string[],
  fileName: string,
  fromPath: string | null,
): string | null {
  const wanted = fileName.toLowerCase().replace(/^\/+/, "");
  const matches = found.filter((path) => {
    const lower = path.toLowerCase();
    return lower.endsWith(`/${wanted}`);
  });
  if (matches.length === 0) return null;

  const folder = fromPath === null ? null : fromPath.slice(0, fromPath.lastIndexOf("/") + 1).toLowerCase();
  const beside = folder === null ? undefined : matches.find((path) => {
    const lower = path.toLowerCase();
    return lower.startsWith(folder) && !lower.slice(folder.length).includes("/");
  });
  if (beside !== undefined) return beside;

  return [...matches].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.length - b.length,
  )[0]!;
}
