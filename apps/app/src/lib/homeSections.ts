/// Which parts of a workspace's home page exist, and which one it opens on.
///
/// A section exists only when it has something in it. A graph with no edges is a field of
/// unconnected dots - worse than no graph, and the reason a folder whose files never link to each
/// other shows no Graph control at all. A GitHub workspace has no index yet, so it has no edges and
/// no Graph section, which falls out of this rule rather than needing a case of its own.
///
/// The page opens on the graph when there is one. Not remembered between openings: the section a
/// user wants follows from the workspace they just clicked, not from a setting.

export type HomeSection = "graph" | "readme";

export function homeSections({ edges, hasReadme }: { edges: number; hasReadme: boolean }): HomeSection[] {
  const sections: HomeSection[] = [];
  if (edges > 0) sections.push("graph");
  if (hasReadme) sections.push("readme");
  return sections;
}

export function openingSection(sections: readonly HomeSection[]): HomeSection | null {
  return sections[0] ?? null;
}
