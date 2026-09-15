import { describe, expect, it } from "vitest";
import { embeddedSection } from "./noteEmbed";

/// What `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]` show of the note they name.

const NOTE = [
  "---",
  "tags: [plan]",
  "---",
  "# Plan",
  "",
  "Intro paragraph.",
  "",
  "## Goals",
  "",
  "Ship it. ^goal-1",
  "",
  "### Stretch",
  "",
  "Also this.",
  "",
  "## Risks",
  "",
  "- Late",
  "- Over budget ^risk-2",
  "  - by a lot",
  "- Scope",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "^table-1",
  "",
  "```md",
  "## Not a heading",
  "Text ^not-a-block",
  "```",
].join("\n");

const embed = (heading: string | null, block: string | null) => embeddedSection(NOTE, { heading, block });

describe("embeddedSection", () => {
  it("shows the whole note, without its front matter", () => {
    const whole = embed(null, null);
    expect(whole?.startsWith("# Plan")).toBe(true);
    expect(whole).not.toContain("tags:");
  });

  it("shows a heading and everything under it, down to the next heading as high", () => {
    expect(embed("Goals", null)).toBe("## Goals\n\nShip it. ^goal-1\n\n### Stretch\n\nAlso this.");
  });

  it("matches a heading ignoring case and surrounding space", () => {
    expect(embed("  goals ", null)?.startsWith("## Goals")).toBe(true);
  });

  it("shows a last heading to the end of the note", () => {
    expect(embed("Risks", null)?.endsWith("```")).toBe(true);
  });

  it("shows a paragraph by its block id, without the id", () => {
    expect(embed(null, "goal-1")).toBe("Ship it.");
  });

  it("shows a list item by its block id, with what is nested under it", () => {
    expect(embed(null, "risk-2")).toBe("- Over budget\n  - by a lot");
  });

  // An id on a line of its own names the block just above it - how a table or a whole list is named.
  it("shows the block above an id written on a line of its own", () => {
    expect(embed(null, "table-1")).toBe("| a | b |\n|---|---|\n| 1 | 2 |");
  });

  // Code shows syntax rather than using it.
  it("finds nothing inside code", () => {
    expect(embed("Not a heading", null)).toBeNull();
    expect(embed(null, "not-a-block")).toBeNull();
  });

  it("answers null for a heading or block the note does not have", () => {
    expect(embed("Missing", null)).toBeNull();
    expect(embed(null, "missing")).toBeNull();
  });
});
