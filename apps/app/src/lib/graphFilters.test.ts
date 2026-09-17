import { describe, expect, it } from "vitest";
import type { VaultGraph } from "@trypthos/domain";
import { hiddenNodes, linkingNote, neighboursOf, searchMatches, stepSelection } from "./graphFilters";

const graph: VaultGraph = {
  nodes: [
    { id: "V/Alpha.md", kind: "note", label: "Alpha", path: "V/Alpha.md", degree: 3 },
    { id: "V/Beta.md", kind: "note", label: "Beta", path: "V/Beta.md", degree: 1 },
    { id: "V/Lonely.md", kind: "note", label: "Lonely", path: "V/Lonely.md", degree: 1 },
    { id: "V/pic.png", kind: "attachment", label: "pic.png", path: "V/pic.png", degree: 1 },
    { id: "ghost:gamma", kind: "ghost", label: "Gamma", path: null, degree: 1 },
    { id: "tag:inbox", kind: "tag", label: "#inbox", path: null, degree: 1 },
  ],
  edges: [
    { source: "V/Alpha.md", target: "V/Beta.md", both: false },
    { source: "V/Alpha.md", target: "V/pic.png", both: false },
    { source: "V/Alpha.md", target: "ghost:gamma", both: false },
    { source: "V/Lonely.md", target: "tag:inbox", both: false },
  ],
};

const all = { notes: true, attachments: true, tags: true, unresolved: true, orphans: true };

describe("which nodes a filter hides", () => {
  it("hides nothing with every chip on", () => {
    expect([...hiddenNodes(graph, all)]).toEqual([]);
  });

  it("hides each kind by its own chip", () => {
    expect([...hiddenNodes(graph, { ...all, attachments: false })]).toEqual(["V/pic.png"]);
    expect([...hiddenNodes(graph, { ...all, tags: false })]).toEqual(["tag:inbox"]);
    expect([...hiddenNodes(graph, { ...all, unresolved: false })]).toEqual(["ghost:gamma"]);
    expect([...hiddenNodes(graph, { ...all, notes: false })]).toEqual(["V/Alpha.md", "V/Beta.md", "V/Lonely.md"]);
  });

  it("counts a note linked only to tags as an orphan, whether or not tags are shown", () => {
    expect([...hiddenNodes(graph, { ...all, orphans: false })]).toEqual(["V/Lonely.md"]);
    expect([...hiddenNodes(graph, { ...all, orphans: false, tags: false })].sort()).toEqual(["V/Lonely.md", "tag:inbox"]);
  });

  it("never hides the node it is told to keep", () => {
    expect([...hiddenNodes(graph, { ...all, orphans: false }, "V/Lonely.md")]).toEqual([]);
  });
});

describe("searching the graph", () => {
  it("matches labels case-insensitively, exact first, then prefix, then anywhere", () => {
    const withMore: VaultGraph = {
      nodes: [...graph.nodes, { id: "V/Alphabet.md", kind: "note", label: "Alphabet", path: "V/Alphabet.md", degree: 0 }, { id: "V/Beta alpha.md", kind: "note", label: "Beta alpha", path: "V/Beta alpha.md", degree: 0 }],
      edges: graph.edges,
    };
    expect(searchMatches(withMore, "ALPHA")).toEqual(["V/Alpha.md", "V/Alphabet.md", "V/Beta alpha.md"]);
  });

  it("matches nothing for an empty query", () => {
    expect(searchMatches(graph, "   ")).toEqual([]);
  });
});

describe("moving around the graph", () => {
  it("knows a node's neighbours in both directions", () => {
    expect([...neighboursOf(graph, "V/Beta.md")]).toEqual(["V/Alpha.md"]);
    expect([...neighboursOf(graph, "V/Alpha.md")].sort()).toEqual(["V/Beta.md", "V/pic.png", "ghost:gamma"]);
  });

  it("starts from the fallback, then steps to visible neighbours in label order", () => {
    const hidden = new Set(["V/pic.png"]);
    expect(stepSelection(graph, hidden, null, "V/Alpha.md", 1)).toBe("V/Alpha.md");
    expect(stepSelection(graph, hidden, "V/Alpha.md", null, 1)).toBe("V/Beta.md");
    expect(stepSelection(graph, hidden, "V/Alpha.md", null, -1)).toBe("ghost:gamma");
  });

  it("stays put on a node with no visible neighbours", () => {
    expect(stepSelection(graph, new Set(["tag:inbox"]), "V/Lonely.md", null, 1)).toBe("V/Lonely.md");
  });

  it("finds the note that links to a ghost", () => {
    expect(linkingNote(graph, "ghost:gamma")).toBe("V/Alpha.md");
    expect(linkingNote(graph, "ghost:none")).toBe(null);
  });
});
