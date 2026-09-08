import { describe, expect, it } from "vitest";
import { matchRows, treeRows, type FolderState } from "./treeRows";

/// Most cases here are about shape - depth, ordering, a folder still loading -
/// and say nothing about file types, so they run against what a fresh installation has. The cases
/// that ARE about file types name their own list.
const rows_ = (folders: Record<string, FolderState>, enabled: readonly string[] = ["markdown"]) =>
  treeRows(folders, enabled, "");
import type { RemoteNode } from "./workspaceClient";

const dir = (id: string, name: string): RemoteNode => ({ id, name, kind: "directory" });
const file = (id: string, name: string): RemoteNode => ({ id, name, kind: "file" });

const loaded = (children: RemoteNode[]): FolderState => ({ status: "loaded", children });

const FOLDERS: Record<string, FolderState> = {
  "": loaded([dir("docs", "docs"), file("README.md", "README.md"), file("logo.png", "logo.png")]),
  docs: loaded([dir("docs/specs", "specs"), file("docs/plan.md", "plan.md")]),
};

describe("treeRows", () => {
  it("lists the root when nothing is expanded", () => {
    const rows = rows_({ "": FOLDERS[""]! });
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "logo.png", "README.md"]);
  });

  // A folder is shown as it is - every folder, and every file, with the ones nothing can open drawn
  // as unopenable rather than left out.
  // A folder is shown as it IS. Leaving files out made the panel disagree with every other way of
  // looking at the same folder, and a file that is simply absent gives the user nothing to act on -
  // they cannot tell "Trypthos will not open this" from "this is not there".
  it("lists a file no enabled type claims, alongside the folders", () => {
    const rows = rows_({ "": FOLDERS[""]! });
    expect(rows.map((r) => r.node.name)).toContain("logo.png");
    expect(rows.map((r) => r.node.name)).toContain("docs");
  });

  // The distinction moved from whether a row EXISTS to what the row says about itself. The panel
  // draws an unopenable file dim and refuses to open it.
  it("marks which files can be opened and which cannot", () => {
    const folders = { "": loaded([file("notes.txt", "notes.txt"), file("logo.png", "logo.png")]) };
    const openable = Object.fromEntries(
      rows_(folders, ["markdown", "text"]).map((r) => [r.node.name, r.openable]),
    );

    expect(openable).toEqual({ "notes.txt": true, "logo.png": false });
  });

  it("marks a file whose type has been turned off as unopenable", () => {
    const folders = { "": loaded([file("notes.txt", "notes.txt")]) };

    expect(rows_(folders, ["markdown"])[0]?.openable).toBe(false);
    expect(rows_(folders, ["markdown", "text"])[0]?.openable).toBe(true);
  });

  // Folders are not files, and nothing about a folder is unopenable - expanding one always works.
  it("marks every folder openable", () => {
    const rows = rows_({ "": FOLDERS[""]! });
    expect(rows.filter((r) => r.node.kind === "directory").every((r) => r.openable)).toBe(true);
  });

  // Found by running the panel's logic over a real repository: .git, .github and .claude all
  // appeared. .git alone is thousands of entries, and none of it is what this panel is for.
  it("hides dot-folders and dot-files", () => {
    const rows = rows_(
      {
        "": loaded([
          dir(".git", ".git"),
          dir("docs", "docs"),
          file(".env", ".env"),
          file("README.md", "README.md"),
        ]),
      },
    );
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "README.md"]);
  });

  it("inlines an expanded folder's children beneath it, one level deeper", () => {
    const rows = rows_(FOLDERS);
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:docs",
      "1:specs",
      "1:plan.md",
      "0:logo.png",
      "0:README.md",
    ]);
  });

  it("marks which folders are open, for the chevron", () => {
    const rows = rows_(FOLDERS);
    expect(rows.find((r) => r.node.name === "docs")?.expanded).toBe(true);
    expect(rows.find((r) => r.node.name === "specs")?.expanded).toBe(false);
  });

  it("carries a folder's loading and error status onto its row", () => {
    const rows = rows_({ "": FOLDERS[""]!, docs: { status: "error" } });
    expect(rows.find((r) => r.node.name === "docs")?.status).toBe("error");
  });

  it("is empty when the root has not been listed", () => {
    expect(rows_({})).toEqual([]);
  });
});

