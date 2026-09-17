import { render, waitFor } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
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
  const view = render(
    <div style={{ width: box.width, height: box.height }}>
      <GraphCanvas
        graph={graph}
        positions={computeLayout(graph)}
        hidden={new Set()}
        highlighted={null}
        activeId={null}
        focus={null}
        label="Link graph of V"
        onOpen={onOpen}
        onRenderer={(value) => (held.renderer = value)}
        {...overrides}
      />
    </div>,
    { container: host },
  );
  await waitFor(() => expect(held.renderer).not.toBe(null));
  const canvas = view.getByTestId("graph-canvas");
  const pointAt = (id: string) => {
    const attributes = held.renderer!.getGraph().getNodeAttributes(id);
    return held.renderer!.graphToViewport({ x: attributes.x as number, y: attributes.y as number });
  };
  return { view, canvas, onOpen, pointAt, renderer: () => held.renderer! };
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

  it("lays out the same positions in the worker as on the main thread", async () => {
    const layout = createWorkerLayout();
    try {
      expect(await layout.run(graph)).toEqual(computeLayout(graph));
    } finally {
      layout.dispose();
    }
  });
});
