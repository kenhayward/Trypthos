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
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "README.md"]);
  });

  // "Shows all folders but only markdown files within them." A .png in a documents tree is noise, and
  // the footer promises markdown only.
  it("hides a file no enabled type claims, and keeps every folder", () => {
    const rows = rows_({ "": FOLDERS[""]! }, "");
    expect(rows.map((r) => r.node.name)).not.toContain("logo.png");
    expect(rows.map((r) => r.node.name)).toContain("docs");
  });

  // This is what the File types page actually does: a type that is off is a file the tree does not
  // list. Turning one on is the difference between a folder of notes and a folder of everything.
  it("lists a file only while its type is turned on", () => {
    const folders = { "": loaded([file("notes.txt", "notes.txt"), file("a.md", "a.md")]) };

    expect(rows_(folders, "").map((r) => r.node.name)).toEqual(["a.md"]);
    expect(rows_(folders, "", ["markdown", "text"]).map((r) => r.node.name)).toEqual([
      "a.md",
      "notes.txt",
    ]);
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
