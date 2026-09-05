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
    fileTypes: ["markdown"] as readonly string[],
    selectedFolder: "",
    onSelectFolder: vi.fn(),
    onOpenFileTypes: vi.fn(),
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

  it("offers folders and openable files as things to click", () => {
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
    expect(screen.getByText("No files match.")).toBeDefined();
  });

  it("counts the files it is showing", () => {
    panel();
    expect(screen.getByText(/2 files/)).toBeDefined();
  });
});

/// The footer is where the file types are discoverable at all. Every type but markdown is off by
/// default, so a user who never opens Settings would otherwise have no way of learning the setting
/// exists - the release notes are the only other place it is mentioned.
describe("the file types the panel is showing", () => {
  it("names the one type that is on", () => {
    panel();
    expect(screen.getByRole("button", { name: "Markdown" })).toBeDefined();
  });

  it("counts them once there is more than one", () => {
    panel({ fileTypes: ["markdown", "text"] });
    expect(screen.getByRole("button", { name: "2 file types" })).toBeDefined();
  });

  it("opens the page that changes them", async () => {
    const props = panel();
    await userEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(props.onOpenFileTypes).toHaveBeenCalled();
  });

  it("counts the files on screen beside them", () => {
    panel();
    expect(screen.getByText("2 files")).toBeDefined();
  });
});

/// A folder is shown as it is, so files nothing can open appear too - drawn as unopenable rather
/// than left out. A file that is simply absent gives the user nothing to act on: "Trypthos will not
/// open this" and "this is not there" look identical.
describe("files nothing can open", () => {
  it("lists them", () => {
    panel();
    expect(screen.getByText("logo.png")).toBeDefined();
  });

  // Not a button, so it cannot be clicked, cannot be tabbed to, and is not announced as something
  // to activate. Disabling a button would leave it in the tree for a screen reader to offer.
  it("does not offer them as something to open", () => {
    panel();
    expect(screen.queryByRole("button", { name: /logo\.png/ })).toBeNull();
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeDefined();
  });

  it("does nothing when one is clicked", async () => {
    const props = panel();
    await userEvent.click(screen.getByText("logo.png"));
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });

  // Three files are on screen - README.md, docs/plan.md and logo.png - and the footer says two.
  // That gap is the point: the footer names the types that are on and then counts, so counting a
  // file those types cannot open would make the two halves of one sentence disagree.
  it("are not counted in the footer", () => {
    panel();
    expect(screen.getByText("logo.png")).toBeDefined();
    expect(screen.getByText("2 files")).toBeDefined();
  });
});

/// Which folder chat maps, chosen in the tree.
describe("choosing the folder chat maps", () => {
  it("selects a folder and expands it in one click", async () => {
    const props = panel();
    await userEvent.click(screen.getByRole("button", { name: /docs/ }));

    expect(props.onSelectFolder).toHaveBeenCalledWith("docs");
    expect(props.onToggleFolder).toHaveBeenCalledWith("docs");
  });

  // Selection and expansion are separate facts about a folder, so they are separate attributes: a
  // folder can be the one chat is mapping while collapsed, and expanded while another is chosen.
  it("marks the chosen folder, and only that one", () => {
    panel({ selectedFolder: "docs" });
    expect(screen.getByRole("button", { name: /docs/ }).getAttribute("aria-current")).toBe("true");
  });

  it("marks nothing when the root is the one chat maps", () => {
    panel({ selectedFolder: "" });
    expect(screen.getByRole("button", { name: /docs/ }).getAttribute("aria-current")).toBeNull();
  });
});
