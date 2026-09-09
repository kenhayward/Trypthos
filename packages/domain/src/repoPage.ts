/// The repository page: which tab it is, and which file it shows.
///
/// A repository's own page is a **document identity like any other** - it names a tab, it is
/// read-only, and the document set holds it exactly as it holds the markdown guide. What it is not
/// is a file: nothing reads or writes this path, and `splitQualified` refuses the whole `trypthos:`
/// prefix, which is what keeps it out of every code path that would resolve it against a provider.
///
/// The statistics and the README are fetched by the page itself when it opens, rather than carried
/// in the document's `content`. A document's `content` is what the editor holds and what chat sends;
/// a repository's star count is neither.

/// The prefix every repository page path carries.
///
/// `trypthos:` is reserved and cannot be imitated by a workspace - a workspace id is a folder or
/// repository name, and `workspaceIdFor` strips the colon that would be needed to spell one.
export const REPO_PAGE_PREFIX = "trypthos:repo/";

/// The page for one open workspace.
///
/// Keyed by the workspace ID rather than by owner and repository, for the same reason every other
/// path is: the id is what the app already has in hand everywhere, it is unique among what is open,
/// and it is deduplicated - so two repositories called `notes` from different owners get two pages
/// rather than one they would have to share.
///
/// The id is also the last segment, which is what the tab strip shows - so the tab reads as the
/// repository's name rather than as an identifier.
export function repoPagePath(workspaceId: string): string {
  return `${REPO_PAGE_PREFIX}${workspaceId}`;
}

/// The workspace a repository page belongs to, or null when the path is not one.
export function repoPageWorkspaceId(path: string): string | null {
  if (!path.startsWith(REPO_PAGE_PREFIX)) return null;
  const id = path.slice(REPO_PAGE_PREFIX.length);
  return id === "" ? null : id;
}

export function isRepoPagePath(path: string): boolean {
  return repoPageWorkspaceId(path) !== null;
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
