import { describe, expect, it } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { attachmentCount, indexAge, linkCount, noteCount, percentRead } from "./graphStatus";

const at = Date.parse("2026-09-17T10:00:00.000Z");

describe("how old an index is", () => {
  it("rounds down to the largest whole unit", () => {
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 59_000)).toEqual({ unit: "now", count: 0 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 2 * 60_000)).toEqual({ unit: "minutes", count: 2 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 3 * 3_600_000)).toEqual({ unit: "hours", count: 3 });
    expect(indexAge("2026-09-17T10:00:00.000Z", at + 50 * 3_600_000)).toEqual({ unit: "days", count: 2 });
  });

  it("calls a clock that runs behind 'now' rather than a negative age", () => {
    expect(indexAge("2026-09-17T10:00:00.000Z", at - 60_000)).toEqual({ unit: "now", count: 0 });
  });
});

describe("progress and counts", () => {
  it("gives a whole percentage, zero before anything is known", () => {
    expect(percentRead({ read: 1, total: 3 })).toBe(33);
    expect(percentRead({ read: 0, total: 0 })).toBe(0);
    expect(percentRead({ read: 5, total: 4 })).toBe(100);
  });

  it("counts notes, and links other than tags", () => {
    const graph: VaultGraph = {
      nodes: [
        { id: "V/A.md", kind: "note", label: "A", path: "V/A.md", degree: 2 },
        { id: "V/B.md", kind: "note", label: "B", path: "V/B.md", degree: 1 },
        { id: "tag:x", kind: "tag", label: "#x", path: null, degree: 1 },
      ],
      edges: [
        { source: "V/A.md", target: "V/B.md", both: true },
        { source: "V/A.md", target: "tag:x", both: false },
      ],
    };
    expect(noteCount(graph)).toBe(2);
    expect(linkCount(graph)).toBe(1);
  });
});

describe("counting attachments", () => {
  // A ghost is a note that does not exist yet and a tag is not a file, so neither is an attachment.
  it("counts attachments, and nothing else", () => {
    const graph: VaultGraph = {
      nodes: [
        { id: "V/a.md", kind: "note", label: "a", path: "V/a.md", degree: 0 },
        { id: "V/b.png", kind: "attachment", label: "b.png", path: "V/b.png", degree: 0 },
        { id: "ghost:c", kind: "ghost", label: "c", path: null, degree: 0 },
        { id: "tag:d", kind: "tag", label: "#d", path: null, degree: 0 },
      ],
      edges: [],
    };
    expect(attachmentCount(graph)).toBe(1);
  });
});
