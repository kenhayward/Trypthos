import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkspacePanel from "./WorkspacePanel";
import type { WorkspaceRef } from "@trypthos/domain";
import type { FolderState } from "../lib/treeRows";
import type { FilterStatus } from "../hooks/useFileFilter";

/// Every path names the folder it is in, so the map is keyed by qualified path and the workspace's
/// own id is the key of its root.
const DIARIZ = { id: "Diariz", name: "Diariz", ref: { kind: "local" as const, root: "D:/Diariz" }, truncated: false };

const FOLDERS: Record<string, FolderState> = {
  Diariz: {
    status: "loaded",
    children: [
      { id: "Diariz/docs", name: "docs", kind: "directory" },
      { id: "Diariz/README.md", name: "Diariz/README.md", kind: "file" },
      { id: "Diariz/logo.png", name: "Diariz/logo.png", kind: "file" },
    ],
  },
  "Diariz/docs": {
    status: "loaded",
    children: [{ id: "Diariz/docs/plan.md", name: "plan.md", kind: "file" }],
  },
};

function panel(overrides: Partial<React.ComponentProps<typeof WorkspacePanel>> = {}) {
  const props = {
    width: 268,
    onCollapse: vi.fn(),
    workspaces: [DIARIZ] as readonly {
      id: string;
      name: string;
      ref: WorkspaceRef;
      truncated: boolean;
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
    onFilterChange: vi.fn(),
    onToggleFolder: vi.fn(),
    onRetryFolder: vi.fn(),
    onRefreshWorkspace: vi.fn(),
    onOpenFile: vi.fn(),
    fileTypes: ["markdown"] as readonly string[],
    selectedFolder: "",
    onSelectFolder: vi.fn(),
    onCloseWorkspace: vi.fn(),
    onOpenFileTypes: vi.fn(),
    ...overrides,
  };
  render(<WorkspacePanel {...props} />);
  return props;
}

describe("WorkspacePanel", () => {
  it("invites you to open a folder when none is", () => {
    panel({ workspaces: [] });
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
      expect.objectContaining({ id: "Diariz/docs/plan.md" }),
    );
  });

  it("marks the file on screen, and only that one", () => {
    panel({ activePath: "Diariz/docs/plan.md", openPaths: ["Diariz/docs/plan.md"] });
    expect(screen.getByRole("button", { name: /plan\.md/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /README\.md/ }).getAttribute("aria-current")).toBeNull();
  });

  // Several files are open at once, and only one of them is on screen. The tree says which are open
  // so that clicking one is understood as going to a tab rather than loading a file afresh.
  it("marks every open file, whether or not it is the one on screen", () => {
    panel({ activePath: "Diariz/docs/plan.md", openPaths: ["Diariz/docs/plan.md", "Diariz/README.md"] });

    expect(screen.getByRole("button", { name: /README\.md/ }).dataset.open).toBe("true");
    expect(screen.getByRole("button", { name: /README\.md/ }).getAttribute("aria-current")).toBeNull();
  });

  it("marks unsaved changes on each file that has them", () => {
    panel({
      activePath: "Diariz/README.md",
      openPaths: ["Diariz/docs/plan.md", "Diariz/README.md"],
      dirtyPaths: ["Diariz/docs/plan.md"],
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
      folders: { ...FOLDERS, "Diariz/docs": { status: "error" } },
    });

    expect(screen.getByText("Couldn't list this folder.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetryFolder).toHaveBeenCalledWith("Diariz/docs");
  });

  it("says so when a filter matches nothing", () => {
    panel({ filter: "nothing-matches-this", filterStatus: { kind: "results", paths: [], truncated: false } });
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
    expect(screen.getByText("Diariz/logo.png")).toBeDefined();
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
    await userEvent.click(screen.getByText("Diariz/logo.png"));
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });

  // Three files are on screen - README.md, docs/plan.md and logo.png - and the footer says two.
  // That gap is the point: the footer names the types that are on and then counts, so counting a
  // file those types cannot open would make the two halves of one sentence disagree.
  it("are not counted in the footer", () => {
    panel();
    expect(screen.getByText("Diariz/logo.png")).toBeDefined();
    expect(screen.getByText("2 files")).toBeDefined();
  });
});

/// Which folder chat maps, chosen in the tree.
describe("choosing the folder chat maps", () => {
  it("selects a folder and expands it in one click", async () => {
    const props = panel();
    await userEvent.click(screen.getByRole("button", { name: /docs/ }));

    expect(props.onSelectFolder).toHaveBeenCalledWith("Diariz/docs");
    expect(props.onToggleFolder).toHaveBeenCalledWith("Diariz/docs");
  });

  // Selection and expansion are separate facts about a folder, so they are separate attributes: a
  // folder can be the one chat is mapping while collapsed, and expanded while another is chosen.
  it("marks the chosen folder, and only that one", () => {
    panel({ selectedFolder: "Diariz/docs" });
    expect(screen.getByRole("button", { name: /docs/ }).getAttribute("aria-current")).toBe("true");
  });

  it("marks nothing when the root is the one chat maps", () => {
    panel({ selectedFolder: "" });
    expect(screen.getByRole("button", { name: /docs/ }).getAttribute("aria-current")).toBeNull();
  });
});

/// Collapsing a whole folder.
///
/// A workspace root behaves like the folder it is: the same chevron, the same click, the same
/// forgetting of what was under it. With several folders open this is what makes the panel usable -
/// two large trees at once is a lot of rows to scroll past to reach the second one.
describe("collapsing a workspace root", () => {
  const OTHER = { id: "Work", name: "Work", ref: { kind: "local" as const, root: "D:/Work" }, truncated: false };

  const rootRow = (name: string) =>
    within(screen.getByRole("complementary", { name: "Workspace" })).getByRole("button", {
      name: new RegExp(`^${name}$`),
    });

  it("draws the root as expanded while its listing is there", () => {
    panel();
    expect(rootRow("Diariz").getAttribute("aria-expanded")).toBe("true");
  });

  // Collapsed is simply not having been listed - the same state a folder nobody has opened is in.
  it("draws the root as collapsed when its listing is not", () => {
    panel({ folders: {} });
    expect(rootRow("Diariz").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /README\.md/ })).toBeNull();
  });

  it("toggles the root, and points chat at it, in one click", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.click(rootRow("Diariz"));

    expect(props.onToggleFolder).toHaveBeenCalledWith("Diariz");
    expect(props.onSelectFolder).toHaveBeenCalledWith("Diariz");
  });

  // The cross is on the same row and must keep meaning what it says.
  it("closes rather than collapses when the cross is clicked", async () => {
    const user = userEvent.setup();
    const props = panel();

    await user.click(screen.getByRole("button", { name: "Close Diariz" }));

    expect(props.onCloseWorkspace).toHaveBeenCalledWith("Diariz");
    expect(props.onToggleFolder).not.toHaveBeenCalled();
  });

  // One collapsed folder must not hide the other, which is the whole point of collapsing one.
  it("leaves the other folder listed", () => {
    panel({
      workspaces: [DIARIZ, OTHER],
      folders: { Work: { status: "loaded", children: [{ id: "Work/a.md", name: "a.md", kind: "file" }] } },
    });

    expect(rootRow("Diariz").getAttribute("aria-expanded")).toBe("false");
    expect(rootRow("Work").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /a\.md/ })).toBeDefined();
  });

  // "This folder is empty" about a folder nobody has looked inside is a claim the panel cannot make.
  it("says a folder is empty only when it has been looked in", () => {
    panel({ folders: {} });
    expect(screen.queryByText("This folder is empty.")).toBeNull();

    panel({ folders: { Diariz: { status: "loaded", children: [] } } });
    expect(screen.getAllByText("This folder is empty.")).toHaveLength(1);
  });

  // A root that cannot be listed says so on its own row, exactly as a folder inside one does.
  it("offers a retry when the root cannot be listed", async () => {
    const user = userEvent.setup();
    const props = panel({ folders: { Diariz: { status: "error" } } });

    expect(screen.getByText("Couldn't list this folder.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetryFolder).toHaveBeenCalledWith("Diariz");
  });
});

