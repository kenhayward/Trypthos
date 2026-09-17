import type { VaultGraph } from "@trypthos/domain";

/// What the graph's chips and search do, as data. Kept out of the canvas so it is tested without
/// WebGL, and shared by the global tab and the local pane.

export interface GraphFilter {
  notes: boolean;
  attachments: boolean;
  tags: boolean;
  unresolved: boolean;
  orphans: boolean;
}

export function hiddenNodes(graph: VaultGraph, filter: GraphFilter, keep: string | null = null): Set<string> {
  const linked = new Set<string>();
  const tagIds = new Set(graph.nodes.filter((node) => node.kind === "tag").map((node) => node.id));
  for (const edge of graph.edges) {
    if (tagIds.has(edge.source) || tagIds.has(edge.target)) continue;
    linked.add(edge.source);
    linked.add(edge.target);
  }

  const hidden = new Set<string>();
  for (const node of graph.nodes) {
    if (node.id === keep) continue;
    const byKind =
      (node.kind === "note" && !filter.notes) ||
      (node.kind === "attachment" && !filter.attachments) ||
      (node.kind === "tag" && !filter.tags) ||
      (node.kind === "ghost" && !filter.unresolved);
    const orphan = node.kind === "note" && !filter.orphans && !linked.has(node.id);
    if (byKind || orphan) hidden.add(node.id);
  }
  return hidden;
}

export function searchMatches(graph: VaultGraph, query: string): string[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return [];
  const rank = (label: string) => (label === wanted ? 0 : label.startsWith(wanted) ? 1 : 2);
  return graph.nodes
    .map((node) => ({ id: node.id, label: node.label.toLowerCase() }))
    .filter((node) => node.label.includes(wanted))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.length - b.label.length || (a.id < b.id ? -1 : 1))
    .map((node) => node.id);
}

export function neighboursOf(graph: VaultGraph, id: string): Set<string> {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === id) found.add(edge.target);
    else if (edge.target === id) found.add(edge.source);
  }
  return found;
}

export function stepSelection(
  graph: VaultGraph,
  hidden: ReadonlySet<string>,
  current: string | null,
  fallback: string | null,
  direction: 1 | -1,
): string | null {
  const visible = (id: string) => !hidden.has(id);
  if (current === null) {
    if (fallback !== null && visible(fallback)) return fallback;
    return graph.nodes.find((node) => visible(node.id))?.id ?? null;
  }
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label.toLowerCase()]));
  const neighbours = [...neighboursOf(graph, current)]
    .filter(visible)
    .sort((a, b) => (labels.get(a)! < labels.get(b)! ? -1 : 1));
  if (neighbours.length === 0) return current;
  return direction === 1 ? neighbours[0]! : neighbours[neighbours.length - 1]!;
}

export function linkingNote(graph: VaultGraph, id: string): string | null {
  const sources = graph.edges.filter((edge) => edge.target === id).map((edge) => edge.source).sort();
  return sources[0] ?? null;
}
