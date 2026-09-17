/// The vault graph tab: a document identity like the repository page, never a file.
///
/// `splitQualified` refuses the whole `trypthos:` prefix, which is what keeps this path away from
/// every code path that would resolve it against a provider.

export const GRAPH_PAGE_PREFIX = "trypthos:graph/";

export function graphPagePath(workspaceId: string): string {
  return `${GRAPH_PAGE_PREFIX}${workspaceId}`;
}

export function graphPageWorkspaceId(path: string): string | null {
  if (!path.startsWith(GRAPH_PAGE_PREFIX)) return null;
  const id = path.slice(GRAPH_PAGE_PREFIX.length);
  return id === "" ? null : id;
}

export function isGraphPagePath(path: string): boolean {
  return graphPageWorkspaceId(path) !== null;
}
