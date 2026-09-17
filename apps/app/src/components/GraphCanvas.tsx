import { createNodeImageProgram } from "@sigma/node-image";
import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Sigma from "sigma";
import {
  EdgeArrowProgram,
  EdgeDoubleArrowProgram,
  EdgeLineProgram,
  NodeCircleProgram,
  createNodeCompoundProgram,
} from "sigma/rendering";
import type { GraphNode, GraphNodeKind, VaultGraph } from "@trypthos/domain";
import { stepSelection } from "../lib/graphFilters";
import type { Positions } from "../lib/graphLayoutTypes";
import { observeTheme, PICTOGRAMS, readGraphPalette } from "../lib/graphTheme";
import type { GraphPalette } from "../lib/graphTheme";
import Glyph from "./Glyph";

/// The vault graph, drawn with Sigma in WebGL.
///
/// **Lazy only.** This module and the libraries it imports are reached through `lazy()`; see
/// `graphBundle.test.ts`.
///
/// **Interaction state lives in a ref, not in React state.** Hover and selection change on every
/// mouse move, and Sigma's reducers read them at draw time - a re-render per hover would rebuild
/// nothing useful and cost a frame.
///
/// **A theme change repaints; it does not rebuild.** The palette is a ref for the same reason, and
/// deliberately not a dependency of the effect that builds the renderer: tearing Sigma down would
/// throw away the camera the user panned and every node they dragged, which is a strange thing for
/// switching to dark mode to do.

export interface GraphCanvasProps {
  graph: VaultGraph;
  positions: Positions;
  hidden: ReadonlySet<string>;
  highlighted: ReadonlySet<string> | null;
  activeId: string | null;
  focusId: string | null;
  compact?: boolean;
  label: string;
  onOpen(node: GraphNode): void;
  onRenderer?(renderer: Sigma | null): void;
}

const NodeDiscProgram = createNodeCompoundProgram([
  NodeCircleProgram,
  createNodeImageProgram({ padding: 0.22, size: { mode: "force", value: 64 }, drawingMode: "color", colorAttribute: "pictoColor" }),
]);

function currentPalette(): GraphPalette {
  return readGraphPalette(getComputedStyle(document.documentElement), getComputedStyle(document.body).fontFamily);
}

/// Whether two palettes say the same thing. `currentPalette()` builds a fresh object every time it
/// is called, so identity answers "is this a new palette?" with yes, always - and a repaint per
/// mutation of the root element is what that buys.
function samePalette(a: GraphPalette, b: GraphPalette): boolean {
  return (Object.keys(a) as (keyof GraphPalette)[]).every((key) => a[key] === b[key]);
}

function nodeSize(degree: number, compact: boolean): number {
  return compact ? Math.min(4 + Math.sqrt(degree) * 1.5, 11) : Math.min(5 + Math.sqrt(degree) * 2, 18);
}

/// Brings the renderer up, and reports to React what WebGL had to say about it.
///
/// The report is a callback rather than a `setFailure(...)` in the effect body because
/// `react-hooks/set-state-in-effect` forbids the latter - and rightly describes the shape this is:
/// an effect subscribing to an external system, which answers back through a callback. It reports
/// on success too, so a graph, layout or size change after a failure recovers rather than leaving
/// the pane on its error message for the life of the component.
///
/// The caught error is handed back rather than dropped. It is not logged: the test setup fails a
/// test on a `console.error`, and a component that can re-run this effect on every prop change is
/// the wrong place to write to a shared log. It rides on the message element's `title` instead,
/// where whoever is looking at the failure can read it.
function buildRenderer(make: () => Sigma, report: (failure: string | null) => void): Sigma | null {
  let sigma: Sigma;
  try {
    sigma = make();
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    return null;
  }
  report(null);
  return sigma;
}

