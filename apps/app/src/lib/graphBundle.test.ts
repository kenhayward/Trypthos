import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { stripComments } from "../testing/stripComments";

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

const LIBRARY_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s+["'](?:sigma|graphology|graphology-[\w-]+|@sigma\/[\w-]+)(?:\/[^"']*)?["']/m;
const GRAPH_MODULE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?from\s+["']\.{1,2}\/(?:[\w.]+\/)*(?:GraphPage|LocalGraph|GraphCanvas|graphLayout|graphLayout\.worker|layoutClient)(?:\?[^"']*)?["']/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .map((file) => ({ file: relative(SRC, file).split(sep).join("/"), text: stripComments(readFileSync(file, "utf8")) }))
    .filter(({ file, text }) => pattern.test(text) && !GRAPH_ONLY.has(file))
    .map(({ file }) => file);
}

describe("the graph stays out of the initial bundle", () => {
  it("imports sigma and graphology only from the lazy graph modules", () => {
    expect(offenders(LIBRARY_IMPORT)).toEqual([]);
  });

  it("reaches the lazy graph modules only through a dynamic import", () => {
    expect(offenders(GRAPH_MODULE_IMPORT)).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(LIBRARY_IMPORT.test('import Sigma from "sigma";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { EdgeArrowProgram } from "sigma/rendering";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import forceAtlas2 from "graphology-layout-forceatlas2";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import { createNodeImageProgram } from "@sigma/node-image";')).toBe(true);
    expect(LIBRARY_IMPORT.test('import type Sigma from "sigma";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('import GraphPage from "./components/GraphPage";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import Worker from "./graphLayout.worker?worker&inline";')).toBe(true);
    expect(GRAPH_MODULE_IMPORT.test('import type { Positions } from "../lib/graphLayoutTypes";')).toBe(false);
    expect(GRAPH_MODULE_IMPORT.test('const GraphPage = lazy(() => import("./components/GraphPage"));')).toBe(false);
  });
});
