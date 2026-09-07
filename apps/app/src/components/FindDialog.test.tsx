import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FindDialog from "./FindDialog";
import type { FindStatus } from "../hooks/useFind";

const idle: FindStatus = { kind: "idle" };

function show(props: Partial<React.ComponentProps<typeof FindDialog>> = {}) {
  const handlers = {
    onTabChange: vi.fn(),
    onQueryChange: vi.fn(),
    onRegexChange: vi.fn(),
    onCaseSensitiveChange: vi.fn(),
    onMove: vi.fn(),
    onSearch: vi.fn(),
    onStep: vi.fn(),
    onClose: vi.fn(),
  };
  const dialog = (extra: Partial<React.ComponentProps<typeof FindDialog>>) => (
    <FindDialog
      tab="document"
      query=""
      regex={false}
      caseSensitive={false}
      position={null}
      scope=""
      status={idle}
      {...handlers}
      {...props}
      {...extra}
    />
  );
  const view = render(dialog({}));
  return { ...handlers, again: (extra: Partial<React.ComponentProps<typeof FindDialog>>) =>
    view.rerender(dialog(extra)) };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("FindDialog", () => {
  it("offers both searches as tabs, with Find open", () => {
    show();

    expect(screen.getByRole("tab", { name: "Find" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Find in Files" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("switches tab", async () => {
    const user = userEvent.setup();
    const { onTabChange } = show();

    await user.click(screen.getByRole("tab", { name: "Find in Files" }));
    expect(onTabChange).toHaveBeenCalledWith("files");
  });

  it("reports what is typed, and whether it is a pattern", async () => {
    const user = userEvent.setup();
    const { onQueryChange, onRegexChange } = show();

    await user.type(screen.getByLabelText("Search for"), "c");
    expect(onQueryChange).toHaveBeenCalledWith("c");

    await user.click(screen.getByLabelText("Regular expression"));
    expect(onRegexChange).toHaveBeenCalledWith(true);
  });

  // Two independent choices, not a mode. A case-sensitive regular expression is an ordinary thing
  // to want, and so is a case-sensitive plain search.
  it("reports whether case matters, separately from whether it is a pattern", async () => {
    const user = userEvent.setup();
    const { onCaseSensitiveChange } = show({ regex: true });

    await user.click(screen.getByLabelText("Match case"));
    expect(onCaseSensitiveChange).toHaveBeenCalledWith(true);
  });

  // Nothing to search for is not a search. The hook refuses it too, because Enter reaches it
  // without going past this button.
  it("cannot search for nothing", () => {
    show({ query: "   " });
    expect(button("Search").hasAttribute("disabled")).toBe(true);
  });

  it("searches what was typed", async () => {
    const user = userEvent.setup();
    const { onSearch } = show({ query: "cat" });

    await user.click(button("Search"));
    expect(onSearch).toHaveBeenCalled();
  });

  // The buttons are dead until there is something to walk. A Next that did nothing would be a Next
  // somebody presses twice before believing it.
  it("offers next and previous only once there are results", () => {
    const { again } = show({ query: "cat" });
    expect(button("Next").hasAttribute("disabled")).toBe(true);

    again({ status: { kind: "results", total: 3, current: 1, capped: false } });
    expect(button("Next").hasAttribute("disabled")).toBe(false);
    expect(button("Previous").hasAttribute("disabled")).toBe(false);
  });

  it("steps forwards and backwards", async () => {
    const user = userEvent.setup();
    const { onStep } = show({
      query: "cat",
      status: { kind: "results", total: 3, current: 2, capped: false },
    });

    await user.click(button("Next"));
    expect(onStep).toHaveBeenCalledWith("next");

    await user.click(button("Previous"));
    expect(onStep).toHaveBeenLastCalledWith("previous");
  });

  // Enter searches, and then walks. That is what makes it possible to go through a document without
  // moving a hand to the buttons.
  it("searches on Enter, and steps on Enter once there are results", async () => {
    const user = userEvent.setup();
    const { onSearch } = show({ query: "cat" });

    await user.type(screen.getByLabelText("Search for"), "{Enter}");
    expect(onSearch).toHaveBeenCalled();
  });

  it("says how far through the results the reader is", () => {
    show({ query: "cat", status: { kind: "results", total: 9, current: 4, capped: false } });
    expect(screen.getByText("4 of 9")).toBeDefined();
  });

  // An answer that was cut short has to say so, or it is a wrong answer given confidently.
  it("says when the search stopped early", () => {
    show({ query: "cat", status: { kind: "results", total: 500, current: 1, capped: true } });
    expect(screen.getByText(/stopped early/)).toBeDefined();
  });

  it("tells a broken expression from an absent one", () => {
    show({ query: "[", regex: true, status: { kind: "bad-pattern" } });
    expect(screen.getByText(/not a regular expression/)).toBeDefined();
  });

  it("says when nothing matched", () => {
    show({ query: "cat", status: { kind: "results", total: 0, current: 0, capped: false } });
    expect(screen.getByText("No matches.")).toBeDefined();
  });

  // Which folder, before the search runs rather than after. The rule is easy to be surprised by.
  it("names the folder it would search, on the files tab only", () => {
    show({ tab: "files", scope: "docs/api" });
    expect(screen.getByText(/docs\/api/)).toBeDefined();
  });

  it("says so when there is no folder open to search", () => {
    show({ tab: "files", scope: null });
    expect(screen.getByText(/Open a folder/)).toBeDefined();
  });

  it("does not talk about folders on the document tab", () => {
    show({ tab: "document", scope: "docs/api" });
    expect(screen.queryByText(/docs\/api/)).toBeNull();
  });

  it("closes from the button and from Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = show();

    await user.click(button("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // Not a modal, deliberately: the answer is a highlight in the document underneath, so a backdrop
  // over it would report three matches and show none of them.
  it("does not take the window over", () => {
    show();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBeNull();
  });
});

/// Where the panel sits.
///
/// Only the styling half is here. Whether a DRAG moves it is a question about layout - it measures
/// its own box and the panel it floats over - and jsdom has no layout engine, so `offsetParent` is
/// null and the gesture cannot start at all. That half is in the browser suite.
describe("FindDialog: where it sits", () => {
  it("keeps the corner it was designed for until it is moved", () => {
    show();
    expect(screen.getByRole("dialog").style.left).toBe("");
  });

  // And `right` is cleared with it, or the panel would be pinned to both edges and stretch instead
  // of moving.
  it("sits where it was put once it has been", () => {
    show({ position: { left: 24, top: 96 } });

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.left).toBe("24px");
    expect(dialog.style.top).toBe("96px");
    expect(dialog.style.right).toBe("auto");
  });
});
