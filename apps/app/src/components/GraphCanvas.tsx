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
import type { GraphNode, VaultGraph } from "@trypthos/domain";
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

function nodeSize(degree: number, compact: boolean): number {
  return compact ? Math.min(4 + Math.sqrt(degree) * 1.5, 11) : Math.min(5 + Math.sqrt(degree) * 2, 18);
}

/// Brings the renderer up, and reports to React whether WebGL could give us one.
///
/// The report is a callback rather than a `setFailed(...)` in the effect body because
/// `react-hooks/set-state-in-effect` forbids the latter - and rightly describes the shape this is:
/// an effect subscribing to an external system, which answers back through a callback. WebGL is
/// that external system, and whether it came up is the only thing it has to say here.
function buildRenderer(make: () => Sigma, report: (failed: boolean) => void): Sigma | null {
  let sigma: Sigma;
  try {
    sigma = make();
  } catch {
    report(true);
    return null;
  }
  report(false);
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbacks.current = { onOpen, onRenderer };
  }, [onOpen, onRenderer]);

  useEffect(() => observeTheme(() => setPalette(currentPalette())), []);

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
    const model = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
    for (const node of graph.nodes) {
      const at = positions[node.id];
      if (at === undefined) continue;
      model.addNode(node.id, {
        x: at.x,
        y: at.y,
        size: nodeSize(node.degree, compact),
        label: node.label,
        color: palette[node.kind],
        image: PICTOGRAMS[node.kind],
        pictoColor: palette.pictogram,
      });
    }
    for (const edge of graph.edges) {
      if (!model.hasNode(edge.source) || !model.hasNode(edge.target) || model.hasEdge(edge.source, edge.target)) continue;
      model.addEdge(edge.source, edge.target, {
        type: edge.target.startsWith("tag:") ? "line" : edge.both ? "doubleArrow" : "arrow",
        size: 1,
        color: palette.edge,
      });
    }

    const sigma = buildRenderer(
      () =>
        new Sigma(model, host, {
          defaultNodeType: "disc",
          nodeProgramClasses: { disc: NodeDiscProgram },
          edgeProgramClasses: { arrow: EdgeArrowProgram, doubleArrow: EdgeDoubleArrowProgram, line: EdgeLineProgram },
          labelColor: { color: palette.label },
          labelFont: palette.font,
          labelSize: compact ? 10 : 12,
          labelRenderedSizeThreshold: compact ? 10 : 8,
          zIndex: true,
          nodeReducer: (node, data) => {
            const state = view.current;
            if (state.hidden.has(node)) return { ...data, hidden: true };
            const focus = state.hovered ?? state.selected;
            const near = focus === null || node === focus || model.areNeighbors(focus, node);
            const found = state.highlighted === null || state.highlighted.has(node);
            const shown = { ...data };
            if (!near || !found) {
              shown.color = palette.dim;
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
            if (focus !== null && source !== focus && target !== focus) return { ...data, color: palette.dim };
            return data;
          },
        }),
      setFailed,
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
  }, [graph, positions, palette, compact]);

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

  if (failed) {
    return <p className="p-4 text-sm text-danger">{t("graph.tooLarge")}</p>;
  }

  const camera = () => renderer.current?.getCamera();
  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        data-testid="graph-canvas"
        role="application"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {!compact && (
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
