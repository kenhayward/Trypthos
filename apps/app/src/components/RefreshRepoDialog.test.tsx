import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RefreshRepoDialog from "./RefreshRepoDialog";

/// The question asked before a repository is moved to its newest commit.
///
/// Refreshing a folder on disk only shows what is already there. Refreshing a repository changes
/// what the workspace IS - a different commit, different files - and the tabs already open were read
/// from the old one. That is worth a sentence before it happens rather than a surprise after.
function open(overrides: Partial<React.ComponentProps<typeof RefreshRepoDialog>> = {}) {
  const props = {
    name: "essays",
    unsaved: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<RefreshRepoDialog {...props} />);
  return props;
}

describe("RefreshRepoDialog", () => {
  it("says what refreshing a repository changes", () => {
    open();

    const dialog = screen.getByRole("dialog", { name: "Refresh essays from GitHub" });
    expect(dialog.textContent).toMatch(/newest commit/);
    // The consequence that matters: an open file that changed on GitHub cannot be saved over it.
    expect(dialog.textContent).toMatch(/refused as a conflict/);
  });

  it("refreshes only when asked to", async () => {
    const props = open();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("does nothing but close on Cancel", async () => {
    const props = open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing but close on Escape", async () => {
    const props = open();
    await userEvent.keyboard("{Escape}");

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  // Said only when it is true. A warning about unsaved work shown every time is a warning nobody
  // reads by the time it matters.
  it("mentions unsaved work only when there is some", () => {
    open({ unsaved: true });
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();
  });

  it("says nothing about unsaved work when there is none", () => {
    open({ unsaved: false });
    expect(screen.queryByText(/unsaved changes/)).toBeNull();
  });
});
