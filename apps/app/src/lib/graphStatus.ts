import type { GraphProgress, VaultGraph } from "@trypthos/domain";

/// The graph's status line as numbers. Wording lives in the component, which has `t`.

export interface IndexAge {
  unit: "now" | "minutes" | "hours" | "days";
  count: number;
}

export function indexAge(builtAt: string, now: number): IndexAge {
  const minutes = Math.floor(Math.max(now - Date.parse(builtAt), 0) / 60_000);
  if (minutes < 1) return { unit: "now", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}

export function percentRead(progress: Pick<GraphProgress, "read" | "total">): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.floor((progress.read * 100) / progress.total));
}

export function noteCount(graph: VaultGraph): number {
  return graph.nodes.filter((node) => node.kind === "note").length;
}

export function linkCount(graph: VaultGraph): number {
  return graph.edges.filter((edge) => !edge.target.startsWith("tag:")).length;
}

export function attachmentCount(graph: VaultGraph): number {
  return graph.nodes.filter((node) => node.kind === "attachment").length;
}
