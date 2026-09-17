import Graph from "graphology";
import { circular } from "graphology-layout";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { LayoutInput, Positions } from "./graphLayoutTypes";

/// A force layout that gives the same vault the same shape every time.
///
/// ForceAtlas2 has no randomness of its own, so identical starting positions, insertion order,
/// settings and iteration count give identical output. The start is a circle in node order - the
/// snapshot's sorted order - rather than random positions, and the iteration count is fixed rather
/// than "run until it looks settled", which would depend on how fast the machine is.

export function layoutIterations(order: number): number {
  if (order > 2000) return 60;
  if (order > 500) return 150;
  return 300;
}

export function computeLayout(input: LayoutInput): Positions {
  const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const node of input.nodes) graph.mergeNode(node.id);
  for (const edge of input.edges) {
    if (edge.source === edge.target || !graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (!graph.hasEdge(edge.source, edge.target)) graph.addEdge(edge.source, edge.target);
  }
  if (graph.order === 0) return {};

  circular.assign(graph, { scale: 100 });
  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: layoutIterations(graph.order),
      settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 500 },
    });
  }

  const positions: Positions = {};
  graph.forEachNode((id, attributes) => {
    positions[id] = { x: attributes.x as number, y: attributes.y as number };
  });
  return positions;
}
