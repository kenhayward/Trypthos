import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TOOLBAR_ACTIONS } from "@trypthos/domain";
import EditorToolbar from "./EditorToolbar";
import en from "../locales/en.json";

const LABELS = en.editor.toolbar as Record<string, string>;

describe("EditorToolbar", () => {
  it("offers a named button for every action", () => {
    render(<EditorToolbar onFormat={vi.fn()} />);

    for (const action of TOOLBAR_ACTIONS) {
      // By its accessible name, which is the whole point of labelling an icon button: a toolbar of
      // sixteen glyphs is unusable to anybody reading it aloud, and untestable by anything else.
      expect(screen.getByRole("button", { name: LABELS[action] })).toBeDefined();
    }
  });

  it("reports which button was pressed", async () => {
    const user = userEvent.setup();
    const onFormat = vi.fn();
    render(<EditorToolbar onFormat={onFormat} />);

    await user.click(screen.getByRole("button", { name: LABELS.bold! }));
    await user.click(screen.getByRole("button", { name: LABELS.table! }));

    expect(onFormat.mock.calls.map(([action]) => action)).toEqual(["bold", "table"]);
  });

  // One tab stop for the whole toolbar, as the tab strip has for the whole strip. Sixteen buttons
  // between the tabs and the document would put the editor a long way from the keyboard.
  it("is one tab stop, and moves along itself with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<EditorToolbar onFormat={vi.fn()} />);

    await user.tab();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(LABELS.bold);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(LABELS.italic);

    await user.keyboard("{End}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(LABELS.rule);

    // Past the last button is the document, not the first button again.
    await user.tab();
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe(LABELS.bold);
  });
});
