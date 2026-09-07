import { describe, expect, it } from "vitest";
import {
  FIND_FILE_LIMIT,
  FIND_MATCH_LIMIT,
  FindRequest,
  fileHits,
  findMatches,
  searchScopeFolder,
} from "./find";

const TEXT = "The cat sat on the mat.\nAnother cat, another mat.\n";

describe("findMatches: plain text", () => {
  const plain = (query: string, text = TEXT) =>
    findMatches(text, query, { regex: false, caseSensitive: false });

  it("finds every occurrence, in order", () => {
    expect(plain("cat")).toEqual([
      { from: 4, to: 7 },
      { from: 32, to: 35 },
    ]);
  });

  // Matching what the rest of the app does - the folder search a model runs is case-insensitive too,
  // and a Find that missed `Cat` because you typed `cat` is a Find people stop trusting.
  //
  // Four, not two: `The`, `the`, and the middle of `Another` and `another`. A plain search matches
  // characters wherever they are, not whole words.
  it("ignores case", () => {
    expect(plain("THE")).toHaveLength(4);
  });

  // The characters are the query, not a pattern. Somebody searching a document for `a.b` means those
  // three characters, and would be baffled to be shown `axb`.
  it("treats the query as characters, not as a pattern", () => {
    expect(plain("m.t")).toEqual([]);
    expect(plain("mat.", "the mat.")).toEqual([{ from: 4, to: 8 }]);
  });

  it("finds nothing in an empty query rather than everything", () => {
    expect(plain("")).toEqual([]);
  });

  // Non-overlapping, which is the only answer a next/previous button can walk.
  it("does not report overlapping matches", () => {
    expect(findMatches("aaaa", "aa", { regex: false, caseSensitive: false })).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });
});

describe("findMatches: regular expressions", () => {
  const pattern = (query: string, text = TEXT) =>
    findMatches(text, query, { regex: true, caseSensitive: false });

  it("finds what the expression matches", () => {
    expect(pattern("[cm]at")).toHaveLength(4);
  });

  // Null, not an empty list. "That is not a pattern" and "nothing in this document matches" are
  // different answers, and a dialog that showed the second for the first would leave somebody
  // retyping a query that can never work.
  it("answers null for an expression that does not compile", () => {
    expect(pattern("[unclosed")).toBeNull();
  });

  // The trap: a pattern that can match nothing at all. Advanced by its own width, the cursor never
  // moves and the loop never ends - which is a hung window, not a wrong answer.
  it("survives an expression that matches nothing at all", () => {
    const matches = pattern("x*", "abc");
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeLessThanOrEqual(4);
  });

  it("matches across the whole document rather than the first line", () => {
    expect(pattern("^Another")).toHaveLength(1);
  });

  it("ignores case, like a plain search", () => {
    expect(pattern("the")).toHaveLength(4);
  });
});

/// Case sensitivity, which is asked for rather than assumed.
///
/// Off by default in the dialog, because that is what every other search in the app does - but the
/// option exists because a case-insensitive search of a source file is nearly useless: `state`,
/// `State` and `STATE` are three different things in code and one thing in prose.
describe("findMatches: case", () => {
  const at = (query: string, caseSensitive: boolean, regex = false) =>
    findMatches(TEXT, query, { regex, caseSensitive });

  it("matches every casing when it is off", () => {
    expect(at("the", false)).toHaveLength(4);
  });

  it("matches only what was typed when it is on", () => {
    // `The` at the start, and nothing else - not the lowercase `the`, and not the `the` inside
    // `Another` and `another`.
    expect(at("The", true)).toEqual([{ from: 0, to: 3 }]);
    expect(at("THE", true)).toEqual([]);
  });

  it("applies to an expression as well as to plain text", () => {
    expect(at("[tT]he", true, true)).toHaveLength(4);
    expect(at("[T]he", true, true)).toHaveLength(1);
  });
});

describe("findMatches: the cap", () => {
  it("stops at the limit rather than walking a whole book", () => {
    const many = "a".repeat(FIND_MATCH_LIMIT + 500);
    expect(findMatches(many, "a", { regex: false, caseSensitive: false })).toHaveLength(
      FIND_MATCH_LIMIT,
    );
  });
});

