import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AboutModal from "./AboutModal";
import { APP_VERSION, DISCLAIMERS } from "../lib/appInfo";

const about = (open = true) => {
  const onClose = vi.fn();
  render(<AboutModal open={open} onClose={onClose} />);
  return { onClose };
};

describe("AboutModal", () => {
  it("renders nothing when closed", () => {
    about(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the app and its version", () => {
    about();
    expect(screen.getByText("Trypthos")).toBeDefined();
    expect(screen.getByText(new RegExp(APP_VERSION))).toBeDefined();
  });

  it("lists the third-party disclaimers", () => {
    about();
    expect(screen.getByText(DISCLAIMERS[0]!)).toBeDefined();
  });

  it("closes", async () => {
    const user = userEvent.setup();
    const { onClose } = about();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/// The capability summary is authored as a markdown table, and was being shown verbatim - pipes,
/// separator row and all - because it went into a `<pre>`. It goes through the same renderer as
/// Preview mode and the chat panel now.
describe("AboutModal: the feature table", () => {
  it("renders the summary as a table rather than as its source", () => {
    about();

    const table = screen.getByRole("table");
    expect(table).toBeDefined();
    expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(3);
  });

  it("shows the two column headings", () => {
    about();
    expect(screen.getByRole("columnheader", { name: "Feature" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeDefined();
  });

  it("shows a feature and its description in one row", () => {
    about();
    const row = screen.getByRole("cell", { name: "Markdown editor" }).closest("tr");
    expect(row?.textContent).toMatch(/Live, Source and Preview/);
  });

  // The symptom, stated directly: no pipe characters and no separator row anywhere on screen.
  it("shows none of the markdown that produced it", () => {
    about();
    const shown = screen.getByRole("dialog").textContent ?? "";

    expect(shown).not.toContain("| ---");
    expect(shown).not.toContain("| Feature |");
  });
});
