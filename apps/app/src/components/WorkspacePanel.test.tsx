import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkspacePanel from "./WorkspacePanel";
import type { FolderState } from "../lib/treeRows";

const FOLDERS: Record<string, FolderState> = {
  "": {
    status: "loaded",
    children: [
      { id: "docs", name: "docs", kind: "directory" },
      { id: "README.md", name: "README.md", kind: "file" },
      { id: "logo.png", name: "logo.png", kind: "file" },
    ],
  },
  docs: {
    status: "loaded",
    children: [{ id: "docs/plan.md", name: "plan.md", kind: "file" }],
  },
};

function panel(overrides: Partial<React.ComponentProps<typeof WorkspacePanel>> = {}) {
  const props = {
    width: 268,
    onCollapse: vi.fn(),
    workspaceName: "Diariz",
    folders: FOLDERS,
    filter: "",
    activePath: null,
    openPaths: [] as readonly string[],
    dirtyPaths: [] as readonly string[],
    onOpenWorkspace: vi.fn(),
    onFilterChange: vi.fn(),
    onToggleFolder: vi.fn(),
    onRetryFolder: vi.fn(),
    onOpenFile: vi.fn(),
    ...overrides,
  };
  render(<WorkspacePanel {...props} />);
  return props;
}

describe("WorkspacePanel", () => {
  it("invites you to open a folder when none is", () => {
    panel({ workspaceName: null });
    expect(screen.getByText("No folder open yet.")).toBeDefined();
  });

  it("lists folders and markdown files, and nothing else", () => {
    panel();
    expect(screen.getByRole("button", { name: /docs/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /logo\.png/ })).toBeNull();
  });

  it("shows an expanded folder's children and marks it open", () => {
    panel();
    expect(screen.getByRole("button", { name: /plan\.md/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /docs/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a file when its row is clicked", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.click(screen.getByRole("button", { name: /plan\.md/ }));
    expect(props.onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "docs/plan.md" }),
    );
  });

  it("marks the file on screen, and only that one", () => {
    panel({ activePath: "docs/plan.md", openPaths: ["docs/plan.md"] });
    expect(screen.getByRole("button", { name: /plan\.md/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /README\.md/ }).getAttribute("aria-current")).toBeNull();
  });

  // Several files are open at once, and only one of them is on screen. The tree says which are open
  // so that clicking one is understood as going to a tab rather than loading a file afresh.
  it("marks every open file, whether or not it is the one on screen", () => {
    panel({ activePath: "docs/plan.md", openPaths: ["docs/plan.md", "README.md"] });

    expect(screen.getByRole("button", { name: /README\.md/ }).dataset.open).toBe("true");
    expect(screen.getByRole("button", { name: /README\.md/ }).getAttribute("aria-current")).toBeNull();
  });

  it("marks unsaved changes on each file that has them", () => {
    panel({
      activePath: "README.md",
      openPaths: ["docs/plan.md", "README.md"],
      dirtyPaths: ["docs/plan.md"],
    });

    expect(screen.getByLabelText("Unsaved changes")).toBeDefined();
    // On the file that is unsaved, not on the one being looked at.
    expect(
      screen.getByRole("button", { name: /plan\.md/ }).querySelector("[aria-label]"),
    ).not.toBeNull();
  });

  // Inline on the row that failed, never a toast, and never a spinner over the panel: one unreadable
  // folder is a fact about that row while the rest of the tree still works.
  it("reports a failed folder on its own row, with a retry beside it", async () => {
    const user = userEvent.setup();
    const props = panel({
      folders: { ...FOLDERS, docs: { status: "error" } },
    });

    expect(screen.getByText("Couldn't list this folder.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetryFolder).toHaveBeenCalledWith("docs");
  });

  it("says so when a filter matches nothing", () => {
    panel({ filter: "nothing-matches-this" });
    expect(screen.getByText("No markdown files match.")).toBeDefined();
  });

  it("counts the markdown files it is showing", () => {
    panel();
    expect(screen.getByText(/2 files/)).toBeDefined();
  });
});