describe("fileHits", () => {
  const hits = (text: string, query: string) =>
    fileHits("docs/notes.md", text, query, { regex: false, caseSensitive: false }, 10);

  it("reports where a match is in human terms as well as in offsets", () => {
    const [first, second] = hits(TEXT, "cat") ?? [];

    expect(first).toEqual({
      path: "docs/notes.md",
      line: 1,
      column: 5,
      from: 4,
      to: 7,
      preview: "The cat sat on the mat.",
    });
    // The second is on the second line, and its column counts from the start of THAT line.
    expect(second?.line).toBe(2);
    expect(second?.column).toBe(9);
  });

  // A minified file is one line of forty thousand characters, and a result list that carried it
  // would be a result list nobody can read.
  it("shortens a very long line, and says it did", () => {
    const [hit] = hits(`${"x".repeat(400)}cat`, "cat") ?? [];
    expect(hit!.preview.length).toBeLessThan(250);
    expect(hit!.preview.endsWith("...")).toBe(true);
  });

  it("counts lines the same whichever line ending the file uses", () => {
    const [hit] = hits("one\r\ntwo\r\ncat", "cat") ?? [];
    expect(hit!.line).toBe(3);
    // The offset is into the file as it is on disk, CRLF and all - it has to be, because it is what
    // the editor will highlight.
    expect(hit!.from).toBe(10);
  });

  it("stops at the budget it is given", () => {
    expect(
      fileHits("a.md", "cat cat cat cat", "cat", { regex: false, caseSensitive: false }, 2),
    ).toHaveLength(2);
  });

  it("answers null for an expression that does not compile", () => {
    expect(
      fileHits("a.md", TEXT, "[unclosed", { regex: true, caseSensitive: false }, 10),
    ).toBeNull();
  });
});

/// Which folder "find in files" looks in.
///
/// The rule the user described: the folder they picked, or - when they have picked none - the folder
/// the file they are reading lives in. The dialog says which, because the two can be far apart and a
/// search that quietly looked somewhere else would be worse than one that refused.
describe("searchScopeFolder", () => {
  it("uses the folder that is selected", () => {
    expect(searchScopeFolder({ selectedFolder: "docs/api", activePath: "src/main.ts" })).toBe(
      "docs/api",
    );
  });

  // "" is not a selection: no folder row is drawn as selected, so the open file answers instead.
  it("falls back to the folder the open file is in", () => {
    expect(searchScopeFolder({ selectedFolder: "", activePath: "src/deep/main.ts" })).toBe(
      "src/deep",
    );
  });

  it("uses the root when nothing points anywhere else", () => {
    expect(searchScopeFolder({ selectedFolder: "", activePath: null })).toBe("");
    expect(searchScopeFolder({ selectedFolder: "", activePath: "notes.md" })).toBe("");
  });

  // The built-in guide and an unsaved draft have no folder segment in their paths, so they answer
  // the root without needing a case of their own.
  it("answers the root for a document with no file behind it", () => {
    expect(
      searchScopeFolder({ selectedFolder: "", activePath: "trypthos:markdown-guide" }),
    ).toBe("");
  });
});

describe("FindRequest", () => {
  const valid = {
    path: "docs",
    pattern: "cat",
    regex: false,
    caseSensitive: false,
    fileTypes: ["markdown"],
  };

  it("accepts a well-formed request", () => {
    expect(FindRequest.safeParse(valid).success).toBe(true);
    expect(FindRequest.safeParse({ ...valid, path: "" }).success).toBe(true);
  });

  // The path is deliberately NOT pattern-checked here, following `ListRequest` and `OutlineRequest`:
  // the boundary is the workspace guard the provider applies when it resolves a path, and a second
  // lexical check written into a schema is the per-caller copy that guidance forbids. The shell
  // tests assert the refusal where it actually happens.
  it("accepts a path it cannot itself judge, leaving the boundary to the provider", () => {
    expect(FindRequest.safeParse({ ...valid, path: "../secrets" }).success).toBe(true);
  });

  // Every option is required on the wire. An option that changes which lines come back must not be
  // something a caller can leave out and have decided for it.
  it("requires the search options rather than defaulting them", () => {
    for (const option of ["regex", "caseSensitive"]) {
      const without: Record<string, unknown> = { ...valid };
      delete without[option];
      expect(FindRequest.safeParse(without).success).toBe(false);
    }
  });

  it("refuses an empty pattern, which would match everything", () => {
    expect(FindRequest.safeParse({ ...valid, pattern: "" }).success).toBe(false);
  });

  it("refuses anything it was not told to expect", () => {
    expect(FindRequest.safeParse({ ...valid, follow: true }).success).toBe(false);
  });
});

describe("the limits", () => {
  it("are bounds on effort, not on taste", () => {
    expect(FIND_FILE_LIMIT).toBeGreaterThan(0);
    expect(FIND_MATCH_LIMIT).toBeGreaterThan(0);
  });
});
