import { describe, expect, it } from "vitest";
import { applyIndexChange, buildGraph, EMPTY_INDEX, isNotePath, neighbourhood } from "./vaultGraph";
import type { VaultIndexInput } from "./vaultGraph";
import type { NoteReferences } from "./vaultLinks";
import { pickWikiTarget, wikiLinkFileName } from "./wikiLink";

const refs = (links: NoteReferences["links"] = [], tags: string[] = []): NoteReferences => ({ links, tags });
const wiki = (target: string) => ({ kind: "wiki" as const, target });
const path = (value: string) => ({ kind: "path" as const, path: value });

function input(files: string[], references: Record<string, NoteReferences>): VaultIndexInput {
  return { files, references: new Map(Object.entries(references)) };
}

const node = (graph: ReturnType<typeof buildGraph>, id: string) => graph.nodes.find((n) => n.id === id);

describe("which files are notes", () => {
  it("is decided by the markdown file type", () => {
    expect(isNotePath("V/Plan.md")).toBe(true);
    expect(isNotePath("V/a/Plan.MARKDOWN")).toBe(true);
    expect(isNotePath("V/diagram.png")).toBe(false);
  });
});

describe("building the graph", () => {
  it("draws every file, notes and attachments, with labels", () => {
    const graph = buildGraph(input(["V/Plan.md", "V/img/diagram.png"], { "V/Plan.md": refs() }));
    expect(graph.nodes).toEqual([
      { id: "V/Plan.md", kind: "note", label: "Plan", path: "V/Plan.md", degree: 0 },
      { id: "V/img/diagram.png", kind: "attachment", label: "diagram.png", path: "V/img/diagram.png", degree: 0 },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("resolves a wiki link to the note in the linking note's folder first, then the shortest path", () => {
    const files = ["V/a/Plan.md", "V/b/Plan.md", "V/b/deep/Plan.md", "V/a/Home.md", "V/Top.md"];
    const graph = buildGraph(
      input(files, {
        "V/a/Home.md": refs([wiki("Plan")]),
        "V/Top.md": refs([wiki("Plan")]),
        "V/a/Plan.md": refs(),
        "V/b/Plan.md": refs(),
        "V/b/deep/Plan.md": refs(),
      }),
    );
    expect(graph.edges).toContainEqual({ source: "V/a/Home.md", target: "V/a/Plan.md", both: false });
    expect(graph.edges).toContainEqual({ source: "V/Top.md", target: "V/a/Plan.md", both: false });
  });

  it("agrees with pickWikiTarget for every link, so the graph and the editor never disagree", () => {
    const files = ["V/x/Note.md", "V/y/Note.md", "V/y/From.md", "V/Other.md"];
    const links = ["Note", "y/Note", "Other", "x/Note"];
    const graph = buildGraph(input(files, { "V/y/From.md": refs(links.map(wiki)) }));
    for (const target of links) {
      const expected = pickWikiTarget(files, wikiLinkFileName(target), "V/y/From.md");
      expect(graph.edges).toContainEqual({ source: "V/y/From.md", target: expected!, both: false });
    }
  });

  it("resolves a markdown link by path, with or without the extension", () => {
    const files = ["V/notes/From.md", "V/Other note.md", "V/img/x.png"];
    const graph = buildGraph(
      input(files, { "V/notes/From.md": refs([path("../Other note.md"), path("../img/x.png"), path("/Other note")]) }),
    );
    expect(graph.edges).toEqual([
      { source: "V/notes/From.md", target: "V/Other note.md", both: false },
      { source: "V/notes/From.md", target: "V/img/x.png", both: false },
    ]);
  });

  it("drops a markdown link that climbs out of the vault", () => {
    const graph = buildGraph(input(["V/From.md"], { "V/From.md": refs([path("../../etc/passwd")]) }));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
  });

  it("collapses every unresolved link to one name into one ghost", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("Risks")]), "V/B.md": refs([wiki("risks")]) }),
    );
    expect(node(graph, "ghost:risks")).toEqual({ id: "ghost:risks", kind: "ghost", label: "Risks", path: null, degree: 2 });
  });

  // One missing note, one ghost - however it was linked to. Keyed differently, a vault that links
  // to the same absent note both ways grows two nodes for it, and creating the note from one leaves
  // the other still hanging.
  it("gives a wiki link and a markdown link to the same missing note one ghost", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], {
        "V/A.md": refs([wiki("Plans/Risks")]),
        "V/B.md": refs([path("Plans/Risks.md")]),
      }),
    );
    expect(graph.nodes.filter((n) => n.kind === "ghost").map((n) => n.id)).toEqual(["ghost:plans/risks"]);
    expect(node(graph, "ghost:plans/risks")!.degree).toBe(2);
  });

  it("draws two notes linking to each other as one edge marked both", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("B")]), "V/B.md": refs([wiki("A")]) }),
    );
    expect(graph.edges).toEqual([{ source: "V/A.md", target: "V/B.md", both: true }]);
    expect(node(graph, "V/A.md")!.degree).toBe(1);
  });

  it("drops a note's link to itself", () => {
    const graph = buildGraph(input(["V/A.md"], { "V/A.md": refs([wiki("A")]) }));
    expect(graph.edges).toEqual([]);
  });

  it("links notes to shared tag nodes", () => {
    const graph = buildGraph(
      input(["V/A.md", "V/B.md"], { "V/A.md": refs([], ["inbox"]), "V/B.md": refs([], ["inbox", "project/atlas"]) }),
    );
    expect(node(graph, "tag:inbox")).toEqual({ id: "tag:inbox", kind: "tag", label: "#inbox", path: null, degree: 2 });
    expect(node(graph, "tag:project/atlas")!.label).toBe("#project/atlas");
    expect(graph.edges).toContainEqual({ source: "V/B.md", target: "tag:inbox", both: false });
  });

  it("is deterministic whatever order the files arrive in", () => {
    const refsFor = { "V/A.md": refs([wiki("B")]), "V/B.md": refs([wiki("C")]), "V/C.md": refs() };
    const one = buildGraph(input(["V/A.md", "V/B.md", "V/C.md"], refsFor));
    const two = buildGraph(input(["V/C.md", "V/A.md", "V/B.md"], refsFor));
    expect(two).toEqual(one);
  });
});

