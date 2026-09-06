import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewFileDialog from "./NewFileDialog";

/// Naming a file that does not exist yet.
///
/// What the two answers make is `newFileName` in the domain, tested there. What is tested here is
/// the dialog: that it offers the right types, that it cannot make a file with no name, and that it
/// does not ask where the file goes - which is the save dialog's question.

function setup(fileTypes: readonly string[] = ["markdown", "python", "text"]) {
  const props = { fileTypes, onCancel: vi.fn(), onCreate: vi.fn() };
  render(<NewFileDialog {...props} />);
  return props;
}

const nameField = () => screen.getByLabelText("Name");
const typeField = () => screen.getByLabelText("Type");
const createButton = () => screen.getByRole("button", { name: "Create" });

describe("NewFileDialog", () => {
  it("offers the file types that are turned on, and nothing else", () => {
    setup(["markdown", "python"]);

    const options = [...typeField().querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Markdown (.md)", "Python (.py)"]);
  });

  it("makes a file with the name and the type chosen", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(nameField(), "notes");
    await user.selectOptions(typeField(), "py");
    await user.click(createButton());

    expect(props.onCreate).toHaveBeenCalledWith("notes.py");
  });

  it("starts on markdown, because that is what the app is", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(nameField(), "notes");
    await user.click(createButton());

    expect(props.onCreate).toHaveBeenCalledWith("notes.md");
  });

  // The name is the more specific of the two answers, so an extension typed by hand wins over the
  // dropdown. Shown before the button is pressed, because otherwise it looks like a mistake.
  it("shows what the file will be called before making it", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(nameField(), "notes.txt");
    expect(screen.getByText("notes.txt")).toBeDefined();
  });

  it("cannot make a file with no name", () => {
    setup();
    expect(createButton().hasAttribute("disabled")).toBe(true);
  });

  // A name is a NAME. Where the file goes is answered by the save dialog, and a name carrying a path
  // would be answering it early and worse.
  it("cannot make a file whose name is really a path", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(nameField(), "notes/plan");
    expect(createButton().hasAttribute("disabled")).toBe(true);
  });

  it("takes a name with a space in it", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(nameField(), "Meeting notes");
    await user.click(createButton());

    expect(props.onCreate).toHaveBeenCalledWith("Meeting notes.md");
  });

  it("makes the file when Enter is pressed in the name", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(nameField(), "notes{Enter}");
    expect(props.onCreate).toHaveBeenCalledWith("notes.md");
  });

  it("backs out on Escape", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  // It asks for a name and a type, and nothing else. A folder field here would be asking the save
  // dialog's question a second time, and the two answers could disagree.
  it("does not ask where the file should go", () => {
    setup();
    expect(screen.queryByLabelText(/folder/i)).toBeNull();
  });
});
