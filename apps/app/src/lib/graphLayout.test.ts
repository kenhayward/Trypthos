import { describe, expect, it } from "vitest";
import { computeLayout, layoutIterations } from "./graphLayout";

const input = {
  nodes: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "d", target: "e" },
    { source: "a", target: "missing" },
  ],
};

describe("laying out a graph", () => {
  it("places every node at a finite position", () => {
    const positions = computeLayout(input);
    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    for (const { x, y } of Object.values(positions)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("gives the same vault the same shape every time", () => {
    expect(computeLayout(input)).toEqual(computeLayout(input));
  });

  it("gives distinct positions, since nodes on one spot never separate", () => {
    const keys = Object.values(computeLayout(input)).map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("handles nothing and one node", () => {
    expect(computeLayout({ nodes: [], edges: [] })).toEqual({});
    expect(Object.keys(computeLayout({ nodes: [{ id: "only" }], edges: [] }))).toEqual(["only"]);
  });

  it("spends fewer iterations on bigger graphs", () => {
    expect(layoutIterations(100)).toBeGreaterThan(layoutIterations(1000));
    expect(layoutIterations(1000)).toBeGreaterThan(layoutIterations(5000));
  });
});