/// How far in each row sits.
///
/// The indent is the only thing saying what is inside what, so it is worth asserting rather than
/// trusting: at the first level it once said the opposite of the truth, drawing a workspace's own
/// folders level with the workspace itself.
describe("indenting", () => {
  const paddingOf = (name: string | RegExp) =>
    within(screen.getByRole("complementary", { name: "Workspace" }))
      .getByRole("button", { name })
      .style.paddingLeft;

  const px = (value: string) => Number.parseFloat(value.replace("px", ""));

  it("puts a workspace's own folders one level in from its root", () => {
    panel();

    const root = px(paddingOf(/^Diariz$/));
    const inside = px(paddingOf(/docs/));

    expect(inside).toBeGreaterThan(root);
  });

  // Files keep their own ladder, a step further in than the folders beside them - a file has no
  // chevron, and lining its name up with a folder's is what that step is for. What matters is that
  // the ladder is even: one step per level, wherever the level is.
  it("steps files evenly, level by level", () => {
    panel();

    const atRoot = px(paddingOf(/README\.md/));
    const insideDocs = px(paddingOf(/plan\.md/));
    const rootToFolder = px(paddingOf(/docs/)) - px(paddingOf(/^Diariz$/));

    expect(insideDocs - atRoot).toBe(rootToFolder);
  });
});

