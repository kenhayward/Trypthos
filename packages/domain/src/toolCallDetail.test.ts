import { describe, expect, it } from "vitest";
import { toolCallDetail } from "./toolCallDetail";

/// The one-line description of a tool call that the chat panel lists under a reply.
///
/// Worth pinning down because the panel is the only place a user sees what a model did on their
/// behalf, and a list of bare tool names says that something happened without saying to what.
describe("toolCallDetail", () => {
  const args = (value: unknown) => JSON.stringify(value);

  it("names the file a read asked for", () => {
    expect(toolCallDetail("get_file_contents", args({ path: "notes/plan.md" }))).toBe(
      "notes/plan.md",
    );
  });

  it("names the directory a listing asked for", () => {
    expect(toolCallDetail("list_directory", args({ path: "notes" }))).toBe("notes");
  });

  // Omitting the path lists the attached folder itself. An empty detail says "where you pointed
  // it", which the panel shows as the bare tool name.
  it("says nothing extra for a listing of the attached folder", () => {
    expect(toolCallDetail("list_directory", args({}))).toBe("");
  });

  it("names the pattern a search looked for", () => {
    expect(toolCallDetail("search_contents", args({ pattern: "TODO" }))).toBe("TODO");
  });

  it("names where a search looked, when it was told", () => {
    expect(toolCallDetail("search_contents", args({ pattern: "TODO", path: "notes" }))).toBe(
      "TODO in notes",
    );
  });

  it("names both files a comparison looked at", () => {
    expect(toolCallDetail("diff_files", args({ left: "a.md", right: "b.md" }))).toBe(
      "a.md, b.md",
    );
  });

  it("names the file a model opened", () => {
    expect(toolCallDetail("open_file", args({ path: "plan.md" }))).toBe("plan.md");
  });

  // The path, never the contents: a whole file in a one-line list is not a list any more.
  it("names the file a model created, without its contents", () => {
    expect(toolCallDetail("create_file", args({ path: "new.md", content: "# Long\n\ntext" }))).toBe(
      "new.md",
    );
  });

  // Total, like every other reader of what a model sent: a call cut off mid-object is ordinary.
  it("answers empty for arguments that never finished arriving", () => {
    expect(toolCallDetail("get_file_contents", '{"path": "pla')).toBe("");
  });

  it("answers empty for a tool it does not know", () => {
    expect(toolCallDetail("mystery", args({ path: "a.md" }))).toBe("");
  });
});
