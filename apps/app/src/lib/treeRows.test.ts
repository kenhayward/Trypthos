import { describe, expect, it } from "vitest";
import { treeRows, type FolderState } from "./treeRows";
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
    const rows = treeRows({ "": FOLDERS[""]! }, "");
    expect(rows.map((r) => r.node.name)).toEqual(["docs", "README.md"]);
  });

  // "Shows all folders but only markdown files within them." A .png in a documents tree is noise, and
  // the footer promises markdown only.
  it("hides files that are not markdown, and keeps every folder", () => {
    const rows = treeRows({ "": FOLDERS[""]! }, "");
    expect(rows.map((r) => r.node.name)).not.toContain("logo.png");
    expect(rows.map((r) => r.node.name)).toContain("docs");
  });

  // Found by running the panel's logic over a real repository: .git, .github and .claude all
  // appeared. .git alone is thousands of entries, and none of it is what this panel is for.
  it("hides dot-folders and dot-files", () => {
    const rows = treeRows(
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
    const rows = treeRows(FOLDERS, "");
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:docs",
      "1:specs",
      "1:plan.md",
      "0:README.md",
    ]);
  });

  it("marks which folders are open, for the chevron", () => {
    const rows = treeRows(FOLDERS, "");
    expect(rows.find((r) => r.node.name === "docs")?.expanded).toBe(true);
    expect(rows.find((r) => r.node.name === "specs")?.expanded).toBe(false);
  });

  it("carries a folder's loading and error status onto its row", () => {
    const rows = treeRows(
      { "": FOLDERS[""]!, docs: { status: "error" } },
      "",
    );
    expect(rows.find((r) => r.node.name === "docs")?.status).toBe("error");
  });

  describe("filtering", () => {
    it("keeps only matching files", () => {
      const rows = treeRows(FOLDERS, "plan");
      expect(rows.map((r) => r.node.name)).not.toContain("README.md");
      expect(rows.map((r) => r.node.name)).toContain("plan.md");
    });

    it("matches regardless of case", () => {
      expect(treeRows(FOLDERS, "README").map((r) => r.node.name)).toContain("README.md");
      expect(treeRows(FOLDERS, "readme").map((r) => r.node.name)).toContain("README.md");
    });

    // Folders stay while filtering: their contents are only known once expanded, so hiding a folder
    // because nothing in it matches would hide matches nobody has looked for yet.
    it("keeps folders, since what is inside an unexpanded one is unknown", () => {
      expect(treeRows(FOLDERS, "plan").map((r) => r.node.name)).toContain("docs");
    });

    it("shows everything again when the filter is cleared", () => {
      expect(treeRows(FOLDERS, "").length).toBeGreaterThan(treeRows(FOLDERS, "plan").length);
    });
  });

  it("is empty when the root has not been listed", () => {
    expect(treeRows({}, "")).toEqual([]);
  });
});
