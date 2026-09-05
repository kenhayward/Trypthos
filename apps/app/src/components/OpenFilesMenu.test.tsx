import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenFilesMenu from "./OpenFilesMenu";

/// The list behind the kebab at the end of the tab strip.
///
/// The tabs are the primary way to move between open files and stay exactly as they were; this is the
/// affordance for when there are more of them than the row can show, or when the one you want is
/// scrolled out of sight.

function setup(over: Partial<React.ComponentProps<typeof OpenFilesMenu>> = {}) {
  const props = {
    workspaceName: "Trypthos",
    paths: ["docs/notes.md", "specs/plan.md"],
    activePath: "docs/notes.md",
    dirtyPaths: [] as readonly string[],
    onActivate: vi.fn(),
    ...over,
  };
  render(<OpenFilesMenu {...props} />);
  return props;
}

const opener = () => screen.getByRole("button", { name: "All open files" });

describe("OpenFilesMenu", () => {
  it("is a single button until it is opened", () => {
    setup();

    expect(opener().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists every open file, whether or not its tab is in view", async () => {
    setup({ paths: ["docs/notes.md", "specs/plan.md", "README.md"] });

    await userEvent.click(opener());

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /notes\.md/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeDefined();
  });

  // The name is what you look for; the folder is what tells two files with the same name apart, and
  // there is room for it here in a way there is not on a tab.
  it("names each file and says where it lives", async () => {
    setup();

    await userEvent.click(opener());

    const row = screen.getByRole("button", { name: /notes\.md/ });
    expect(row.textContent).toContain("notes.md");
    expect(row.textContent).toContain("Trypthos/docs");
  });

  it("marks the file on screen", async () => {
    setup();

    await userEvent.click(opener());

    expect(
      screen.getByRole("button", { name: /notes\.md/ }).getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /plan\.md/ }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks a file with unsaved changes", async () => {
    setup({ dirtyPaths: ["specs/plan.md"] });

    await userEvent.click(opener());

    expect(screen.getByLabelText("plan.md has unsaved changes")).toBeDefined();
  });

  it("goes to a file when its row is chosen, and closes", async () => {
    const props = setup();

    await userEvent.click(opener());
    await userEvent.click(screen.getByRole("button", { name: /plan\.md/ }));

    expect(props.onActivate).toHaveBeenCalledWith("specs/plan.md");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("closes on Escape without going anywhere", async () => {
    const props = setup();

    await userEvent.click(opener());
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("list")).toBeNull();
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("closes when something else is clicked", async () => {
    setup();

    await userEvent.click(opener());
    await userEvent.click(document.body);

    expect(screen.queryByRole("list")).toBeNull();
  });

  // Nothing to list, so nothing to press: a button that opens an empty list is a dead control in a
  // row that has better uses for the width.
  it("is not there at all when no file is open", () => {
    setup({ paths: [], activePath: null });

    expect(screen.queryByRole("button", { name: "All open files" })).toBeNull();
  });
});
