import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { detectFlavour } from "@trypthos/domain";
import EditorStatusBar from "./EditorStatusBar";

function bar(overrides: Partial<Parameters<typeof EditorStatusBar>[0]> = {}) {
  const props = {
    mode: "preview" as const,
    fileTypeKey: "fileTypes.markdown",
    lineEnding: "LF" as const,
    stats: "Ln 1, Col 1 · 3 words",
    ...overrides,
  };
  render(<EditorStatusBar {...props} />);
  return props;
}

/// The chip naming which markdown the document is rendered as.
describe("the markdown flavour chip", () => {
  it("names GFM for a document with nothing Obsidian writes", () => {
    bar({ flavour: { detected: detectFlavour("# Plain"), choice: "auto" }, onFlavourChange: vi.fn() });

    const chip = screen.getByRole("button", { name: "Markdown flavour: GFM" });
    expect(chip.textContent).toBe("GFM");
    expect(chip.getAttribute("title")).toBe("GitHub Flavored Markdown, detected. Click to choose.");
  });

  it("names Obsidian, and says what gave it away", () => {
    bar({
      flavour: { detected: detectFlavour("[[a]] [[b]] and ==this==\n\n> [!faq] Why\n> x"), choice: "auto" },
      onFlavourChange: vi.fn(),
    });

    const chip = screen.getByRole("button", { name: "Markdown flavour: Obsidian" });
    expect(chip.getAttribute("title")).toBe(
      "Obsidian Flavored Markdown, detected from 2 wiki links, 1 highlight, 1 callout. Click to choose.",
    );
  });

  it("says a vault decided it", () => {
    bar({ flavour: { detected: detectFlavour("# Plain", { vault: true }), choice: "auto" }, onFlavourChange: vi.fn() });

    expect(screen.getByRole("button", { name: "Markdown flavour: Obsidian" }).getAttribute("title")).toBe(
      "Obsidian Flavored Markdown, detected from the Obsidian vault this file is in. Click to choose.",
    );
  });

  it("offers Auto, GFM and Obsidian, and reports the choice", async () => {
    const user = userEvent.setup();
    const onFlavourChange = vi.fn();
    bar({ flavour: { detected: detectFlavour("[[a]]"), choice: "auto" }, onFlavourChange });

    await user.click(screen.getByRole("button", { name: "Markdown flavour: Obsidian" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => [item.textContent, item.getAttribute("aria-checked")])).toEqual([
      ["Auto (Obsidian)", "true"],
      ["GFM", "false"],
      ["Obsidian", "false"],
    ]);

    await user.click(screen.getByRole("menuitemradio", { name: "GFM" }));
    expect(onFlavourChange).toHaveBeenCalledWith("gfm");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says when the reader chose rather than the detection", () => {
    bar({ flavour: { detected: detectFlavour("[[a]]"), choice: "gfm" }, onFlavourChange: vi.fn() });

    const chip = screen.getByRole("button", { name: "Markdown flavour: GFM" });
    expect(chip.getAttribute("title")).toBe("GitHub Flavored Markdown, chosen for this file. Click to choose.");
  });

  it("is not there for a document that is not markdown", () => {
    bar({ fileTypeKey: "fileTypes.json" });
    expect(screen.queryByRole("button", { name: /Markdown flavour/ })).toBeNull();
  });
});
