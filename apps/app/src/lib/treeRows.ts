import { isHidden, isOpenable, sortNodes } from "@trypthos/domain";
import type { RemoteNode } from "./workspaceClient";

/// What is known about one folder in the tree.
///
/// Absent from the map means collapsed and never opened. Status lives per folder rather than per
/// panel because a cloud listing can fail or hang for one folder while the rest are fine - and a
/// spinner over the whole panel would hide the parts that worked.
export interface FolderState {
  status: "loading" | "loaded" | "error";
  children?: RemoteNode[];
}

export interface TreeRow {
  node: RemoteNode;
  depth: number;
  expanded: boolean;
  status: FolderState["status"] | null;
  /// Whether clicking this row does anything.
  ///
  /// False for a file no enabled type claims - a picture, an archive, or a type the user has turned
  /// off. It is LISTED rather than hidden, because a folder should look like what it is: a file
  /// that simply is not there gives nobody anything to act on, since "Trypthos will not open this"
  /// and "this does not exist" look identical. Always true for a folder; expanding one always
  /// works.
  openable: boolean;
}

/// Flattens the folder map into the rows to render, in order.
///
/// Pure, so the awkward parts - how deep a row sits, which folder is still loading - are all
/// testable without rendering a tree or touching a filesystem.
///
/// **Nothing here knows about the filter box.** A filter is answered by a search of the whole
/// folder, whose rows are built by `matchRows` from what came back. The two were one function once,
/// and it could only ever hide rows that were already on screen.
export function treeRows(
  folders: Record<string, FolderState>,
  enabled: readonly string[],
  /// Where to start: the key of the workspace's own root, which is its id.
  ///
  /// Several folders are open at once, and they share one map - keyed by qualified path, so the
  /// roots cannot collide. Each is walked separately, because they are separate trees on screen.
  root: string,
): TreeRow[] {
  const rowsFor = (path: string, depth: number): TreeRow[] => {
    const state = folders[path];
    const children = state?.children ?? [];

    return sortNodes(children).flatMap((node) => {
      // Dot-entries are noise in a document tree, and `.git` in particular is thousands of files
      // nobody opened this app to read. Not a security boundary - just not what the panel is for.
      if (isHidden(node.name)) return [];

      if (node.kind === "file") {
        return [
          {
            node,
            depth,
            expanded: false,
            status: null,
            openable: isOpenable(node.name, enabled),
          },
        ];
      }

      const child = folders[node.id];
      const expanded = child !== undefined && child.status !== "error";

      return [
        { node, depth, expanded, status: child?.status ?? null, openable: true },
        ...(child?.status === "loaded" ? rowsFor(node.id, depth + 1) : []),
      ];
    });
  };

  return rowsFor(root, 0);
}

/// Files on screen that can actually be opened.
///
/// The openable ones, not every row: the footer names the file types that are on and then counts,
/// so counting files those types do not cover would make the two halves of one sentence disagree.
///
/// Counts what is shown rather than what exists. A recursive count of a whole workspace is not free:
/// measured on a home directory it took 40 seconds across 113,000 folders, so a number that claimed
/// to cover the entire tree would either be a lie or a freeze.
export function visibleFileCount(rows: readonly TreeRow[]): number {
  return rows.filter((row) => row.node.kind === "file" && row.openable).length;
}

/// The rows a filter draws, built from the paths the search came back with.
///
/// A filter is a search of the whole folder rather than a sieve over the rows on screen, so what it
/// draws cannot come from the folder map: the matches are usually inside folders nobody has
/// expanded, and there is no listing of those to filter. The paths themselves carry the shape - a
/// match at `Notes/docs/deep/chapter.md` implies `docs` and `docs/deep` - so the tree is rebuilt
/// from them and nothing else is asked of the shell.
///
/// Every folder here is drawn open, because it exists only to say where a match is. Collapsing one
/// would be collapsing a search result, and the panel gives it nothing to click shut.
export function matchRows(
  paths: readonly string[],
  /// The workspace's own root, which is its id and the front of every path in it.
  root: string,
  enabled: readonly string[],
): TreeRow[] {
  interface Level {
    /// Sub-folders, keyed by segment, in insertion order until they are sorted.
    folders: Map<string, Level>;
    files: string[];
  }
  const top: Level = { folders: new Map(), files: [] };

  const prefix = `${root}/`;
  for (const path of paths) {
    // A path from another workspace would draw a row under the wrong tree. One search runs per open
    // folder, so this is the seam where two answers could be crossed.
    if (!path.startsWith(prefix)) continue;

    const segments = path.slice(prefix.length).split("/");
    const name = segments.pop();
    if (name === undefined || name === "") continue;

    let level = top;
    for (const segment of segments) {
      let next = level.folders.get(segment);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        level.folders.set(segment, next);
      }
      level = next;
    }
    if (!level.files.includes(name)) level.files.push(name);
  }

  const rowsFor = (level: Level, path: string, depth: number): TreeRow[] => {
    // Sorted through the same helper the tree uses, so a result list and the folder it came from are
    // in the same order - two orderings over one folder would read as two different folders.
    const entries = sortNodes([
      ...[...level.folders.keys()].map((name) => ({ name, kind: "directory" as const })),
      ...level.files.map((name) => ({ name, kind: "file" as const })),
    ]);

    return entries.flatMap((entry) => {
      const id = `${path}/${entry.name}`;

      if (entry.kind === "file") {
        return [
          {
            node: { id, name: entry.name, kind: "file" as const },
            depth,
            expanded: false,
            status: null,
            openable: isOpenable(entry.name, enabled),
          },
        ];
      }

      return [
        {
          node: { id, name: entry.name, kind: "directory" as const },
          depth,
          expanded: true,
          status: "loaded" as const,
          openable: true,
        },
        ...rowsFor(level.folders.get(entry.name)!, id, depth + 1),
      ];
    });
  };

  return rowsFor(top, root, 0);
}
