import { describe, expect, it } from "vitest";
import { formatCaret } from "./caret";

/// The caret readout, which moved to the status bar when the tab strip took the header's row.
///
/// The document's own name went the other way, to its tab, and the domain's `documentName` answers
/// that now - one implementation for the tab, the close button and the discard prompt.
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
