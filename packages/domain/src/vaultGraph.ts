import { MARKDOWN_FILE_TYPE, matchesFileType } from "./fileTypes";
import { qualifyPath, splitQualified } from "./qualifiedPath";
import type { NoteReference, NoteReferences } from "./vaultLinks";
import { pickWikiTarget, wikiLinkFileName } from "./wikiLink";

/// The vault graph: every file, tag and unresolved link as a node, every link as an edge.
///
/// **Built from the index input, never patched in place.** The shell keeps the file list and each
/// note's references, applies a change to those, and builds again. A build is linear in the vault,
/// and one function that turns an input into a graph is one thing to prove correct - a patcher and
/// a builder would be two that have to agree.
///
/// **Sorted output.** The layout seeds positions from node order, so the same vault must give the
/// same arrays whatever order the disk listed it in.

export type GraphNodeKind = "note" | "attachment" | "ghost" | "tag";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  path: string | null;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  both: boolean;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VaultIndexInput {
  files: readonly string[];
  references: ReadonlyMap<string, NoteReferences>;
}

export type IndexChange =
  | { kind: "written"; path: string; references: NoteReferences | null }
  | { kind: "renamed"; from: string; to: string };

export const EMPTY_INDEX: VaultIndexInput = { files: [], references: new Map() };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function isNotePath(path: string): boolean {
  return matchesFileType(MARKDOWN_FILE_TYPE, nameOf(path));
}

function withoutMarkdownExtension(name: string): string {
  return isNotePath(name) ? name.slice(0, name.lastIndexOf(".")) : name;
}

/// A markdown link's target against the linking note's folder, or null when it leaves the vault.
function resolveRelative(fromPath: string, target: string): string | null {
  const from = splitQualified(fromPath);
  if (from === null) return null;
  const segments = target.startsWith("/") ? [] : from.path.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? null : qualifyPath(from.workspaceId, segments.join("/"));
}

export function buildGraph(input: VaultIndexInput): VaultGraph {
  const files = [...input.files].sort(byCodeUnit);
  const byLowerPath = new Map(files.map((file) => [file.toLowerCase(), file]));
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const key = nameOf(file).toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), file]);
  }

  const nodes = new Map<string, GraphNode>();
  for (const file of files) {
    const name = nameOf(file);
    nodes.set(file, {
      id: file,
      kind: isNotePath(file) ? "note" : "attachment",
      label: isNotePath(file) ? withoutMarkdownExtension(name) : name,
      path: file,
      degree: 0,
    });
  }

  /// A ghost is keyed off a target minus any markdown extension. A wiki link keys off the target AS
  /// WRITTEN - `[[Plans/Risks]]` and `[[risks]]` still share a ghost by lowercasing, but the label
  /// keeps the writer's spelling. A markdown link instead keys off its RESOLVED vault-relative path
  /// (see below), because the written form is not canonical the way a wiki target is: `./Risks.md`,
  /// `Risks.md` and `/Risks.md` from the same folder are the same missing note, and keying on what
  /// was typed would mint one ghost per spelling instead of one per note.
  const ghost = (written: string): string => {
    const label = withoutMarkdownExtension(written);
    const id = `ghost:${label.toLowerCase()}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: "ghost", label, path: null, degree: 0 });
    return id;
  };

  const resolve = (from: string, reference: NoteReference): string | null => {
    if (reference.kind === "wiki") {
      const fileName = wikiLinkFileName(reference.target);
      const candidates = byName.get(nameOf(fileName).toLowerCase()) ?? [];
      return pickWikiTarget(candidates, fileName, from) ?? ghost(reference.target);
    }
    const resolved = resolveRelative(from, reference.path);
    if (resolved === null) return null;
    const found = byLowerPath.get(resolved.toLowerCase()) ?? byLowerPath.get(`${resolved.toLowerCase()}.md`);
    if (found !== undefined) return found;
    const split = splitQualified(resolved);
    return ghost(split === null ? resolved : split.path);
  };

  const directed = new Set<string>();
  const tagEdges = new Set<string>();
  const notes = [...input.references.keys()].filter((note) => nodes.has(note)).sort(byCodeUnit);
  for (const note of notes) {
    const references = input.references.get(note)!;
    for (const reference of references.links) {
      const target = resolve(note, reference);
      if (target !== null && target !== note) directed.add(`${note}\n${target}`);
    }
    for (const tag of references.tags) {
      const id = `tag:${tag}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: "tag", label: `#${tag}`, path: null, degree: 0 });
      tagEdges.add(`${note}\n${id}`);
    }
  }

  const edges: GraphEdge[] = [];
  for (const pair of [...directed].sort(byCodeUnit)) {
    const [source, target] = pair.split("\n") as [string, string];
    const both = directed.has(`${target}\n${source}`);
    if (both && source > target) continue;
    edges.push({ source, target, both });
  }
  for (const pair of [...tagEdges].sort(byCodeUnit)) {
    const [source, target] = pair.split("\n") as [string, string];
    edges.push({ source, target, both: false });
  }
  edges.sort((a, b) => byCodeUnit(a.source, b.source) || byCodeUnit(a.target, b.target));

  for (const edge of edges) {
    nodes.get(edge.source)!.degree += 1;
    nodes.get(edge.target)!.degree += 1;
  }

  return { nodes: [...nodes.values()].sort((a, b) => byCodeUnit(a.id, b.id)), edges };
}

export function neighbourhood(graph: VaultGraph, centre: string, depth: number): VaultGraph {
  if (!graph.nodes.some((node) => node.id === centre)) return { nodes: [], edges: [] };
  const adjacent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  }
  const kept = new Set([centre]);
  let frontier = [centre];
  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adjacent.get(id) ?? []) {
        if (!kept.has(other)) {
          kept.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  };
}

export function applyIndexChange(input: VaultIndexInput, change: IndexChange): VaultIndexInput {
  if (change.kind === "written") {
    const files = input.files.includes(change.path) ? input.files : [...input.files, change.path];
    const references = new Map(input.references);
    if (change.references === null || !isNotePath(change.path)) references.delete(change.path);
    else references.set(change.path, change.references);
    return { files, references };
  }

  if (!input.files.includes(change.from)) return input;
  const files = input.files.map((file) => (file === change.from ? change.to : file));
  const references = new Map(input.references);
  const moved = references.get(change.from);
  references.delete(change.from);
  if (moved !== undefined && isNotePath(change.to)) references.set(change.to, moved);
  return { files, references };
}
