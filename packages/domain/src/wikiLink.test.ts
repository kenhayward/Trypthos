import { describe, expect, it } from "vitest";
import { parseWikiLink, pickWikiTarget, wikiLinkFileName } from "./wikiLink";

describe("parseWikiLink", () => {
  it.each([
    ["Plan", { target: "Plan", heading: null, block: null, alias: null }],
    ["Plan|the plan", { target: "Plan", heading: null, block: null, alias: "the plan" }],
    ["Plan#Goals", { target: "Plan", heading: "Goals", block: null, alias: null }],
    ["Plan#Goals#This year", { target: "Plan", heading: "This year", block: null, alias: null }],
    ["Plan#^quote-1", { target: "Plan", heading: null, block: "quote-1", alias: null }],
    ["#Goals", { target: "", heading: "Goals", block: null, alias: null }],
    ["Projects/Plan.md|p", { target: "Projects/Plan.md", heading: null, block: null, alias: "p" }],
    ["diagram.png|100x145", { target: "diagram.png", heading: null, block: null, alias: "100x145" }],
  ])("reads [[%s]]", (inner, expected) => {
    expect(parseWikiLink(inner)).toEqual(expected);
  });
});

describe("wikiLinkFileName", () => {
  it("adds .md to a note named without an extension, and keeps any other", () => {
    expect(wikiLinkFileName("Plan")).toBe("Plan.md");
    expect(wikiLinkFileName("Projects/Plan")).toBe("Projects/Plan.md");
    expect(wikiLinkFileName("diagram.png")).toBe("diagram.png");
    expect(wikiLinkFileName("Plan.md")).toBe("Plan.md");
  });

  // A dot in a note's name is not an extension unless it is one Obsidian would treat as a file.
  it("treats a dot that ends no known extension as part of the name", () => {
    expect(wikiLinkFileName("v1.2 release")).toBe("v1.2 release.md");
  });
});

/// Which file a wiki link means, among the files whose name matches.
///
/// Obsidian finds a note by its name anywhere in the vault, preferring the one closest to the note
/// doing the linking - so a link written in one folder does not land on a same-named file in another
/// when there is one right beside it.
describe("pickWikiTarget", () => {
  const found = ["Notes/archive/2024/Plan.md", "Notes/Plan.md", "Notes/projects/Plan.md", "Notes/other.md"];

  it("prefers the file in the linking note's own folder", () => {
    expect(pickWikiTarget(found, "Plan.md", "Notes/projects/today.md")).toBe("Notes/projects/Plan.md");
  });

  it("otherwise takes the shortest path", () => {
    expect(pickWikiTarget(found, "Plan.md", "Notes/elsewhere/today.md")).toBe("Notes/Plan.md");
  });

  it("matches the name ignoring case, and only the whole name", () => {
    expect(pickWikiTarget(["Notes/MyPlan.md", "Notes/deep/PLAN.MD"], "plan.md", null)).toBe("Notes/deep/PLAN.MD");
  });

  // A link with a folder names that folder from the vault's root.
  it("follows a link that names folders", () => {
    expect(pickWikiTarget(found, "projects/Plan.md", null)).toBe("Notes/projects/Plan.md");
    expect(pickWikiTarget(found, "missing/Plan.md", null)).toBeNull();
  });

  it("answers null when nothing matches", () => {
    expect(pickWikiTarget(found, "Nope.md", null)).toBeNull();
  });
});
