import { newNoteDirectory } from "@trypthos/domain";
import type { GraphNode, GraphSnapshot } from "@trypthos/domain";
import { linkingNote } from "./graphFilters";

/// What double-clicking a node means, as data, shared by the global tab and the local pane.
///
/// A ghost is a note somebody linked to and nobody wrote, so its action is to create it - in the
/// folder Obsidian's own "default location for new notes" names, and named by the last part of the
/// link, since a file name cannot hold the folders a link like `[[Plans/Risks]]` spells out.

export type GraphNodeAction =
  | { kind: "open"; path: string }
  | { kind: "create"; directory: string; name: string }
  | null;

export function graphNodeAction(node: GraphNode, snapshot: GraphSnapshot): GraphNodeAction {
  if ((node.kind === "note" || node.kind === "attachment") && node.path !== null) return { kind: "open", path: node.path };
  if (node.kind !== "ghost") return null;
  const directory = newNoteDirectory(snapshot.newNotes, snapshot.workspaceId, linkingNote(snapshot, node.id));
  return { kind: "create", directory, name: node.label.slice(node.label.lastIndexOf("/") + 1) };
}
