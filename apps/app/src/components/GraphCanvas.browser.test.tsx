import { render, waitFor } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import type Sigma from "sigma";
import { describe, expect, it, vi } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { computeLayout } from "../lib/graphLayout";
import { createWorkerLayout } from "../lib/layoutClient";
import { readGraphPalette } from "../lib/graphTheme";
import GraphCanvas from "./GraphCanvas";

/// The canvas, in a real browser - the only place it can be asked anything.
///
/// Sigma draws in WebGL and measures its container, so under jsdom it would be measuring a polyfill
/// returning zeros. Nothing here has a jsdom counterpart: a jsdom test of this component would be a
/// test of the polyfill.

const graph: VaultGraph = {
  nodes: [
    { id: "V/Alpha.md", kind: "note", label: "Alpha", path: "V/Alpha.md", degree: 2 },
    { id: "V/Beta.md", kind: "note", label: "Beta", path: "V/Beta.md", degree: 1 },
    { id: "ghost:gamma", kind: "ghost", label: "Gamma", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/Alpha.md", target: "V/Beta.md", both: true },
    { source: "V/Alpha.md", target: "ghost:gamma", both: false },
  ],
};

async function mount(overrides: Partial<Parameters<typeof GraphCanvas>[0]> = {}, box = { width: 600, height: 400 }) {
  await page.viewport(900, 700);
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${box.width}px;height:${box.height}px`;
  document.body.append(host);
  const held: { renderer: Sigma | null } = { renderer: null };
  const onOpen = vi.fn();
  const tree = (drawn: VaultGraph) => (
    <div style={{ width: box.width, height: box.height }}>
      <GraphCanvas
        graph={drawn}
        positions={computeLayout(drawn)}
        hidden={new Set()}
        highlighted={null}
        activeId={null}
        focus={null}
        label="Link graph of V"
        onOpen={onOpen}
        onRenderer={(value) => (held.renderer = value)}
        {...overrides}
      />
    </div>
  );
  const view = render(tree(graph), { container: host });
  await waitFor(() => expect(held.renderer).not.toBe(null));
  const canvas = view.getByTestId("graph-canvas");
  const pointAt = (id: string) => {
    const attributes = held.renderer!.getGraph().getNodeAttributes(id);
    return held.renderer!.graphToViewport({ x: attributes.x as number, y: attributes.y as number });
  };
  return {
    view,
    canvas,
    onOpen,
    pointAt,
    renderer: () => held.renderer!,
    held,
    redraw: (next: VaultGraph) => view.rerender(tree(next)),
  };
}

describe("GraphCanvas", () => {
  it("opens a note on double-click and selects on a single click", async () => {
    const { canvas, onOpen, pointAt } = await mount();
    const beta = pointAt("V/Beta.md");

    await userEvent.click(canvas, { position: { x: beta.x, y: beta.y } });
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Beta.md"));

    await userEvent.dblClick(canvas, { position: { x: beta.x, y: beta.y } });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(graph.nodes[1]));
  });

  it("walks neighbours with the arrow keys and opens with Enter", async () => {
    const { canvas, onOpen } = await mount({ activeId: "V/Alpha.md" });
    canvas.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Alpha.md"));
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Beta.md"));
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(graph.nodes[1]);
  });

  it("paints in theme tokens that differ between light and dark", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const light = readGraphPalette(getComputedStyle(document.documentElement), "x");
    document.documentElement.setAttribute("data-theme", "dark");
    const dark = readGraphPalette(getComputedStyle(document.documentElement), "x");
    document.documentElement.removeAttribute("data-theme");

    for (const key of ["note", "attachment", "ghost", "tag", "edge", "label", "dim", "pictogram"] as const) {
      expect(light[key]).not.toBe("");
      expect(dark[key]).not.toBe("");
    }
    expect(light.note).not.toBe(dark.note);
  });

  // The repaint has to happen on the instance that is already there. Rebuilding it would throw away
  // the camera the user panned and every node they dragged, which is a strange thing for switching
  // to dark mode to do.
  it("repaints node colours in place when the theme changes, without rebuilding the renderer", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { renderer } = await mount();
    const instance = renderer();
    const before = renderer().getGraph().getNodeAttribute("V/Alpha.md", "color");
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(renderer().getGraph().getNodeAttribute("V/Alpha.md", "color")).not.toBe(before));
    expect(renderer().getGraph().getEdgeAttribute("V/Alpha.md", "V/Beta.md", "color")).toBe(
      readGraphPalette(getComputedStyle(document.documentElement), "x").edge,
    );
    expect(renderer()).toBe(instance);
    document.documentElement.removeAttribute("data-theme");
  });

  // A pane that is laid out after its first paint - a collapsed sidebar opening, a tab becoming
  // visible - hands Sigma a container of no size. Sigma throws on that unless it is told not to,
  // and the throw would land the user on the "too large to draw" message for good.
  it("comes up in a container that has no size yet", async () => {
    const { renderer, view } = await mount({}, { width: 0, height: 0 });
    expect(renderer()).not.toBe(null);
    expect(view.queryByText("This graph is too large to draw on this computer.")).toBe(null);
  });

  // The selection is a ref, so it survives a new `graph` prop - and the node it names may not.
  // Creating a note from the ghost that was selected, renaming a selected note, or switching
  // between two vaults' tabs all arrive here as "the graph changed under the selection". Sigma runs
  // the node reducer inside its own constructor, so a selection naming an absent node threw before
  // the renderer existed, and the pane stayed on its failure message for good.
  it("keeps drawing when the selected node leaves the graph", async () => {
    const { canvas, pointAt, redraw, view, held } = await mount();
    const beta = pointAt("V/Beta.md");
    await userEvent.click(canvas, { position: { x: beta.x, y: beta.y } });
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Beta.md"));

    const without: VaultGraph = {
      nodes: graph.nodes.filter((node) => node.id !== "V/Beta.md"),
      edges: graph.edges.filter((edge) => edge.source !== "V/Beta.md" && edge.target !== "V/Beta.md"),
    };
    redraw(without);

    await waitFor(() => expect(held.renderer).not.toBe(null));
    expect(held.renderer!.getGraph().hasNode("V/Beta.md")).toBe(false);
    expect(view.queryByText("This graph is too large to draw on this computer.")).toBe(null);
    expect(view.queryByText("The graph could not be drawn.")).toBe(null);
    expect(canvas.dataset.selected).toBe("");
  });

  // Selecting a node fades the rest of the graph back. The edge that broke this was not a fade at
  // all: the colour it faded to was drawn louder than the edges around the selection, so the
  // highlight appeared to point at everything except the node the user had clicked.
  it("fades only the edges that do not touch the selection", async () => {
    const wider: VaultGraph = {
      nodes: [
        ...graph.nodes,
        { id: "V/Delta.md", kind: "note", label: "Delta", path: "V/Delta.md", degree: 1 },
        { id: "V/Epsilon.md", kind: "note", label: "Epsilon", path: "V/Epsilon.md", degree: 1 },
      ],
      edges: [...graph.edges, { source: "V/Delta.md", target: "V/Epsilon.md", both: false }],
    };
    const { canvas, pointAt, renderer } = await mount({ graph: wider, positions: computeLayout(wider) });
    const alpha = pointAt("V/Alpha.md");
    await userEvent.click(canvas, { position: { x: alpha.x, y: alpha.y } });
    await waitFor(() => expect(canvas.dataset.selected).toBe("V/Alpha.md"));

    const colours = readGraphPalette(getComputedStyle(document.documentElement), "x");
    const drawn = (source: string, target: string) =>
      renderer().getEdgeDisplayData(renderer().getGraph().edge(source, target))?.color;
    expect(drawn("V/Alpha.md", "V/Beta.md")).toBe(colours.edge);
    expect(drawn("V/Delta.md", "V/Epsilon.md")).toBe(colours.dimEdge);
  });

  // Sigma's own hover renderer fills the label box with a literal `#FFF` and then writes the label
  // in the ordinary label colour - pale grey on white once the theme is dark. Asserted on real
  // pixels, because the question is what the box is painted, and because the wiring is the half
  // that can silently go back to Sigma's default.
  it("paints a selected node's label box in the theme's surface", async () => {
    const { renderer } = await mount();
    const surface = document.createElement("canvas");
    surface.width = 200;
    surface.height = 100;
    const context = surface.getContext("2d")!;
    renderer().getSettings().defaultDrawNodeHover!(context, { x: 60, y: 50, size: 8, label: "Alpha", color: "#000000" }, renderer().getSettings());

    const [r = 0, g = 0, b = 0] = context.getImageData(60, 50, 1, 1).data;
    const probe = document.createElement("span");
    probe.style.color = readGraphPalette(getComputedStyle(document.documentElement), "x").surface;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();

    expect(`rgb(${r}, ${g}, ${b})`).toBe(expected);
  });

  it("lays out the same positions in the worker as on the main thread", async () => {
    const layout = createWorkerLayout();
    try {
      expect(await layout.run(graph)).toEqual(computeLayout(graph));
    } finally {
      layout.dispose();
    }
  });
});
