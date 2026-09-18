/// A workspace's home page: its heading, its counts, its README and its graph, in one tab.
///
/// A document identity like the markdown guide, never a file. It replaced two earlier pages - the
/// repository page and the vault graph - which each had a prefix of their own. Open documents are not
/// persisted between runs, so nothing had to migrate: those prefixes are simply gone.
///
/// `splitQualified` refuses the whole `trypthos:` prefix, which is what keeps this path away from
/// every provider however it arrives.

export const HOME_PAGE_PREFIX = "trypthos:home/";

export function homePagePath(workspaceId: string): string {
  return `${HOME_PAGE_PREFIX}${workspaceId}`;
}

export function homePageWorkspaceId(path: string): string | null {
  if (!path.startsWith(HOME_PAGE_PREFIX)) return null;
  const id = path.slice(HOME_PAGE_PREFIX.length);
  return id === "" ? null : id;
}

export function isHomePagePath(path: string): boolean {
  return homePageWorkspaceId(path) !== null;
}

/// The extensions a README is rendered from.
///
/// Markdown only, and deliberately so: this app renders markdown, and a `.rst` shown as source would
/// be worse than saying there is nothing to show. A bare `README` is included because it is
/// overwhelmingly markdown in practice and renders acceptably as prose either way.
const README_EXTENSIONS = ["", ".md", ".markdown", ".mdown", ".mkd"];

function isReadmeName(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.startsWith("readme")) return false;
  return README_EXTENSIONS.includes(lower.slice("readme".length));
}

/// The README among a directory's entries, or null when there is not one.
///
/// Matched without regard to case, because repositories spell it every way and GitHub itself does
/// the same - a page showing nothing for `readme.md` would look broken rather than empty.
///
/// **Deterministic when there is more than one.** Shortest first, then alphabetical: a repository
/// holding both `README.md` and `README.markdown` must show the same one on every open rather than
/// whichever the listing happened to put first.
export function readmeNameIn(
  entries: readonly { name: string; kind: "file" | "directory" }[],
): string | null {
  const found = entries
    .filter((entry) => entry.kind === "file" && isReadmeName(entry.name))
    .map((entry) => entry.name)
    .sort((one, other) => one.length - other.length || one.localeCompare(other));

  return found[0] ?? null;
}
