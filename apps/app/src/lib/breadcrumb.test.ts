import { describe, expect, it } from "vitest";
import { breadcrumbSegments, formatCaret } from "./breadcrumb";

describe("breadcrumbSegments", () => {
  it("is the workspace alone when no file is open", () => {
    expect(breadcrumbSegments("Diariz", null)).toEqual(["Diariz"]);
  });

  it("puts the workspace first, then each folder, then the file", () => {
    expect(breadcrumbSegments("Diariz", "docs/specs/plan.md")).toEqual([
      "Diariz",
      "docs",
      "specs",
      "plan.md",
    ]);
  });

  it("handles a file at the workspace root", () => {
    expect(breadcrumbSegments("Diariz", "README.md")).toEqual(["Diariz", "README.md"]);
  });

  it("is just the file when no workspace is open", () => {
    expect(breadcrumbSegments(null, "scratch.md")).toEqual(["scratch.md"]);
  });

  it("is empty when there is neither", () => {
    expect(breadcrumbSegments(null, null)).toEqual([]);
  });

  // Paths arrive workspace-relative and slash-separated, but a leading or doubled slash would
  // otherwise produce empty segments that render as stray separators.
  it("drops empty segments rather than rendering stray separators", () => {
    expect(breadcrumbSegments("Diariz", "/docs//plan.md")).toEqual(["Diariz", "docs", "plan.md"]);
  });
});

describe("formatCaret", () => {
  it("reads as line and column, one-based", () => {
    expect(formatCaret(8, 14)).toBe("Ln 8, Col 14");
  });

  // CodeMirror counts columns from zero and lines from one. Showing a zero column for the start of a
  // line contradicts every other editor a person has used.
  it("shows the start of a line as column 1", () => {
    expect(formatCaret(1, 1)).toBe("Ln 1, Col 1");
  });
});
