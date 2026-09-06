import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_PATH } from "@trypthos/domain";
import EditorTabs from "./EditorTabs";

/// The tab strip: which files are open, which one you are in, and which have unsaved work.
///
/// Presentational. What is open and what a close does live in useWorkspace and the domain's document
/// set, so everything here is about what a user can see and reach.

const DOCS = ["docs/notes.md", "specs/plan.md"];

function setup(over: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
  const props = {
    workspaceName: "Trypthos",
    paths: DOCS,
    activePath: "docs/notes.md",
    dirtyPaths: [] as readonly string[],
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    ...over,
  };
  render(<EditorTabs {...props} />);
  return props;
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });

describe("EditorTabs", () => {
  it("shows one tab per open document, named by the file", () => {
    setup();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(tab("notes.md")).toBeDefined();
    expect(tab("plan.md")).toBeDefined();
  });

  // The short name is what fits; where the file lives is one hover away, qualified with the
  // workspace, because "docs/notes.md" alone does not say which folder it is in.
  it("puts the whole path on hover", () => {
    setup();

    expect(tab("notes.md").getAttribute("title")).toBe("Trypthos/docs/notes.md");
  });

  it("qualifies tabs that would otherwise read the same", () => {
    setup({ paths: ["docs/index.md", "specs/index.md"], activePath: "docs/index.md" });

    expect(screen.getByRole("tab", { name: /docs\/index\.md/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /specs\/index\.md/ })).toBeDefined();
  });

  it("marks which tab is on screen", () => {
    setup();

    expect(tab("notes.md").getAttribute("aria-selected")).toBe("true");
    expect(tab("plan.md").getAttribute("aria-selected")).toBe("false");
  });

  it("goes to a document when its tab is clicked", async () => {
    const props = setup();

    await userEvent.click(tab("plan.md"));

    expect(props.onActivate).toHaveBeenCalledWith("specs/plan.md");
  });

  it("closes a document from its own tab", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Close plan.md" }));

    expect(props.onClose).toHaveBeenCalledWith("specs/plan.md");
    // The click must not also select the tab it just closed.
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  // Every editor closes a tab this way, and it is how you close several quickly without aiming at a
  // small target each time.
  it("closes a document on a middle click", async () => {
    const props = setup();

    await userEvent.pointer({ keys: "[MouseMiddle]", target: tab("plan.md") });

    expect(props.onClose).toHaveBeenCalledWith("specs/plan.md");
  });

  // A background tab with unsaved work is the only place that fact can be shown - the header speaks
  // for the document on screen and nothing else.
  it("marks a document with unsaved work", () => {
    setup({ dirtyPaths: ["specs/plan.md"] });

    expect(screen.getByLabelText("plan.md has unsaved changes")).toBeDefined();
  });

  it("reaches every tab with the arrow keys", async () => {
    const props = setup();

    tab("notes.md").focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(tab("plan.md"));
    await userEvent.keyboard("{Enter}");
    expect(props.onActivate).toHaveBeenCalledWith("specs/plan.md");
  });

  it("wraps around at the ends", async () => {
    setup();

    tab("plan.md").focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(tab("notes.md"));
  });

  // One stop for the whole strip, not one per tab: a strip of thirty files must not be thirty tab
  // stops between the tree and the document.
  it("takes one tab stop, on the document you are in", () => {
    setup();

    expect(tab("notes.md").getAttribute("tabindex")).toBe("0");
    expect(tab("plan.md").getAttribute("tabindex")).toBe("-1");
  });

  it("names the scratch buffer when no file is open", () => {
    setup({ paths: [], activePath: null });

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("Scratch buffer")).toBeDefined();
  });
});

/// The built-in guide is a document like any other, except that its name is not in its path.
describe("a built-in document", () => {
  it("is named from the catalogue rather than from its path", () => {
    render(
      <EditorTabs
        workspaceName="Notes"
        paths={[GUIDE_PATH]}
        activePath={GUIDE_PATH}
        dirtyPaths={[]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    const tab = screen.getByRole("tab");
    expect(tab.textContent).toContain("Markdown Syntax Guide");
    // And not qualified with the open folder, which it is not in.
    expect(tab.getAttribute("title")).toBe("Markdown Syntax Guide");
  });
});

/// The right-click menu on a tab.
///
/// Drawn here rather than popped natively, following `OpenFilesMenu` and `ChatHistoryMenu`: what it
/// closes is entirely the strip's own business, and the shell has nothing to contribute to it.
///
/// What each entry closes is `tabsToClose` in the domain, tested there. What is tested here is that
/// the menu reaches it - the right entries, on the right tab, greyed when they would close nothing.
describe("EditorTabs: the tab menu", () => {
  const THREE = ["a.md", "b.md", "c.md"];

  async function openMenuOn(name: string, over: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
    const user = userEvent.setup();
    const props = setup({ paths: THREE, activePath: "a.md", ...over });
    await user.pointer({ keys: "[MouseRight]", target: tab(name) });
    return { user, props };
  }

  const item = (name: string) => screen.getByRole("menuitem", { name });

  it("opens on a right-click, offering the five ways to close", async () => {
    await openMenuOn("b.md");

    expect(screen.getByRole("menu")).toBeDefined();
    expect(screen.getAllByRole("menuitem").map((entry) => entry.textContent)).toEqual([
      "Close",
      "Close Tabs to the Right",
      "Close All",
      "Close Others",
      "Close Saved",
    ]);
  });

  // Right-clicking is not selecting: a menu about a tab must not also open the file, or reading the
  // options costs you the document you were in.
  it("does not open the tab it was invoked on", async () => {
    const { props } = await openMenuOn("b.md");
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("acts on the tab that was right-clicked, not the one on screen", async () => {
    const { user, props } = await openMenuOn("b.md");
    await user.click(item("Close Others"));

    expect(props.onCloseMany).toHaveBeenCalledWith(["a.md", "c.md"]);
  });

  it("closes the tabs after the one clicked", async () => {
    const { user, props } = await openMenuOn("a.md");
    await user.click(item("Close Tabs to the Right"));

    expect(props.onCloseMany).toHaveBeenCalledWith(["b.md", "c.md"]);
  });

  it("closes every tab", async () => {
    const { user, props } = await openMenuOn("b.md");
    await user.click(item("Close All"));

    expect(props.onCloseMany).toHaveBeenCalledWith(THREE);
  });

  it("closes the tabs with nothing unsaved in them", async () => {
    const { user, props } = await openMenuOn("b.md", { dirtyPaths: ["b.md"] });
    await user.click(item("Close Saved"));

    expect(props.onCloseMany).toHaveBeenCalledWith(["a.md", "c.md"]);
  });

  // An entry that would close nothing is greyed rather than offered. The condition is the same
  // function that does the work, so the two cannot disagree about what "nothing" means.
  it("greys the entries that would close nothing", async () => {
    await openMenuOn("c.md");

    expect(item("Close Tabs to the Right").hasAttribute("disabled")).toBe(true);
    expect(item("Close Others").hasAttribute("disabled")).toBe(false);
  });

  it("greys Close Others when there is only one tab", async () => {
    await openMenuOn("a.md", { paths: ["a.md"] });
    expect(item("Close Others").hasAttribute("disabled")).toBe(true);
  });

  it("closes itself once an entry is chosen", async () => {
    const { user } = await openMenuOn("b.md");
    await user.click(item("Close"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes itself on Escape", async () => {
    const { user } = await openMenuOn("b.md");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
