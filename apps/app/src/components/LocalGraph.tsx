import { neighbourhood } from "@trypthos/domain";
import type { GraphSnapshot } from "@trypthos/domain";
import { Suspense, lazy, useMemo } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { graphNodeAction } from "../lib/graphActions";
import { hiddenNodes } from "../lib/graphFilters";
import type { GraphFilter } from "../lib/graphFilters";
import type { LayoutRunner } from "../lib/graphLayoutTypes";
import { useLayoutRunner } from "../lib/layoutClient";
import CanvasBoundary from "./CanvasBoundary";
import type { GraphCanvasProps } from "./GraphCanvas";

/// The local graph's body: the active note and what it links to, to the chosen depth. Lazy only.
///
/// Filters apply as in the tab except Orphans - the centre is what the pane is about, so it is never
/// hidden, and asking whether its neighbours are orphans makes no sense when they are its neighbours.

/// The canvas, fetched when the pane first draws a graph.
///
/// `lazy` rather than a static import, although `graphBundle.test.ts` would allow one here: sigma
/// reads `WebGL2RenderingContext` as its module body runs, and jsdom has no such global, so a static
/// import would make this whole file unloadable in the jsdom suite. Same reasoning as `GraphPage`.
const GraphCanvas = lazy(() => import("./GraphCanvas"));

export interface LocalGraphProps {
  snapshot: GraphSnapshot;
  centre: string;
  depth: number;
  filter: GraphFilter;
  onOpenPath(path: string): void;
  onCreateNote(request: { directory: string; name: string }): void;
  layout?: LayoutRunner;
  Canvas?: ComponentType<GraphCanvasProps>;
}

/// The runner used if `useLayoutRunner` ever answers "no runner yet". It never does - it hands back
/// a stable function that waits for its worker - but its type says it can, and a promise that never
/// settles is the honest stand-in: the view reads as "not drawn yet", exactly as it would while a
/// real layout was still running.
const never: LayoutRunner = () => new Promise(() => {});

export default function LocalGraph({
  snapshot,
  centre,
  depth,
  filter,
  onOpenPath,
  onCreateNote,
  layout,
  Canvas = GraphCanvas,
}: LocalGraphProps) {
  const { t } = useTranslation();
  const run = useLayoutRunner(layout);
  const local = useMemo(() => neighbourhood(snapshot, centre, depth), [snapshot, centre, depth]);
  const input = useMemo(() => ({ nodes: local.nodes, edges: local.edges }), [local]);
  const positions = useGraphLayout(input, run ?? never);
  const hidden = useMemo(() => hiddenNodes(local, { ...filter, orphans: true }, centre), [local, filter, centre]);

  if (positions === null) return null;
  return (
    // The boundary is outside the Suspense, so it catches the chunk that would not arrive as well
    // as anything the canvas throws while rendering - this pane sits under the folder trees, and an
    // uncaught throw here would take the whole left panel. Nothing while the chunk is on its way:
    // the graph appears when it can be drawn, and a spinner for one local chunk is a flash of
    // something nobody reads.
    <CanvasBoundary message={t("graph.drawFailed")}>
      <Suspense fallback={null}>
        <Canvas
          graph={local}
          positions={positions}
          hidden={hidden}
          highlighted={null}
          activeId={centre}
          focus={null}
          compact
          label={t("graph.localTitle")}
          onOpen={(node) => {
            const action = graphNodeAction(node, snapshot);
            if (action?.kind === "open") onOpenPath(action.path);
            else if (action?.kind === "create") onCreateNote({ directory: action.directory, name: action.name });
          }}
        />
      </Suspense>
    </CanvasBoundary>
  );
}
