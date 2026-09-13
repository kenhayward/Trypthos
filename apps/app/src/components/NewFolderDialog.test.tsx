import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewFolderDialog from "./NewFolderDialog";

function setup() {
  const props = { onCancel: vi.fn(), onCreate: vi.fn() };
  render(<NewFolderDialog {...props} />);
  return props;
}

describe("NewFolderDialog", () => {
  it("creates the folder with the name the person typed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(screen.getByLabelText("Name"), "Archive");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(props.onCreate).toHaveBeenCalledWith("Archive");
  });

  it("does not accept a folder name that is a path", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText("Name"), "outside/folder");

    expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(true);
  });
});
