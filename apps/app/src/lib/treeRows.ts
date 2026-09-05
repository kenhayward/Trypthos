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
/// Pure, so the awkward parts - what a filter hides, how deep a row sits, which folder is still
/// loading - are all testable without rendering a tree or touching a filesystem.
export function treeRows(
  folders: Record<string, FolderState>,
  filter: string,
  enabled: readonly string[],
): TreeRow[] {
  const query = filter.trim().toLowerCase();

  const rowsFor = (path: string, depth: number): TreeRow[] => {
    const state = folders[path];
    const children = state?.children ?? [];

    return sortNodes(children).flatMap((node) => {
      // Dot-entries are noise in a document tree, and `.git` in particular is thousands of files
      // nobody opened this app to read. Not a security boundary - just not what the panel is for.
      if (isHidden(node.name)) return [];

      if (node.kind === "file") {
        if (query !== "" && !node.name.toLowerCase().includes(query)) return [];
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

      // Folders survive a filter. What is inside an unexpanded one is unknown, so hiding it because
      // nothing visible matches would hide matches nobody has looked for yet.
      return [
        { node, depth, expanded, status: child?.status ?? null, openable: true },
        ...(child?.status === "loaded" ? rowsFor(node.id, depth + 1) : []),
      ];
    });
  };

  return rowsFor("", 0);
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
