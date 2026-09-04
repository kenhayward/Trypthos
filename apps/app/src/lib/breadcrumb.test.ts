import { describe, expect, it } from "vitest";
import { documentName, formatCaret } from "./breadcrumb";

/// The header names the document, and nothing else.
///
/// It used to draw the whole path as segments, and a long workspace or folder name overflowed its
/// own span and printed over the next one - see the header's own note. The name is what identifies
/// the document; where the file lives is in the tree beside it.
describe("documentName", () => {
  it("is the file's own name, not the path to it", () => {
    expect(documentName("docs/specs/plan.md")).toBe("plan.md");
  });

  it("handles a file at the workspace root", () => {
    expect(documentName("README.md")).toBe("README.md");
  });

  it("is null when no file is open", () => {
    expect(documentName(null)).toBeNull();
  });

  // Paths arrive workspace-relative and slash-separated, but a trailing or doubled slash would
  // otherwise produce an empty name and a header with nothing in it.
  it("ignores empty segments rather than answering with nothing", () => {
    expect(documentName("/docs//plan.md")).toBe("plan.md");
    expect(documentName("docs/plan.md/")).toBe("plan.md");
    expect(documentName("")).toBeNull();
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
