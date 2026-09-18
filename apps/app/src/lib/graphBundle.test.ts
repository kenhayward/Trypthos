import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { offenders, STATIC_LOAD } from "../testing/moduleGraph";

/// The graph libraries and the modules built on them stay out of the initial bundle.
///
/// Nothing but who imports what enforces it: a static import of sigma from an eager module
/// type-checks, renders and passes every other test while putting WebGL programs and a layout
/// engine on every page load. So the allowed importers are listed, and everyone else must reach
/// them through `lazy(() => import(...))`.

const SRC = repoPath("apps", "app", "src");

const GRAPH_ONLY = new Set([
  "components/GraphPage.tsx",
  "components/LocalGraph.tsx",
  "components/GraphCanvas.tsx",
  "lib/graphLayout.ts",
  "lib/graphLayout.worker.ts",
  "lib/layoutClient.ts",
]);

const LIBRARY_IMPORT = new RegExp(
  `^\\s*${STATIC_LOAD}["'](?:sigma|graphology|graphology-[\\w-]+|@sigma\\/[\\w-]+)(?:\\/[^"']*)?["']`,
  "m",
);
const GRAPH_MODULE_IMPORT = new RegExp(
  `^\\s*${STATIC_LOAD}["']\\.{1,2}\\/(?:[\\w.]+\\/)*(?:GraphPage|LocalGraph|GraphCanvas|graphLayout|graphLayout\\.worker|layoutClient)(?:\\.tsx?)?(?:\\?[^"']*)?["']`,
  "m",
);

describe("the graph stays out of the initial bundle", () => {
  it("imports sigma and graphology only from the lazy graph modules", () => {
    expect(offenders(SRC, LIBRARY_IMPORT, GRAPH_ONLY)).toEqual([]);
  });

  it("reaches the lazy graph modules only through a dynamic import", () => {
    expect(offenders(SRC, GRAPH_MODULE_IMPORT, GRAPH_ONLY)).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(LIBRARY_IMPORT.test('import Sigma from "sigma";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { EdgeArrowProgram } from "sigma/rendering";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import forceAtlas2 from "graphology-layout-forceatlas2";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { createNodeImageProgram } from "@sigma/node-image";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import "sigma";')).toBe(true);
    expect(LIBRARY_IMPORT.test('export { default } from "sigma";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import type Sigma from "sigma";')).toBe(false);
    expect(LIBRARY_IMPORT.test('export type { NodeDisplayData } from "sigma";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('import GraphPage from "./components/GraphPage";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import Worker from "./graphLayout.worker?worker&inline";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('export * from "./components/GraphCanvas";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import GraphCanvas from "./GraphCanvas.tsx";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import type { Positions } from "../lib/graphLayoutTypes";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('const GraphPage = lazy(() => import("./components/GraphPage"));')).toBe(false);
  });
});
