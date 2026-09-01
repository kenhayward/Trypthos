import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorPanel from "./EditorPanel";

const DOC = "# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n";

/// Mirrors the real arrangement: the document lives above the panel, so a mode switch has no path
/// by which to change it.
function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState(DOC);
  return (
    <EditorPanel
      fileName="notes.md"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const modeButton = (name: string) => screen.getByRole("button", { name });

describe("EditorPanel", () => {
  it("opens in Source mode with the document in an editable surface", () => {
    render(<Harness />);

    expect(modeButton("Source").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton("Preview").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Markdown source").textContent).toContain("Some **bold** text");
  });

  it("shows the file name", () => {
    render(<Harness />);
    expect(screen.getByText("notes.md")).toBeDefined();
  });

  it("renders the document as prose in Preview mode", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(modeButton("Preview"));

    const preview = screen.getByLabelText("Markdown preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Title");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    // The markers are gone because the view renders them, not because the text lost them.
    expect(preview.textContent).not.toContain("**bold**");
  });

  it("has no editing surface in Preview mode", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(modeButton("Preview"));

    expect(screen.queryByLabelText("Markdown source")).toBeNull();
  });

  // The invariant the whole editor design rests on. If a mode switch could rewrite the document,
  // the two audiences would be back to a trade-off: one of them gets their file reformatted.
  it("never alters the document when switching modes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const before = screen.getByLabelText("Markdown source").textContent;

    await user.click(modeButton("Preview"));
    await user.click(modeButton("Source"));
    await user.click(modeButton("Preview"));
    await user.click(modeButton("Source"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Markdown source").textContent).toBe(before);
  });

  it("reports edits to the owner of the document", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByLabelText("Markdown source"));
    await user.keyboard("X");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("X");
  });
});