describe("a note's neighbourhood", () => {
  const graph = buildGraph(
    input(["V/A.md", "V/B.md", "V/C.md", "V/D.md"], {
      "V/A.md": refs([wiki("B")]),
      "V/B.md": refs([wiki("C")]),
      "V/C.md": refs([wiki("D")]),
      "V/D.md": refs(),
    }),
  );

  it("follows links in either direction to the depth asked", () => {
    expect(neighbourhood(graph, "V/B.md", 1).nodes.map((n) => n.id)).toEqual(["V/A.md", "V/B.md", "V/C.md"]);
    expect(neighbourhood(graph, "V/A.md", 3).nodes.map((n) => n.id)).toEqual(["V/A.md", "V/B.md", "V/C.md", "V/D.md"]);
  });

  it("keeps only edges between the nodes it kept", () => {
    expect(neighbourhood(graph, "V/A.md", 1).edges).toEqual([{ source: "V/A.md", target: "V/B.md", both: false }]);
  });

  it("is empty for a node that is not in the graph", () => {
    expect(neighbourhood(graph, "V/Missing.md", 2)).toEqual({ nodes: [], edges: [] });
  });
});

describe("updating the index", () => {
  it("adds a newly written note and turns the ghost it satisfies into a note", () => {
    const before = input(["V/A.md"], { "V/A.md": refs([wiki("Risks")]) });
    const after = applyIndexChange(before, { kind: "written", path: "V/Risks.md", references: refs() });
    const graph = buildGraph(after);
    expect(node(graph, "ghost:risks")).toBeUndefined();
    expect(graph.edges).toEqual([{ source: "V/A.md", target: "V/Risks.md", both: false }]);
    expect(before.files).toEqual(["V/A.md"]);
  });

  it("replaces a saved note's links and drops a tag no note carries any more", () => {
    const before = input(["V/A.md"], { "V/A.md": refs([], ["inbox"]) });
    const after = applyIndexChange(before, { kind: "written", path: "V/A.md", references: refs() });
    expect(node(buildGraph(after), "tag:inbox")).toBeUndefined();
  });

  it("renames a file, leaving links to the old name as ghosts", () => {
    const before = input(["V/A.md", "V/B.md"], { "V/A.md": refs([wiki("B")]), "V/B.md": refs([], ["x"]) });
    const after = applyIndexChange(before, { kind: "renamed", from: "V/B.md", to: "V/C.md" });
    const graph = buildGraph(after);
    expect(node(graph, "V/C.md")!.kind).toBe("note");
    expect(node(graph, "ghost:b")).toBeDefined();
    expect(graph.edges).toContainEqual({ source: "V/C.md", target: "tag:x", both: false });
  });

  it("leaves the index alone for a rename it does not know as a file", () => {
    const before = input(["V/a/A.md"], { "V/a/A.md": refs() });
    expect(applyIndexChange(before, { kind: "renamed", from: "V/a", to: "V/b" })).toBe(before);
  });

  it("starts empty", () => {
    expect(buildGraph(EMPTY_INDEX)).toEqual({ nodes: [], edges: [] });
  });
});
