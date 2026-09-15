import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { RENAME_PROBLEMS } from "@trypthos/domain";
import RenameDialog from "./RenameDialog";

function setup(overrides: Partial<Parameters<typeof RenameDialog>[0]> = {}) {
  const props = {
    current: "plan.md",
    siblings: ["plan.md", "notes.md"],
    onCancel: vi.fn(),
    onRename: vi.fn(async () => null as string | null),
    ...overrides,
  };
  render(<RenameDialog {...props} />);
  return props;
}

const field = () => screen.getByLabelText<HTMLInputElement>("Name");
const save = () => screen.getByRole("button", { name: "Save" });

describe("RenameDialog", () => {
  it("opens on the current name, with the part before the extension selected", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Rename plan.md" })).toBeTruthy();
    expect(field().value).toBe("plan.md");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4]);
  });

  it("renames to the name typed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.clear(field());
    await user.type(field(), "roadmap.md");
    await user.click(save());

    expect(props.onRename).toHaveBeenCalledWith("roadmap.md");
  });

  it("says a name another entry in the folder has is taken, whatever its case", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.clear(field());
    await user.type(field(), "Notes.md");

    expect(screen.getByRole("alert").textContent).toBe("Something in this folder is already called that.");
    expect(save().hasAttribute("disabled")).toBe(true);
    await user.keyboard("{Enter}");
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("says why a name Windows cannot hold is refused", async () => {
    const user = userEvent.setup();
    setup();

    await user.clear(field());
    await user.type(field(), "what?.md");

    expect(screen.getByRole("alert").textContent).toContain('\\ / : * ? " < > |');
    expect(save().hasAttribute("disabled")).toBe(true);
  });

  it("stays open and shows what went wrong when the rename is refused", async () => {
    const user = userEvent.setup();
    const props = setup({ onRename: vi.fn(async () => "errors.permissionDenied") });

    await user.clear(field());
    await user.type(field(), "roadmap.md{Enter}");

    expect(props.onRename).toHaveBeenCalledWith("roadmap.md");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  // The keys are built from the problem, so the catalogue guard cannot see them - this is the check
  // that each one says something. "unchanged" is the exception: it disables Save and says nothing.
  it("has words for every problem a name can have", () => {
    const problems = RENAME_PROBLEMS.filter((problem) => problem !== "unchanged");
    const missing = [...problems, "denied"].filter((problem) => !i18n.exists(`rename.problems.${problem}`));
    expect(missing).toEqual([]);
  });

  it("cancels without renaming", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onRename).not.toHaveBeenCalled();
  });
});
