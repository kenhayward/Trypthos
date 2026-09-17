import type { GraphState } from "@trypthos/domain";
import type { GraphCanvasProps } from "../components/GraphCanvas";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import type { GraphClient } from "../lib/workspaceClient";

/// A hand-written graph bridge for jsdom tests: answers `state`, and lets a test push events.
export function fakeGraphClient(initial: GraphState) {
  let state = initial;
  const progress = new Set<(message: unknown) => void>();
  const changed = new Set<(message: unknown) => void>();
  const refreshed: string[] = [];
  const client: GraphClient = {
    graphState: async () => ({ ok: true as const, state }),
    refreshGraph: async (workspaceId) => {
      refreshed.push(workspaceId);
      return { ok: true as const };
    },
    onGraphProgress: (listener) => {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    onGraphChanged: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
  };
  return {
    client,
    refreshed,
    set: (next: GraphState) => (state = next),
    pushProgress: (message: unknown) => progress.forEach((listener) => listener(message)),
    pushChanged: (message: unknown) => changed.forEach((listener) => listener(message)),
  };
}

/// Stands in for the WebGL canvas, which jsdom cannot run. Every node is a button, so a test can
/// double-click one, and the props a test cares about are mirrored onto data attributes.
export function FakeCanvas(props: GraphCanvasProps) {
  return (
    <div
      data-testid="fake-canvas"
      data-hidden={[...props.hidden].sort().join(",")}
      data-highlighted={props.highlighted === null ? "" : [...props.highlighted].join(",")}
      data-active={props.activeId ?? ""}
      data-focus={props.focusId ?? ""}
      data-compact={props.compact ? "true" : "false"}
      aria-label={props.label}
    >
      {props.graph.nodes.map((node) => (
        <button key={node.id} type="button" onDoubleClick={() => props.onOpen(node)}>
          {node.label}
        </button>
      ))}
    </div>
  );
}

export const instantLayout: LayoutRunner = async (input) =>
  Object.fromEntries(input.nodes.map((node, index) => [node.id, { x: index, y: 0 }]));
