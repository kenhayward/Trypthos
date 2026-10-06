import type { FolderState } from "./treeRows";

/// Every Google Doc in a folder listed so far, by qualified path.
///
/// Looked up by id rather than read off a row, because a filter result and a tab are built from a
/// path alone - and would otherwise show the Doc as the `.md` it opens as.
export function googleDocIds(folders: Readonly<Record<string, FolderState>>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const state of Object.values(folders)) {
    for (const child of state.children ?? []) if (child.googleDoc === true) ids.add(child.id);
  }
  return ids;
}

/// The title a Google Doc is shown under: its last segment without the `.md` it opens as. Null when
/// `path` is not a Doc, so a caller falls back to its own name.
export function googleDocTitle(path: string, docs: ReadonlySet<string>): string | null {
  if (!docs.has(path)) return null;
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
