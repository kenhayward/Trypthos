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
      />,
    );

    const tab = screen.getByRole("tab");
    expect(tab.textContent).toContain("Markdown Syntax Guide");
    // And not qualified with the open folder, which it is not in.
    expect(tab.getAttribute("title")).toBe("Markdown Syntax Guide");
  });
});
