import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarkdownPreview from "./MarkdownPreview";

/// What is drawn into the rendered document after rendering - coloured code, typeset math, a diagram,
/// an embedded note - lives in the DOM React set with `dangerouslySetInnerHTML`. React 19 decides
/// whether to set it again by the identity of that object, not by the markup inside it, so a fresh
/// `{ __html }` on every render wiped all of it the next time anything else re-rendered the preview.
describe("MarkdownPreview: what is drawn after rendering", () => {
  it("survives a re-render that does not change the markdown", () => {
    const view = render(<MarkdownPreview source={"# Plan\n\nText."} fileTypes={["markdown"]} zoom={1} />);
    const paragraph = screen.getByText("Text.");
    paragraph.setAttribute("data-drawn", "yes");

    view.rerender(<MarkdownPreview source={"# Plan\n\nText."} fileTypes={["markdown"]} zoom={1.2} />);

    expect(screen.getByText("Text.")).toBe(paragraph);
    expect(paragraph.getAttribute("data-drawn")).toBe("yes");
  });
});

describe("MarkdownPreview: embedded notes", () => {
  it("shows an embedded note's contents in place", async () => {
    const readDocument = vi.fn(async (path: string) => (path === "Notes/Goals.md" ? "# Goals\n\nShip it." : null));
    render(
      <MarkdownPreview
        source={"# Plan\n\n![[Goals]]\n"}
        fileTypes={["markdown"]}
        flavour="obsidian"
        fromPath="Notes/plan.md"
        findByName={async () => ["Notes/Goals.md"]}
        readDocument={readDocument}
      />,
    );

    await waitFor(() => expect(screen.getByText("Ship it.")).toBeDefined());
    expect(readDocument).toHaveBeenCalledWith("Notes/Goals.md");
  });

  // Rendering again - a picture arriving, a keystroke elsewhere in the note - must not read the
  // embedded note off disk each time.
  it("reads each embedded note once while the same document is on screen", async () => {
    const readDocument = vi.fn(async () => "Embedded text.");
    const view = render(
      <MarkdownPreview
        source={"![[Goals]]"}
        fileTypes={["markdown"]}
        flavour="obsidian"
        fromPath="Notes/plan.md"
        findByName={async () => ["Notes/Goals.md"]}
        readDocument={readDocument}
      />,
    );
    await waitFor(() => expect(screen.getByText("Embedded text.")).toBeDefined());

    view.rerender(
      <MarkdownPreview
        source={"![[Goals]]\n\nMore."}
        fileTypes={["markdown"]}
        flavour="obsidian"
        fromPath="Notes/plan.md"
        findByName={async () => ["Notes/Goals.md"]}
        readDocument={readDocument}
      />,
    );
    await waitFor(() => expect(screen.getByText("Embedded text.")).toBeDefined());

    expect(readDocument).toHaveBeenCalledTimes(1);
  });

  it("leaves the link where there is nothing to read embedded notes with", async () => {
    render(<MarkdownPreview source={"![[Goals]]"} fileTypes={["markdown"]} flavour="obsidian" />);
    expect(screen.getByRole("link", { name: "Goals" })).toBeDefined();
  });
});
