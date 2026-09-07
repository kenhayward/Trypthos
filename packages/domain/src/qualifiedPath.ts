/// Paths that name the workspace they are in.
///
/// Several folders are open at once, so `docs/notes.md` no longer says which file it is - two
/// workspaces can each have one. A qualified path puts the workspace on the front:
/// `Notes/docs/notes.md`.
///
/// **Why a qualified string rather than a pair.** A path is already the identity of a tab, a tree
/// row, a link target and a chat attachment; making it a pair would change every one of those and
/// every function between them. It also matches what this app already does with the documents that
/// have no workspace - `trypthos:markdown-guide` and `trypthos:draft/1/notes.md` are reserved paths
/// on the same principle.
///
/// **The split happens here and nowhere else.** The renderer treats a qualified path as opaque and
/// the shell takes the workspace off the front exactly once, so there is one implementation of the
/// rule rather than one per caller - the same reason `workspacePath.ts` is the only boundary check.
/// What is left after the split is an ordinary workspace-relative path, and it goes through that
/// guard unchanged: qualifying a path adds a workspace to it, never permission.

const SEPARATOR = "/";

/// Paths that belong to no workspace: the built-in guide, and a document that has never been saved.
///
/// Reserved before this existed, and reserved in a way no folder can imitate: a workspace id is a
/// folder's name, and no filesystem this app runs on allows a colon in one.
const RESERVED_PREFIX = "trypthos:";

/// Puts the workspace on the front of a workspace-relative path.
///
/// The root is the workspace id alone, with no trailing separator - a root spelled `Notes/` and a
/// root spelled `Notes` would be two names for one place, and the tree keys folders by this.
export function qualifyPath(workspaceId: string, path: string): string {
  return path === "" ? workspaceId : `${workspaceId}${SEPARATOR}${path}`;
}

/// Takes the workspace off the front, or answers null when there is not one to take.
///
/// Null for a document with no workspace behind it, rather than a guess. The guide and a draft are
/// never read from or written to disk, so nothing should be asking - and a split that confidently
/// reported `trypthos:draft` as a workspace would send that guess somewhere it would be trusted.
export function splitQualified(qualified: string): { workspaceId: string; path: string } | null {
  if (qualified === "" || qualified.startsWith(SEPARATOR)) return null;
  if (qualified.startsWith(RESERVED_PREFIX)) return null;

  const cut = qualified.indexOf(SEPARATOR);
  if (cut === -1) return { workspaceId: qualified, path: "" };

  return { workspaceId: qualified.slice(0, cut), path: qualified.slice(cut + 1) };
}

/// What to call a newly opened workspace, given the ones already open.
///
/// The folder's own name, so a qualified path reads as something a person recognises - and so a tab
/// forced to disambiguate two files called `notes.md` shows `Notes/notes.md` rather than an opaque
/// token. It is an identity rather than a label, so it is deduplicated: two folders can share a
/// name, and two workspaces sharing an id would be two trees the app could not tell apart.
export function workspaceIdFor(name: string, taken: readonly string[]): string {
  // The separator is the one character an id may not contain, and a name is the one part of this
  // that comes off the user's disk. `:` goes too, so no name can imitate a reserved path.
  const cleaned = name.replace(/[/:]/g, "-").trim();
  const base = cleaned === "" ? "Folder" : cleaned;

  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}
