import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PdfViewer, { type DocumentProxy, parsed } from "./PdfViewer";

/// A document, opened to be read rather than edited.
///
/// What is worth asserting is everything around the engine that would be wrong by default: a page
/// drawn to a canvas rather than to an element the browser scales for it, a page bar that says where
/// in the document you are, and a file that is not a PDF saying so rather than showing a blank page.
///
/// The engine is never reached here. Every source these tests open is seeded in the parse cache with
/// a hand-written document, so these tests are about the surface and nothing about pdf.js - the real
/// window is the proof of the engine, and it is the only place a page has pixels to draw.
const DOC = {
  source: "tp-media://workspace/Notes%2Freport.pdf",
  name: "Notes/report.pdf",
};

const LOCKED = {
  source: "tp-media://workspace/Notes%2Fsecret.pdf",
  name: "Notes/secret.pdf",
};

const BROKEN = {
  source: "tp-media://workspace/Notes%2Fcorrupt.pdf",
  name: "Notes/corrupt.pdf",
};

// A document whose page has not arrived: what a Drive or OneDrive read looks like from the surface's
// side while the ranges are on their way.
const SLOW = {
  source: "tp-media://workspace/Notes%2Fslow.pdf",
  name: "Notes/slow.pdf",
};

/// A hand-written document standing in for a parsed one, carrying only what the viewer asks a page
/// for: a count, and a page that knows its own size and can be drawn. The size is a US letter page
/// in points, invented here the way the names are.
function pages(count: number): DocumentProxy {
  return {
    numPages: count,
    getPage: (_page: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
      }),
      render: (_: unknown) => null,
    }),
  };
}

/// Puts a finished parse in the cache, exactly as the engine would before the viewer is asked for it.
function seed(source: string, document: DocumentProxy) {
  parsed.set(source, { document });
}

/// A document whose page never arrives: the parse is done and the page is still on its way, which is
/// what a Drive or OneDrive read looks like while its ranges are in flight.
function arriving(): DocumentProxy {
  return {
    numPages: 1,
    getPage: (_page: number) => new Promise<never>(() => {}),
  };
}

function seedFailure(source: string, error: unknown) {
  parsed.set(source, { error });
}

describe("PdfViewer", () => {
  it("draws a page as a canvas, not an <img> and not a .cm-content", () => {
    seed(DOC.source, pages(3));
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    // A page is not a picture: the browser has nothing to scale, and CodeMirror was never asked.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".cm-content")).toBeNull();
  });

  it("names the document for assistive technology", () => {
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(DOC.name);
  });

  it("puts the page bar on screen, with the count it was parsed as", () => {
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(container.querySelector('[data-testid="page-bar"]')).not.toBeNull();
  });

  // A 40-page document is tedious with keys alone, which is what the bar is for. The far end is
  // asserted because past the end is where a bar that does not clamp would put the reader.
  it("moves to a page where the bar is pressed, and clamps a position past the end", () => {
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />,
    );
    const bar = container.querySelector('[data-testid="page-bar"]') as HTMLElement;
    // The button is named because only the left one presses the bar; a synthetic event carries
    // nothing else, and the surface would answer a right click as a page turn.
    fireEvent.mouseDown(bar, { clientX: 1_000_000, button: 0 });
    fireEvent.mouseUp(bar);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    fireEvent.mouseDown(bar, { clientX: 0, button: 0 });
    fireEvent.mouseUp(bar);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    // The other buttons are the window's or the OS's: a page turned by a right click is a page
    // turned by accident.
    fireEvent.mouseDown(bar, { clientX: 1_000_000, button: 2 });
    fireEvent.mouseUp(bar);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  });

  // The row says modes: []; the surface has to agree, or a document gets a header that switches
  // between markdown constructs it has none of.
  it("offers no view to switch to", () => {
    render(<PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />);
    for (const view of ["Live", "Source", "Preview"]) {
      expect(screen.queryByRole("button", { name: view })).toBeNull();
    }
  });

  // Not a blank page: the file was found, and this computer cannot read it. Saying so is what makes
  // the row defensible at all.
  it("says plainly that a file it cannot open could not be opened", () => {
    seedFailure(BROKEN.source, { name: "InvalidPDFException", message: "Invalid object." });
    const { container } = render(
      <PdfViewer {...BROKEN} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByText(/could not be opened/i)).toBeTruthy();
  });

  // The same shape the engine rejects with: a PasswordException, whose code says whether a password
  // was wanted or the one given was wrong.
  it("answers an encrypted document with the words for a password, not a blank page", () => {
    seedFailure(LOCKED.source, { name: "PasswordException", code: 1 });
    const { container } = render(
      <PdfViewer {...LOCKED} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByText(/needs a password/i)).toBeTruthy();
    // The other line, not both: "could not be opened" would send a reader looking for a broken file
    // when the file is whole and merely kept.
    expect(screen.queryByText(/could not be opened/i)).toBeNull();
  });

  // One line, not one per page: a document that failed has no pages, and a surface that drew a
  // message per page would be a surface that has nothing to count to.
  it("says it once, not once per page", () => {
    seedFailure(BROKEN.source, { name: "InvalidPDFException", message: "Invalid object." });
    render(<PdfViewer {...BROKEN} view={{ kind: "fit" }} onView={() => {}} />);
    expect(screen.queryAllByText(/could not be opened/i)).toHaveLength(1);
  });

  // The symptom on a cloud folder: the file was clicked, the ranges are on their way, and the panel
  // holds an empty area for the whole of it. An empty area is what a page that failed looks like
  // too, so the panel says which of the two it is.
  it("says it is opening while the page is still on its way", () => {
    seed(SLOW.source, arriving());
    render(<PdfViewer {...SLOW} view={{ kind: "fit" }} onView={() => {}} />);
    expect(screen.getByRole("status", { name: "Opening the document..." })).toBeDefined();
  });
});
