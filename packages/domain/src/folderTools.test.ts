import { describe, expect, it } from "vitest";
import {
  DIFF_TOOL_NAME,
  LIST_TOOL_NAME,
  SEARCH_TOOL_NAME,
  diffArguments,
  folderTools,
  listArguments,
  searchArguments,
  searchExpression,
  withinFolder,
} from "./folderTools";

describe("folderTools", () => {
  it("offers the three ways of looking around a folder", () => {
    expect(folderTools().map((tool) => tool.function.name)).toEqual([
      LIST_TOOL_NAME,
      SEARCH_TOOL_NAME,
      DIFF_TOOL_NAME,
    ]);
  });

  // The descriptions are part of the request and are read by the model. Each has to say what the
  // tool refuses as well as what it does, or the model spends turns finding out.
  it("tells the model what each one may reach", () => {
    for (const tool of folderTools()) {
      expect(tool.function.description.length).toBeGreaterThan(60);
    }
  });

  it("asks for only what each one needs", () => {
    const required = Object.fromEntries(
      folderTools().map((tool) => [tool.function.name, tool.function.parameters.required]),
    );
    expect(required[LIST_TOOL_NAME]).toEqual([]);
    expect(required[SEARCH_TOOL_NAME]).toEqual(["pattern"]);
    expect(required[DIFF_TOOL_NAME]).toEqual(["left", "right"]);
  });
});

/// Reading a call's arguments, which arrive as a JSON string a provider streamed in pieces.
///
/// Total throughout: a call cut off mid-object is an ordinary outcome, and null means "answer that
/// this cannot be done" rather than "throw".
describe("reading arguments", () => {
  it("reads a listing", () => {
    expect(listArguments('{"path":"docs"}')).toEqual({ path: "docs" });
  });

  // No path means "where you told me to look", which only the caller can resolve - it is the one
  // that knows which folder was attached.
  it("reads a listing with no path as no path", () => {
    expect(listArguments("{}")).toEqual({ path: null });
    expect(listArguments('{"path":"  "}')).toEqual({ path: null });
  });

  it("reads a search", () => {
    expect(searchArguments('{"pattern":"TODO","path":"src"}')).toEqual({
      pattern: "TODO",
      path: "src",
    });
    expect(searchArguments('{"pattern":"TODO"}')).toEqual({ pattern: "TODO", path: null });
  });

  it("has no answer for a search with nothing to search for", () => {
    expect(searchArguments('{"pattern":"   "}')).toBeNull();
    expect(searchArguments("{}")).toBeNull();
  });

  it("reads a comparison", () => {
    expect(diffArguments('{"left":"a.md","right":"b.md"}')).toEqual({
      left: "a.md",
      right: "b.md",
    });
  });

  it("has no answer for a comparison missing a side", () => {
    expect(diffArguments('{"left":"a.md"}')).toBeNull();
    expect(diffArguments('{"left":"a.md","right":""}')).toBeNull();
  });

  // A model streams arguments as a string, so every prefix of one is invalid JSON and only the last
  // is not.
  it("has no answer for a call that never finished", () => {
    expect(listArguments('{"path":"do')).toBeNull();
    expect(searchArguments("")).toBeNull();
    expect(diffArguments("not json")).toBeNull();
  });

  // A model adding a field nobody asked for is ordinary. Dropping it is kinder than refusing the
  // call over it.
  it("ignores an argument nobody asked for", () => {
    expect(listArguments('{"path":"docs","recursive":true}')).toEqual({ path: "docs" });
  });
});

/// The second fence, inside the workspace guard rather than instead of it.
describe("withinFolder", () => {
  it("contains a file in the folder, and one below it", () => {
    expect(withinFolder("docs", "docs/plan.md")).toBe(true);
    expect(withinFolder("docs", "docs/specs/api.md")).toBe(true);
    expect(withinFolder("docs", "docs")).toBe(true);
  });

  it("does not contain a file outside it", () => {
    expect(withinFolder("docs", "notes/plan.md")).toBe(false);
    expect(withinFolder("docs", "plan.md")).toBe(false);
  });

  // The prefix trap the path guard has, and the same answer: a whole segment, or "docs" contains
  // "docs-archive".
  it("does not contain a sibling whose name merely starts the same", () => {
    expect(withinFolder("docs", "docs-archive/plan.md")).toBe(false);
  });

  it("contains everything when the folder is the workspace root", () => {
    expect(withinFolder("", "anything/at/all.md")).toBe(true);
  });
});

describe("searchExpression", () => {
  it("takes a plain word and matches it literally", () => {
    expect(searchExpression("TODO")?.test("a TODO here")).toBe(true);
  });

  it("ignores case, because that is what searching a folder means", () => {
    expect(searchExpression("todo")?.test("A TODO HERE")).toBe(true);
  });

  it("takes a real expression", () => {
    expect(searchExpression("^const .*=")?.test("const x =")).toBe(true);
  });

  // Null rather than falling back to a literal search: a model that wrote a broken expression should
  // be told so, not quietly given the results of a different search.
  it("has no answer for an expression that is not one", () => {
    expect(searchExpression("[unclosed")).toBeNull();
    expect(searchExpression("a{2,1}")).toBeNull();
  });

  // Not global. The flag makes RegExp stateful across calls, and a shared lastIndex is how a search
  // starts skipping every other line.
  it("is not stateful between uses", () => {
    const expression = searchExpression("a")!;
    expect(expression.test("a")).toBe(true);
    expect(expression.test("a")).toBe(true);
  });
});
