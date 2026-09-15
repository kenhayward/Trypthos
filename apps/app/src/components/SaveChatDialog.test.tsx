import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SaveChatDialog from "./SaveChatDialog";

function setup(overrides: Partial<Parameters<typeof SaveChatDialog>[0]> = {}) {
  const props = {
    suggested: "Summarise this document",
    attachments: 2,
    folder: "Notes/docs" as string | null,
    onCancel: vi.fn(),
    onSave: vi.fn(async () => true),
    ...overrides,
  };
  render(<SaveChatDialog {...props} />);
  return props;
}

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
const save = () => screen.getByRole("button", { name: "Save" });

describe("SaveChatDialog", () => {
  it("offers a name to start from, selected so typing replaces it", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Save conversation" })).toBeTruthy();
    expect(field().value).toBe("Summarise this document");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 23]);
  });

  // What will be kept, said before it is: file contents are copied into the saved chat, a folder
  // is only its path.
  it("says what is saved with the conversation", () => {
    setup();

    expect(screen.getByText("The text of 2 attached files is saved with it.")).toBeTruthy();
    expect(screen.getByText("The attached folder is saved as its path, Notes/docs.")).toBeTruthy();
  });

  it("says nothing about attachments when there are none", () => {
    setup({ attachments: 0, folder: null });

    expect(screen.queryByText(/attached/)).toBeNull();
  });

  it("saves under the name typed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.clear(field());
    await user.type(field(), "Plan review{Enter}");

    expect(props.onSave).toHaveBeenCalledWith("Plan review");
  });

  it("will not save without a name", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.clear(field());
    await user.type(field(), "   ");

    expect(save().hasAttribute("disabled")).toBe(true);
    await user.keyboard("{Enter}");
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("stays open and says so when the save fails", async () => {
    const user = userEvent.setup();
    setup({ onSave: vi.fn(async () => false) });

    await user.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The conversation could not be saved.",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("cancels without saving", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
