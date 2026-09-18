import { describe, expect, it } from "vitest";
import { homeSections, openingSection } from "./homeSections";

/// A section exists only when it has something in it. A graph with no edges is a field of dots, which
/// is worse than no graph, and a README section with no README is a heading over nothing.

describe("a home page's sections", () => {
  it("has a graph only when something links to something", () => {
    expect(homeSections({ edges: 0, hasReadme: false })).toEqual([]);
    expect(homeSections({ edges: 1, hasReadme: false })).toEqual(["graph"]);
  });

  it("has a readme only when there is one", () => {
    expect(homeSections({ edges: 0, hasReadme: true })).toEqual(["readme"]);
  });

  it("lists the graph first when there are both", () => {
    expect(homeSections({ edges: 3, hasReadme: true })).toEqual(["graph", "readme"]);
  });
});

describe("which section a page opens on", () => {
  it("opens on the graph when there is one", () => {
    expect(openingSection(["graph", "readme"])).toBe("graph");
  });

  it("opens on the readme otherwise", () => {
    expect(openingSection(["readme"])).toBe("readme");
  });

  it("opens on nothing when there is nothing", () => {
    expect(openingSection([])).toBe(null);
  });
});