/// The filter box.
///
/// What it shows is the answer to a search of every open folder, not the rows that happened to be on
/// screen - so these render matches from folders the map has never been asked about, which is
/// exactly the case the old filter could not express.
describe("filtering the browser", () => {
  const filtered = (paths: string[], overrides: Partial<React.ComponentProps<typeof WorkspacePanel>> = {}) =>
    panel({
      filter: "plan",
      filterStatus: { kind: "results", paths, truncated: false },
      ...overrides,
    });

  it("shows a match inside a folder nobody expanded, under the folders it is in", () => {
    filtered(["Diariz/docs/deep/plan.md"], { folders: { Diariz: FOLDERS.Diariz! } });

    expect(screen.getByRole("button", { name: /plan\.md/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /docs/ })).toBeDefined();
    expect(screen.getByText("deep")).toBeDefined();
  });

  it("leaves out the files that did not match", () => {
    filtered(["Diariz/docs/plan.md"]);
    expect(screen.queryByRole("button", { name: /README\.md/ })).toBeNull();
  });

  // A heading for a folder with nothing under it says a folder was searched, which is not what the
  // user asked. The message below covers the case where none of them had anything.
  it("leaves out a folder that has no matches at all", () => {
    filtered(["Diariz/docs/plan.md"], {
      workspaces: [DIARIZ, { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" }, truncated: false }],
    });

    // By exact name: each workspace row sits beside a "Close <name>" button of its own.
    expect(screen.getByRole("button", { name: "Diariz" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Notes" })).toBeNull();
  });

  it("says it is searching while the folders are being walked", () => {
    panel({ filter: "plan", filterStatus: { kind: "searching" } });
    expect(screen.getByText("Searching...")).toBeDefined();
    expect(screen.queryByText("No files match.")).toBeNull();
  });

  // An answer cut short that does not say so is a wrong answer given confidently.
  it("says when the search stopped early", () => {
    panel({
      filter: "*",
      filterStatus: { kind: "results", paths: ["Diariz/docs/plan.md"], truncated: true },
    });
    expect(screen.getByText(/Stopped early/)).toBeDefined();
  });

  // These folder rows exist to say where a match is. They came from the search rather than from the
  // map of expanded folders, so collapsing one could not do anything - and a control that does
  // nothing is worse than no control.
  it("does not offer to collapse a folder it is showing results in", async () => {
    const user = userEvent.setup();
    const props = filtered(["Diariz/docs/plan.md"]);

    await user.click(screen.getByRole("button", { name: /docs/ }));
    expect(props.onToggleFolder).not.toHaveBeenCalled();
    // Still the way to point chat and Find at a folder, which is the other half of what the row does.
    expect(props.onSelectFolder).toHaveBeenCalledWith("Diariz/docs");
  });

  it("opens a matching file like any other row", async () => {
    const user = userEvent.setup();
    const props = filtered(["Diariz/docs/plan.md"]);

    await user.click(screen.getByRole("button", { name: /plan\.md/ }));
    expect(props.onOpenFile).toHaveBeenCalledWith({
      id: "Diariz/docs/plan.md",
      name: "plan.md",
      kind: "file",
    });
  });

  it("counts the matches it is showing", () => {
    filtered(["Diariz/docs/plan.md", "Diariz/README.md"]);
    expect(screen.getByText(/2 files/)).toBeDefined();
  });

  it("shows the tree again when the box is cleared", () => {
    panel({ filter: "", filterStatus: { kind: "idle" } });
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeDefined();
  });
});

describe("the sources a workspace can be opened from", () => {
  // Two buttons rather than a menu behind one: a cloud source hidden behind a click that says
  // nothing about what is in it is a source most people never find.
  it("offers a repository as well as a folder", () => {
    panel();

    expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open GitHub repository" })).toBeTruthy();
  });

  it("asks for the repository picker when the repository button is pressed", async () => {
    const props = panel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open GitHub repository" }));

    expect(props.onOpenRepo).toHaveBeenCalled();
    // The two are different questions: one opens the operating system's folder dialog, the other
    // ours. A button that fired both would ask twice.
    expect(props.onOpenWorkspace).not.toHaveBeenCalled();
  });

  // A folder and a repository sit in the same tree and behave very differently - one can be saved
  // into and the other cannot - so the row says which it is rather than looking alike.
  it("draws a repository's row differently from a folder's", () => {
    panel({
      workspaces: [
        { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" }, truncated: false },
        { id: "essays", name: "essays", ref: { kind: "github" as const, owner: "ada", repo: "essays" }, truncated: false },
      ],
    });

    // The tooltip is where the whole of what a workspace is gets said, since the tree shows only
    // the name - a path for a folder, and the owner with the repository for a repository.
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("title")).toBe("D:/Notes");
    expect(screen.getByRole("button", { name: "essays" }).getAttribute("title")).toBe("ada/essays");
  });

  /// The mark, and the colour of it.
  ///
  /// The shape alone is a small difference at this size, down a panel of rows that are otherwise
  /// identical. The claim asserted here is that the two do not look the SAME - which hue each one
  /// takes is a palette decision, and a test naming one would fail the day the palette moved.
  it("colours a repository's mark differently from a folder's", () => {
    panel({
      workspaces: [
        { id: "Notes", name: "Notes", ref: { kind: "local" as const, root: "D:/Notes" }, truncated: false },
        { id: "essays", name: "essays", ref: { kind: "github" as const, owner: "ada", repo: "essays" }, truncated: false },
      ],
    });

    // The last mark in the row, which is the provider's. The first is the chevron, and comparing
    // two chevrons would be a test that can never fail.
    const colourOf = (name: string) =>
      [...screen.getByRole("button", { name }).querySelectorAll("svg")]
        .at(-1)
        ?.getAttribute("class") ?? "";

    expect(colourOf("Notes")).not.toBe("");
    expect(colourOf("essays")).not.toBe(colourOf("Notes"));
  });
});

/// The right-click menu on a workspace.
///
/// About the whole workspace wherever in it the click lands - its own row or any row beneath it - so
/// the menu is found by right-clicking the thing you are looking at rather than scrolling up to the
/// root first. Refresh is its first entry, and at present its only one.
describe("the workspace menu", () => {
  const WORK = { id: "Work", name: "Work", ref: { kind: "local" as const, root: "D:/Work" }, truncated: false };
  const ESSAYS = {
    id: "essays",
    name: "essays",
    ref: { kind: "github" as const, owner: "ada", repo: "essays" },
    truncated: false,
  };

  async function rightClick(target: HTMLElement) {
    const user = userEvent.setup();
    await user.pointer({ keys: "[MouseRight]", target });
    return user;
  }

  it("opens on a right-click of the workspace's row, with Refresh first", async () => {
    panel();
    await rightClick(screen.getByRole("button", { name: /^Diariz$/ }));

    expect(screen.getByRole("menu", { name: "Diariz" })).toBeDefined();
    expect(screen.getAllByRole("menuitem")[0]?.textContent).toBe("Refresh");
  });

  it("refreshes that workspace when Refresh is chosen, and closes", async () => {
    const onRefreshWorkspace = vi.fn();
    panel({ onRefreshWorkspace });
    const user = await rightClick(screen.getByRole("button", { name: /^Diariz$/ }));

    await user.click(screen.getByRole("menuitem", { name: "Refresh" }));

    expect(onRefreshWorkspace).toHaveBeenCalledWith("Diariz");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // Right-clicking asks about a row; it does not act on it. Opening the file or collapsing the
  // folder as well would mean reading the options costs you what you were looking at.
  it("opens from any row inside the workspace, without opening or toggling it", async () => {
    const props = panel();

    await rightClick(screen.getByRole("button", { name: /plan\.md/ }));
    expect(screen.getByRole("menu", { name: "Diariz" })).toBeDefined();

    await rightClick(screen.getByRole("button", { name: /docs/ }));
    expect(props.onOpenFile).not.toHaveBeenCalled();
    expect(props.onToggleFolder).not.toHaveBeenCalled();
    expect(props.onSelectFolder).not.toHaveBeenCalled();
  });

  it("is about the workspace that was right-clicked, not the first one open", async () => {
    const onRefreshWorkspace = vi.fn();
    panel({
      workspaces: [DIARIZ, WORK],
      folders: { ...FOLDERS, Work: { status: "loaded", children: [{ id: "Work/a.md", name: "a.md", kind: "file" }] } },
      onRefreshWorkspace,
    });
    const user = await rightClick(screen.getByRole("button", { name: /a\.md/ }));

    await user.click(screen.getByRole("menuitem", { name: "Refresh" }));
    expect(onRefreshWorkspace).toHaveBeenCalledWith("Work");
  });

  it("closes on Escape, having done nothing", async () => {
    const onRefreshWorkspace = vi.fn();
    panel({ onRefreshWorkspace });
    const user = await rightClick(screen.getByRole("button", { name: /^Diariz$/ }));
    expect(screen.getByRole("menu")).toBeDefined();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onRefreshWorkspace).not.toHaveBeenCalled();
  });

  // A repository is held at the commit it was opened on, so asking again answers from the same
  // tree. Offered greyed rather than hidden: an entry that comes and goes by workspace is harder to
  // learn than one that says it does not apply here, and the tooltip says why.
  it("cannot refresh a repository", async () => {
    panel({ workspaces: [ESSAYS], folders: {} });
    await rightClick(screen.getByRole("button", { name: /^essays$/ }));

    const refresh = screen.getByRole("menuitem", { name: "Refresh" }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("title")).not.toBeNull();
  });
});

describe("a workspace the provider could not list in full", () => {
  const HUGE = {
    id: "huge",
    name: "huge",
    ref: { kind: "github" as const, owner: "ada", repo: "huge" },
    truncated: true,
  };

  // GitHub cuts a very large tree short. A browser quietly missing folders is a wrong answer given
  // confidently rather than an incomplete one, so it says so on the row it belongs to.
  it("says so on that workspace's row", () => {
    panel({ workspaces: [HUGE] });
    expect(screen.getByText(/Too large to list in full/)).toBeTruthy();
  });

  it("says nothing about a workspace that was listed in full", () => {
    panel({ workspaces: [{ ...HUGE, truncated: false }] });
    expect(screen.queryByText(/Too large to list in full/)).toBeNull();
  });
});
