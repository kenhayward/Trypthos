import { render } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRef } from "@trypthos/domain";
import type { FilterStatus } from "../hooks/useFileFilter";
import type { FolderState } from "../lib/treeRows";
import WorkspacePanel from "./WorkspacePanel";

/// Where a click lands, which is the whole point of the change and the one thing jsdom cannot
/// answer. jsdom has no layout engine, so every box it reports is zero and a test of this there
/// would be a test of the polyfill.

/// The band's width. Large enough to hit without aiming, and the same at every depth - a root has no
/// indent to borrow, so the number is the number rather than something derived from the depth.
const BAND = 44;

const NOTES = { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" }, truncated: false };

const FOLDERS: Record<string, FolderState> = {
  Notes: { status: "loaded", children: [{ id: "Notes/docs", name: "docs", kind: "directory" }] },
  "Notes/docs": { status: "loaded", children: [{ id: "Notes/docs/guides", name: "guides", kind: "directory" }] },
  "Notes/docs/guides": {
    status: "loaded",
    children: [{ id: "Notes/docs/guides/plan.md", name: "plan.md", kind: "file" }],
  },
};

function panel() {
  const props = {
    width: 268,
    onCollapse: vi.fn(),
    workspaces: [NOTES] as readonly {
      id: string;
      name: string;
      ref: WorkspaceRef;
      truncated: boolean;
      vault?: boolean;
    }[],
    folders: FOLDERS,
    filter: "",
    filterStatus: { kind: "idle" } as FilterStatus,
    activePath: null,
    openPaths: [] as readonly string[],
    dirtyPaths: [] as readonly string[],
    onOpenWorkspace: vi.fn(),
    onOpenRepo: vi.fn(),
    onOpenRepoPage: vi.fn(),
    onOpenGraphPage: vi.fn(),
    onFilterChange: vi.fn(),
    onToggleFolder: vi.fn(),
    onRetryFolder: vi.fn(),
    onRefreshWorkspace: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onRename: vi.fn(),
    onRevealEntry: vi.fn(),
    platform: "win32" as const,
    onOpenFile: vi.fn(),
    fileTypes: ["markdown"] as readonly string[],
    selectedFolder: "",
    onSelectFolder: vi.fn(),
    onCloseWorkspace: vi.fn(),
    onOpenFileTypes: vi.fn(),
  };
  const view = render(<WorkspacePanel {...props} />);
  return { ...props, view };
}

describe("the disclosure band", () => {
  it("is wide enough to hit at every depth", async () => {
    await page.viewport(900, 700);
    const { view } = panel();

    for (const name of ["Collapse Notes", "Collapse docs", "Collapse guides"]) {
      const box = view.getByRole("button", { name }).getBoundingClientRect();
      expect({ name, wide: box.width >= BAND, tall: box.height >= 24 }).toEqual({ name, wide: true, tall: true });
    }
  });

  // The reason the band exists rather than a bigger chevron: the empty space either side of the
  // triangle is part of the target.
  it("toggles from its left edge, where the triangle is not", async () => {
    await page.viewport(900, 700);
    const { view, onToggleFolder, onSelectFolder } = panel();
    const band = view.getByRole("button", { name: "Collapse docs" });
    const box = band.getBoundingClientRect();

    await userEvent.click(band, { position: { x: 3, y: Math.round(box.height / 2) } });

    expect(onToggleFolder).toHaveBeenCalledWith("Notes/docs");
    expect(onSelectFolder).not.toHaveBeenCalled();
  });

  it("does not toggle when the name is clicked, however close to the triangle", async () => {
    await page.viewport(900, 700);
    const { view, onToggleFolder, onSelectFolder } = panel();

    await userEvent.click(view.getByRole("button", { name: /^docs$/ }), { position: { x: 2, y: 10 } });

    expect(onSelectFolder).toHaveBeenCalledWith("Notes/docs");
    expect(onToggleFolder).not.toHaveBeenCalled();
  });

  // The band overlays the padding the row leaves for it, so it must not reach the icon: a click on
  // a folder's icon is a click on the folder.
  it("stops before the icon it sits beside", async () => {
    await page.viewport(900, 700);
    const { view } = panel();
    const band = view.getByRole("button", { name: "Collapse docs" }).getBoundingClientRect();
    const icon = view.getByRole("button", { name: /^docs$/ }).querySelector("svg")!.getBoundingClientRect();

    expect(band.right <= icon.left).toBe(true);
  });
});
