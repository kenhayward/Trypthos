import { describe, expect, it } from "vitest";
import { drawNodeHover } from "./graphHover";
import type { GraphPalette } from "./graphTheme";

/// The box behind a selected node's label, checked for the one thing that broke: where its colours
/// come from. Sigma's own hover renderer fills that box with a literal `#FFF` and then draws the
/// label in whatever `labelColor` says, which in dark mode is pale grey on white.

const palette: GraphPalette = {
  note: "#111111",
  attachment: "#222222",
  ghost: "#333333",
  tag: "#444444",
  edge: "#555555",
  label: "#666666",
  dim: "#777777",
  dimEdge: "#888888",
  surface: "#999999",
  ink: "#aaaaaa",
  pictogram: "#bbbbbb",
  font: "Test Sans",
};

const settings = { labelSize: 12, labelWeight: "normal", labelFont: "Ignored", labelColor: { color: palette.label } };

interface Painted {
  fills: string[];
  strokes: string[];
  texts: { text: string; colour: string }[];
}

function fakeContext() {
  const painted: Painted = { fills: [], strokes: [], texts: [] };
  const context = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    measureText: (text: string) => ({ width: text.length * 6 }),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => painted.fills.push(String(context.fillStyle)),
    stroke: () => painted.strokes.push(String(context.strokeStyle)),
    fillText: (text: string) => painted.texts.push({ text, colour: String(context.fillStyle) }),
  };
  return { context, painted };
}

const node = { x: 40, y: 30, size: 8, label: "Ada" };

describe("the box behind a selected node's label", () => {
  it("fills from the theme rather than a hardcoded white", () => {
    const { context, painted } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, node, settings, palette);
    expect(painted.fills).toEqual([palette.surface]);
  });

  it("outlines the box so it reads against a surface of its own colour", () => {
    const { context, painted } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, node, settings, palette);
    expect(painted.strokes).toEqual([palette.edge]);
  });

  // The label inside the box is the whole point of the box, and it is the one that went unreadable:
  // the box is a surface, so the text on it has to be the ink that surface is written on.
  it("writes the label in the ink that belongs on that surface", () => {
    const { context, painted } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, node, settings, palette);
    expect(painted.texts).toEqual([{ text: "Ada", colour: palette.ink }]);
  });

  it("draws in the palette's font, not the one the settings carry", () => {
    const { context } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, node, settings, palette);
    expect(context.font).toContain(palette.font);
  });

  // A node whose label the renderer suppressed still gets the halo, so the selection is visible.
  it("draws a plain halo when the node has no label", () => {
    const { context, painted } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, { ...node, label: null }, settings, palette);
    expect(painted.fills).toEqual([palette.surface]);
    expect(painted.texts).toEqual([]);
  });

  // The guard, rather than a second copy of the assertions above: any literal colour that creeps
  // back in is a colour the theme cannot answer for, and is invisible in whichever theme its
  // author was working in.
  it("uses no colour the palette did not give it", () => {
    const { context, painted } = fakeContext();
    drawNodeHover(context as unknown as CanvasRenderingContext2D, node, settings, palette);
    const fromPalette = new Set(Object.values(palette));
    for (const colour of [...painted.fills, ...painted.strokes, ...painted.texts.map((one) => one.colour)]) {
      expect(fromPalette.has(colour)).toBe(true);
    }
  });
});
