import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LayoutInput, Positions } from "../lib/graphLayoutTypes";
import { useGraphLayout } from "./useGraphLayout";

function deferredRunner() {
  const pending: { input: LayoutInput; resolve: (positions: Positions) => void }[] = [];
  const run = (input: LayoutInput) => new Promise<Positions>((resolve) => pending.push({ input, resolve }));
  return { run, pending };
}

describe("useGraphLayout", () => {
  it("lays out a graph and hands back its positions", async () => {
    const runner = deferredRunner();
    const input = { nodes: [{ id: "a" }], edges: [] };
    const { result } = renderHook(() => useGraphLayout(input, runner.run));
    expect(result.current).toBe(null);
    await act(async () => runner.pending[0]!.resolve({ a: { x: 1, y: 2 } }));
    expect(result.current).toEqual({ a: { x: 1, y: 2 } });
  });

  it("drops a layout that finishes after the graph has changed", async () => {
    const runner = deferredRunner();
    const first = { nodes: [{ id: "a" }], edges: [] };
    const second = { nodes: [{ id: "b" }], edges: [] };
    const { result, rerender } = renderHook(({ input }) => useGraphLayout(input, runner.run), { initialProps: { input: first } });
    rerender({ input: second });
    await act(async () => runner.pending[0]!.resolve({ a: { x: 1, y: 1 } }));
    expect(result.current).toBe(null);
    await act(async () => runner.pending[1]!.resolve({ b: { x: 2, y: 2 } }));
    expect(result.current).toEqual({ b: { x: 2, y: 2 } });
  });

  it("has nothing to lay out without a graph", () => {
    const runner = deferredRunner();
    const { result } = renderHook(() => useGraphLayout(null, runner.run));
    expect(result.current).toBe(null);
    expect(runner.pending).toHaveLength(0);
  });
});
