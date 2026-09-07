import { describe, expect, it } from "vitest";
import { GUIDE_PATH } from "./openDocuments";
import { qualifyPath, splitQualified, workspaceIdFor } from "./qualifiedPath";

describe("qualifyPath", () => {
  it("names the workspace a path is in", () => {
    expect(qualifyPath("Notes", "docs/plan.md")).toBe("Notes/docs/plan.md");
  });

  // "" is the workspace root, and the workspace id alone is what names it. There is no trailing
  // slash: the root and the folder named "" would otherwise be two spellings of one place.
  it("names the root as the workspace itself", () => {
    expect(qualifyPath("Notes", "")).toBe("Notes");
  });
});

describe("splitQualified", () => {
  it("takes the workspace off the front", () => {
    expect(splitQualified("Notes/docs/plan.md")).toEqual({
      workspaceId: "Notes",
      path: "docs/plan.md",
    });
  });

  it("reads a bare workspace as its root", () => {
    expect(splitQualified("Notes")).toEqual({ workspaceId: "Notes", path: "" });
  });

  // Split at the FIRST separator, never the last. A path has as many segments as it likes and the
  // workspace is only ever the first of them.
  it("splits at the first separator only", () => {
    expect(splitQualified("Notes/a/b/c.md")?.path).toBe("a/b/c.md");
  });

  // The two halves are one round trip, which is the property everything else rests on: the tree
  // qualifies, the shell splits, and neither may quietly rewrite what the other said.
  it("round-trips whatever was qualified", () => {
    for (const path of ["", "a.md", "a/b.md", "a/b/c d.md", "odd:name/file.md"]) {
      const qualified = qualifyPath("Notes", path);
      expect(splitQualified(qualified)).toEqual({ workspaceId: "Notes", path });
    }
  });

  it("refuses something that names no workspace", () => {
    expect(splitQualified("")).toBeNull();
    expect(splitQualified("/leading")).toBeNull();
  });

  // The documents with no workspace behind them. Both are already reserved, and neither is ever
  // sent to the shell - but a split that claimed `trypthos:draft` was a workspace would be a
  // confident wrong answer rather than a refusal.
  it("refuses a document that has no workspace", () => {
    expect(splitQualified(GUIDE_PATH)).toBeNull();
    expect(splitQualified("trypthos:draft/1/notes.md")).toBeNull();
  });
});

/// What a workspace is called on the wire.
///
/// The folder's own name, so a qualified path reads as something a person recognises - and so a tab
/// forced to disambiguate two files called `notes.md` shows `Notes/notes.md` rather than an opaque
/// token. Deduplicated, because two folders can perfectly well share a name.
describe("workspaceIdFor", () => {
  it("uses the folder's own name", () => {
    expect(workspaceIdFor("Notes", [])).toBe("Notes");
  });

  it("numbers a name that is already taken", () => {
    expect(workspaceIdFor("Notes", ["Notes"])).toBe("Notes (2)");
    expect(workspaceIdFor("Notes", ["Notes", "Notes (2)"])).toBe("Notes (3)");
  });

  // The numbered name can itself be taken by a folder that is genuinely called that.
  it("keeps counting past a name that looks numbered", () => {
    expect(workspaceIdFor("Notes", ["Notes (2)"])).toBe("Notes");
    expect(workspaceIdFor("Notes (2)", ["Notes (2)"])).toBe("Notes (2) (2)");
  });

  // A separator in an id would break the split above, and a name is the one part of this that comes
  // from the user's disk rather than from the app.
  it("takes the separator out of a name that somehow carries one", () => {
    expect(workspaceIdFor("a/b", [])).not.toContain("/");
  });

  // A folder with no name at all - the root of a drive on Windows is the case that produces one.
  it("still answers for a folder with no usable name", () => {
    expect(workspaceIdFor("", []).length).toBeGreaterThan(0);
    expect(workspaceIdFor("   ", []).trim().length).toBeGreaterThan(0);
  });
});
