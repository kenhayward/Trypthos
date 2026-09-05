import { describe, expect, it } from "vitest";
import { treeRows, type FolderState } from "./treeRows";

/// Most cases here are about shape - depth, ordering, what a filter hides, a folder still loading -
/// and say nothing about file types, so they run against what a fresh installation has. The cases
/// that ARE about file types name their own list.
const rows_ = (
  folders: Record<string, FolderState>,
  filter: string,
  enabled: readonly string[] = ["markdown"],
) => treeRows(folders, filter, enabled);
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
    const rows = rows_({ "": FOLDERS[""]! }, "");
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "logo.png", "README.md"]);
  });

  // A folder is shown as it is - every folder, and every file, with the ones nothing can open drawn
  // as unopenable rather than left out.
  // A folder is shown as it IS. Leaving files out made the panel disagree with every other way of
  // looking at the same folder, and a file that is simply absent gives the user nothing to act on -
  // they cannot tell "Trypthos will not open this" from "this is not there".
  it("lists a file no enabled type claims, alongside the folders", () => {
    const rows = rows_({ "": FOLDERS[""]! }, "");
    expect(rows.map((r) => r.node.name)).toContain("logo.png");
    expect(rows.map((r) => r.node.name)).toContain("docs");
  });

  // The distinction moved from whether a row EXISTS to what the row says about itself. The panel
  // draws an unopenable file dim and refuses to open it.
  it("marks which files can be opened and which cannot", () => {
    const folders = { "": loaded([file("notes.txt", "notes.txt"), file("logo.png", "logo.png")]) };
    const openable = Object.fromEntries(
      rows_(folders, "", ["markdown", "text"]).map((r) => [r.node.name, r.openable]),
    );

    expect(openable).toEqual({ "notes.txt": true, "logo.png": false });
  });

  it("marks a file whose type has been turned off as unopenable", () => {
    const folders = { "": loaded([file("notes.txt", "notes.txt")]) };

    expect(rows_(folders, "", ["markdown"])[0]?.openable).toBe(false);
    expect(rows_(folders, "", ["markdown", "text"])[0]?.openable).toBe(true);
  });

  // Folders are not files, and nothing about a folder is unopenable - expanding one always works.
  it("marks every folder openable", () => {
    const rows = rows_({ "": FOLDERS[""]! }, "");
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
      "",
    );
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "README.md"]);
  });

  it("inlines an expanded folder's children beneath it, one level deeper", () => {
    const rows = rows_(FOLDERS, "");
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:docs",
      "1:specs",
      "1:plan.md",
      "0:logo.png",
      "0:README.md",
    ]);
  });

  it("marks which folders are open, for the chevron", () => {
    const rows = rows_(FOLDERS, "");
    expect(rows.find((r) => r.node.name === "docs")?.expanded).toBe(true);
    expect(rows.find((r) => r.node.name === "specs")?.expanded).toBe(false);
  });

  it("carries a folder's loading and error status onto its row", () => {
    const rows = rows_(
      { "": FOLDERS[""]!, docs: { status: "error" } },
      "",
    );
    expect(rows.find((r) => r.node.name === "docs")?.status).toBe("error");
  });

  describe("filtering", () => {
    it("keeps only matching files", () => {
      const rows = rows_(FOLDERS, "plan");
      expect(rows.map((r) => r.node.name)).not.toContain("README.md");
      expect(rows.map((r) => r.node.name)).toContain("plan.md");
    });

    it("matches regardless of case", () => {
      expect(rows_(FOLDERS, "README").map((r) => r.node.name)).toContain("README.md");
      expect(rows_(FOLDERS, "readme").map((r) => r.node.name)).toContain("README.md");
    });

    // Folders stay while filtering: their contents are only known once expanded, so hiding a folder
    // because nothing in it matches would hide matches nobody has looked for yet.
    it("keeps folders, since what is inside an unexpanded one is unknown", () => {
      expect(rows_(FOLDERS, "plan").map((r) => r.node.name)).toContain("docs");
    });

    it("shows everything again when the filter is cleared", () => {
      expect(rows_(FOLDERS, "").length).toBeGreaterThan(rows_(FOLDERS, "plan").length);
    });
  });

  it("is empty when the root has not been listed", () => {
    expect(rows_({}, "")).toEqual([]);
  });
});
