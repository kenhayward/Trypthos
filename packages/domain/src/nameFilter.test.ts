import { describe, expect, it } from "vitest";
import { FILTER_MATCH_LIMIT, FilterRequest, hasWildcards, matchesName } from "./nameFilter";

describe("matchesName", () => {
  it("matches anywhere in the name when there is no wildcard", () => {
    expect(matchesName("release-notes.md", "notes")).toBe(true);
    expect(matchesName("release-notes.md", "chapter")).toBe(false);
  });

  it("ignores case, in both directions", () => {
    expect(matchesName("README.md", "readme")).toBe(true);
    expect(matchesName("readme.md", "README")).toBe(true);
  });

  it("ignores the spaces around a filter somebody pasted", () => {
    expect(matchesName("notes.md", "  notes  ")).toBe(true);
  });

  // An empty filter is not a question, so it is not an answer either: the panel shows the tree it
  // was already showing rather than every file in the workspace.
  it("matches everything when there is no filter", () => {
    expect(matchesName("notes.md", "")).toBe(true);
    expect(matchesName("notes.md", "   ")).toBe(true);
  });

  // The Windows search box: `*` is any run of characters, `?` is exactly one, and a filter that
  // uses either has to match the WHOLE name - `*.md` means "ends in .md", not "contains .md".
  it("takes * as any run of characters, anchored at both ends", () => {
    expect(matchesName("notes.md", "*.md")).toBe(true);
    expect(matchesName("notes.md.bak", "*.md")).toBe(false);
    expect(matchesName("chapter-one.md", "chapter*")).toBe(true);
    expect(matchesName("one-chapter.md", "chapter*")).toBe(false);
    expect(matchesName("chapter-one.md", "*one*")).toBe(true);
  });

  it("takes ? as exactly one character", () => {
    expect(matchesName("ch1.md", "ch?.md")).toBe(true);
    expect(matchesName("ch12.md", "ch?.md")).toBe(false);
    expect(matchesName("ch.md", "ch?.md")).toBe(false);
    expect(matchesName("ch12.md", "ch??.md")).toBe(true);
  });

  it("matches a bare * against every name", () => {
    expect(matchesName("notes.md", "*")).toBe(true);
    expect(matchesName("archive.zip", "*")).toBe(true);
  });

  // Everything that is not `*` or `?` is a character, not a pattern. A filter of `notes.md` must
  // not have its dot read as "any character", and one containing `(` must not fail to compile.
  it("treats every other character literally", () => {
    expect(matchesName("notesxmd", "*notes.md")).toBe(false);
    expect(matchesName("notes (2).md", "notes (2)*")).toBe(true);
    expect(matchesName("a+b.md", "a+b*")).toBe(true);
    expect(matchesName("ab.md", "a+b*")).toBe(false);
  });

  // The one character a filter cannot ask about. A name is one segment, so a filter carrying a
  // separator would be describing a path - and would then match nothing, for ever, in silence.
  it("never matches a filter that names a path", () => {
    expect(matchesName("notes.md", "docs/notes.md")).toBe(false);
  });
});

describe("hasWildcards", () => {
  it("knows which filters are patterns", () => {
    expect(hasWildcards("notes")).toBe(false);
    expect(hasWildcards("*.md")).toBe(true);
    expect(hasWildcards("ch?.md")).toBe(true);
  });
});

describe("FilterRequest", () => {
  it("accepts a folder and a filter", () => {
    expect(FilterRequest.safeParse({ path: "Notes/docs", filter: "*.md" }).success).toBe(true);
  });

  // An empty filter would walk the whole tree to answer a question nobody asked.
  it("refuses an empty filter", () => {
    expect(FilterRequest.safeParse({ path: "Notes", filter: "" }).success).toBe(false);
  });

  it("refuses anything else in the payload", () => {
    expect(FilterRequest.safeParse({ path: "Notes", filter: "a", depth: 99 }).success).toBe(false);
  });
});

describe("the limits", () => {
  // A bound on effort, not on taste - see the walk. Asserted so a change to it is a deliberate one.
  it("caps how many matches one filter reports", () => {
    expect(FILTER_MATCH_LIMIT).toBeGreaterThan(100);
  });
});