/// Several folders open at once.
///
/// They share one map, keyed by qualified path so their roots cannot collide, and each is walked
/// from its own root - because they are separate trees on the screen, not one tree with two tops.
describe("treeRows across several workspaces", () => {
  const TWO: Record<string, FolderState> = {
    Notes: loaded([file("Notes/a.md", "a.md"), dir("Notes/docs", "docs")]),
    "Notes/docs": loaded([file("Notes/docs/deep.md", "deep.md")]),
    Work: loaded([file("Work/a.md", "a.md")]),
  };

  it("walks only the workspace it was given", () => {
    expect(treeRows(TWO, ["markdown"], "Work").map((row) => row.node.id)).toEqual(["Work/a.md"]);
  });

  it("expands folders inside that workspace", () => {
    expect(treeRows(TWO, ["markdown"], "Notes").map((row) => row.node.id)).toEqual([
      "Notes/docs",
      "Notes/docs/deep.md",
      "Notes/a.md",
    ]);
  });

  // Depth counts from the workspace's own root, so the two trees are drawn the same way whatever
  // they are called - and a deeply nested workspace does not start its rows further in.
  it("counts depth from the workspace, not from the map", () => {
    const rows = treeRows(TWO, ["markdown"], "Notes");
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 0]);
  });

  it("answers nothing for a workspace that has not been listed", () => {
    expect(treeRows(TWO, ["markdown"], "Missing")).toEqual([]);
  });
});

/// The rows a filter draws.
///
/// A different view of the same tree, built from the paths the search came back with rather than
/// from what happens to be expanded - which is the whole point of the box: it looks INSIDE folders
/// nobody has opened.
describe("matchRows", () => {
  const MATCHES = [
    "Notes/docs/deep/chapter-one.md",
    "Notes/docs/plan.md",
    "Notes/README.md",
  ];

  it("draws a folder for every match's ancestors, and the file under it", () => {
    expect(matchRows(MATCHES, "Notes", ["markdown"]).map((row) => row.node.id)).toEqual([
      "Notes/docs",
      "Notes/docs/deep",
      "Notes/docs/deep/chapter-one.md",
      "Notes/docs/plan.md",
      "Notes/README.md",
    ]);
  });

  // The same order the browser uses everywhere else: folders first, then files, each read naturally.
  // A result list sorted differently from the tree it replaces would look like a different folder.
  it("orders each level like the tree does", () => {
    const rows = matchRows(["Notes/b.md", "Notes/a.md", "Notes/zz/c.md"], "Notes", ["markdown"]);
    expect(rows.map((row) => row.node.name)).toEqual(["zz", "c.md", "a.md", "b.md"]);
  });

  it("counts depth from the workspace, as the browse rows do", () => {
    expect(matchRows(MATCHES, "Notes", ["markdown"]).map((row) => row.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it("names each row by its own segment, not by its path", () => {
    const rows = matchRows(["Notes/docs/deep/chapter-one.md"], "Notes", ["markdown"]);
    expect(rows.map((row) => row.node.name)).toEqual(["docs", "deep", "chapter-one.md"]);
  });

  // A folder in these rows is a heading over the matches inside it, and it is already open. It
  // cannot be collapsed - what is drawn came from the search, not from the map of expanded folders -
  // so it says it is expanded and the panel gives it nothing to click shut.
  it("draws every folder as open", () => {
    const folders = matchRows(MATCHES, "Notes", ["markdown"]).filter(
      (row) => row.node.kind === "directory",
    );
    expect(folders.every((row) => row.expanded && row.status === "loaded")).toBe(true);
  });

  // The same rule as the tree: a file whose type is off is listed and drawn grey rather than hidden,
  // so a filter that found it can say what it is instead of pretending it is not there.
  it("marks which matches can be opened", () => {
    const rows = matchRows(["Notes/logo.png", "Notes/notes.md"], "Notes", ["markdown"]);
    expect(Object.fromEntries(rows.map((row) => [row.node.name, row.openable]))).toEqual({
      "logo.png": false,
      "notes.md": true,
    });
  });

  it("draws one folder row for the matches that share it", () => {
    const rows = matchRows(["Notes/docs/a.md", "Notes/docs/b.md"], "Notes", ["markdown"]);
    expect(rows.map((row) => row.node.id)).toEqual(["Notes/docs", "Notes/docs/a.md", "Notes/docs/b.md"]);
  });

  // Several folders are open at once and one search runs per folder, so a path from another
  // workspace arriving here would draw a row under the wrong tree.
  it("ignores a path that belongs to another workspace", () => {
    expect(matchRows(["Work/a.md", "Notes/b.md"], "Notes", ["markdown"]).map((row) => row.node.id)).toEqual([
      "Notes/b.md",
    ]);
  });

  it("answers nothing when nothing matched", () => {
    expect(matchRows([], "Notes", ["markdown"])).toEqual([]);
  });
});