export default function GraphCanvas({
  graph,
  positions,
  hidden,
  highlighted,
  activeId,
  focusId,
  compact = false,
  label,
  onOpen,
  onRenderer,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma | null>(null);
  const view = useRef({ hidden, highlighted, activeId, hovered: null as string | null, selected: null as string | null });
  const callbacks = useRef({ onOpen, onRenderer });
  const [palette, setPalette] = useState(currentPalette);
  /// The palette the model and the reducers are currently painted with.
  const paint = useRef(palette);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    callbacks.current = { onOpen, onRenderer };
  }, [onOpen, onRenderer]);

  useEffect(
    () =>
      observeTheme(() =>
        setPalette((shown) => {
          const next = currentPalette();
          return samePalette(shown, next) ? shown : next;
        }),
      ),
    [],
  );

  const select = (id: string | null) => {
    view.current.selected = id;
    if (container.current !== null) container.current.dataset.selected = id ?? "";
    renderer.current?.refresh({ skipIndexation: true });
  };

  const centreOn = (id: string) => {
    const shown = renderer.current?.getNodeDisplayData(id);
    if (shown !== undefined) void renderer.current!.getCamera().animate({ x: shown.x, y: shown.y }, { duration: 250 });
  };

  const open = (id: string | null) => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (node !== undefined) callbacks.current.onOpen(node);
  };

  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    const colours = paint.current;
    const model = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
    for (const node of graph.nodes) {
      const at = positions[node.id];
      if (at === undefined) continue;
      model.addNode(node.id, {
        x: at.x,
        y: at.y,
        size: nodeSize(node.degree, compact),
        label: node.label,
        // Carried on the node so a repaint can look up its colour without the graph in hand.
        kind: node.kind,
        color: colours[node.kind],
        image: PICTOGRAMS[node.kind],
        pictoColor: colours.pictogram,
      });
    }
    for (const edge of graph.edges) {
      if (!model.hasNode(edge.source) || !model.hasNode(edge.target) || model.hasEdge(edge.source, edge.target)) continue;
      model.addEdge(edge.source, edge.target, {
        type: edge.target.startsWith("tag:") ? "line" : edge.both ? "doubleArrow" : "arrow",
        size: 1,
        color: colours.edge,
      });
    }

    const sigma = buildRenderer(
      () =>
        new Sigma(model, host, {
          // A pane laid out after its first paint - a collapsed panel opening, a tab becoming
          // visible - hands Sigma a container of no size, and Sigma throws on that unless told not
          // to. It corrects itself on the next resize.
          allowInvalidContainer: true,
          defaultNodeType: "disc",
          nodeProgramClasses: { disc: NodeDiscProgram },
          edgeProgramClasses: { arrow: EdgeArrowProgram, doubleArrow: EdgeDoubleArrowProgram, line: EdgeLineProgram },
          labelColor: { color: colours.label },
          labelFont: colours.font,
          labelSize: compact ? 10 : 12,
          labelRenderedSizeThreshold: compact ? 10 : 8,
          zIndex: true,
          nodeReducer: (node, data) => {
            const state = view.current;
            const colours = paint.current;
            if (state.hidden.has(node)) return { ...data, hidden: true };
            const focus = state.hovered ?? state.selected;
            const near = focus === null || node === focus || model.areNeighbors(focus, node);
            const found = state.highlighted === null || state.highlighted.has(node);
            const shown = { ...data };
            if (!near || !found) {
              shown.color = colours.dim;
              shown.label = null;
              shown.zIndex = 0;
            } else if (focus !== null || state.highlighted !== null) {
              shown.forceLabel = true;
              shown.zIndex = 1;
            }
            if (node === state.activeId || node === state.selected) {
              shown.highlighted = true;
              shown.forceLabel = true;
              shown.zIndex = 2;
            }
            if (node === state.activeId) shown.size = data.size * 1.4;
            return shown;
          },
          edgeReducer: (edge, data) => {
            const state = view.current;
            const [source, target] = model.extremities(edge);
            if (state.hidden.has(source) || state.hidden.has(target)) return { ...data, hidden: true };
            const focus = state.hovered ?? state.selected;
            if (focus !== null && source !== focus && target !== focus) return { ...data, color: paint.current.dim };
            return data;
          },
        }),
      setFailure,
    );
    if (sigma === null) return;
    renderer.current = sigma;
    host.dataset.selected = view.current.selected ?? "";

    let dragging: string | null = null;
    sigma.on("enterNode", ({ node }) => {
      view.current.hovered = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      view.current.hovered = null;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => select(node));
    sigma.on("clickStage", () => select(null));
    sigma.on("doubleClickNode", (event) => {
      event.preventSigmaDefault();
      open(event.node);
    });
    sigma.on("downNode", ({ node }) => {
      dragging = node;
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.on("moveBody", ({ event }) => {
      if (dragging === null) return;
      const at = sigma.viewportToGraph(event);
      model.setNodeAttribute(dragging, "x", at.x);
      model.setNodeAttribute(dragging, "y", at.y);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const stopDragging = () => {
      dragging = null;
    };
    sigma.on("upNode", stopDragging);
    sigma.on("upStage", stopDragging);

    callbacks.current.onRenderer?.(sigma);
    return () => {
      callbacks.current.onRenderer?.(null);
      sigma.kill();
      renderer.current = null;
    };
    // `open` and `select` read refs and `graph`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, positions, compact]);

  /// A theme change, painted onto the renderer that is already there.
  useEffect(() => {
    // The one the model was built with, so the mount pass has nothing to do.
    if (paint.current === palette) return;
    paint.current = palette;
    const sigma = renderer.current;
    if (sigma === null) return;
    const model = sigma.getGraph();
    model.forEachNode((id, attributes) => {
      model.mergeNodeAttributes(id, { color: palette[attributes.kind as GraphNodeKind], pictoColor: palette.pictogram });
    });
    model.forEachEdge((id) => model.setEdgeAttribute(id, "color", palette.edge));
    sigma.setSettings({ labelColor: { color: palette.label }, labelFont: palette.font });
    sigma.refresh();
  }, [palette]);

  useEffect(() => {
    view.current.hidden = hidden;
    view.current.highlighted = highlighted;
    view.current.activeId = activeId;
    renderer.current?.refresh({ skipIndexation: true });
  }, [hidden, highlighted, activeId]);

  useEffect(() => {
    if (focusId === null) return;
    select(focusId);
    centreOn(focusId);
  }, [focusId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key] as 1 | -1 | undefined;
    if (step !== undefined) {
      event.preventDefault();
      const next = stepSelection(graph, view.current.hidden, view.current.selected, view.current.activeId, step);
      select(next);
      if (next !== null) centreOn(next);
    } else if (event.key === "Enter") {
      open(view.current.selected);
    } else if (event.key === "Escape") {
      select(null);
    }
  };

  const camera = () => renderer.current?.getCamera();
  return (
    <div className="relative h-full w-full">
      {/* Kept mounted even when the renderer failed: an unmounted container is one the build effect
          can never find again, which would make a failure permanent rather than a bad moment. */}
      <div
        ref={container}
        data-testid="graph-canvas"
        role="application"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {failure !== null && (
        <p title={failure} className="absolute inset-0 flex items-center justify-center bg-app p-4 text-center text-sm text-danger">
          {t("graph.tooLarge")}
        </p>
      )}
      {!compact && failure === null && (
        <div className="absolute right-2 bottom-2 flex flex-col gap-0.5">
          <button type="button" title={t("graph.zoomIn")} aria-label={t("graph.zoomIn")} onClick={() => void camera()?.animatedZoom({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M12 5v14M5 12h14" /></Glyph>
          </button>
          <button type="button" title={t("graph.zoomOut")} aria-label={t("graph.zoomOut")} onClick={() => void camera()?.animatedUnzoom({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M5 12h14" /></Glyph>
          </button>
          <button type="button" title={t("graph.fit")} aria-label={t("graph.fit")} onClick={() => void camera()?.animatedReset({ duration: 200 })} className="rounded border border-rule bg-sunken p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <Glyph className="size-3.5"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Glyph>
          </button>
        </div>
      )}
    </div>
  );
}
