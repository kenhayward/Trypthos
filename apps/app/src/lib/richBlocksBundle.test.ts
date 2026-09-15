import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { stripComments } from "../testing/stripComments";

/// KaTeX and Mermaid stay out of the initial bundle.
///
/// Both are large - Mermaid especially - and a document with no math and no diagrams is nearly every
/// document. `richBlocks` loads them with `import()` the first time one is needed. A static import
/// anywhere would type-check, render correctly and pass every other test while putting both libraries
/// on every cold start, so the module graph is asserted instead.

const SRC = repoPath("apps", "app", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const STATIC_IMPORT = /from\s+["'](?:katex|mermaid)(?:\/[^"']*)?["']|^\s*import\s+["'](?:katex|mermaid)(?:\/[^"']*)?["']/m;

describe("math and diagram libraries stay out of the initial bundle", () => {
  it("are reached only through a dynamic import", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => STATIC_IMPORT.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(STATIC_IMPORT.test('import mermaid from "mermaid";')).toBe(true);
    expect(STATIC_IMPORT.test('import "katex/dist/katex.min.css";')).toBe(true);
    expect(STATIC_IMPORT.test('await import("mermaid")')).toBe(false);
  });
});
