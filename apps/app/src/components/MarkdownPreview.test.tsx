import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { findMatches } from "@trypthos/domain";
import MarkdownPreview from "./MarkdownPreview";
import { previewVisibleText } from "../lib/findInPreview";
import { renderMarkdown } from "../lib/markdown";

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

/// What Find found, painted on the rendered prose rather than dragged into another view to show.
describe("MarkdownPreview: what Find found", () => {
  const SOURCE = "One cat, two cats.";
  // Offsets into the rendered prose's visible text - computed against it, not by hand, so they are
  // exactly where a reader sees `cat` rather than where the source happened to spell it.
  const MATCHES = findMatches(previewVisibleText(renderMarkdown(SOURCE)), "cat", {
    regex: false,
    caseSensitive: false,
  })!;

  it("marks every match in the rendered prose", () => {
    render(<MarkdownPreview source={SOURCE} fileTypes={["markdown"]} matches={MATCHES} activeMatch={0} />);

    // Both hits wrapped; the words between them are not.
    expect(document.querySelectorAll(".cm-find-match")).toHaveLength(2);
  });

  it("draws the one being read differently from the rest", () => {
    render(<MarkdownPreview source={SOURCE} fileTypes={["markdown"]} matches={MATCHES} activeMatch={0} />);

    const marks = Array.from(document.querySelectorAll(".cm-find-match"));
    expect(marks[0]!.classList.contains("cm-find-active")).toBe(true);
    expect(marks[1]!.classList.contains("cm-find-active")).toBe(false);
  });

  it("moves the active mark when stepping, without redrawing the document", () => {
    const view = render(<MarkdownPreview source={SOURCE} fileTypes={["markdown"]} matches={MATCHES} activeMatch={0} />);
    // A stand-in for what a later effect drew into the same node - colouring, math. Stepping must not
    // reset `innerHTML` and wipe it: only which mark is active changes, so the document stays put.
    const firstMark = document.querySelector(".cm-find-match")!;
    firstMark.setAttribute("data-drawn", "yes");

    view.rerender(<MarkdownPreview source={SOURCE} fileTypes={["markdown"]} matches={MATCHES} activeMatch={1} />);

    // The same node, still drawn into - and the active mark has moved to the second hit.
    const marks = Array.from(document.querySelectorAll(".cm-find-match"));
    expect(marks[0]).toBe(firstMark);
    expect(firstMark.getAttribute("data-drawn")).toBe("yes");
    expect(marks[0]!.classList.contains("cm-find-active")).toBe(false);
    expect(marks[1]!.classList.contains("cm-find-active")).toBe(true);
  });

  it("marks nothing when there is nothing to show", () => {
    render(<MarkdownPreview source={SOURCE} fileTypes={["markdown"]} />);
    expect(document.querySelectorAll(".cm-find-match")).toHaveLength(0);
  });
});
