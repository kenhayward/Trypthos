import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PdfViewer, { type DocumentProxy, parsed } from "./PdfViewer";

/// A PDF page, painted - the only place this question can be asked.
///
/// A canvas has no pixels anywhere else: jsdom's canvas is a polyfill that holds nothing, so a test
/// there could only ever assert that an element exists. What is under test here is the surface, not
/// pdf.js - the document is hand-written and draws itself a solid rectangle - because the fault that
/// took this file out is the surface's own: a page measured and sized but never asked to paint. The
/// engine's own proof is a real file in the running app, and it stays out of the repo, as it did for
/// the media plan: a fixture binary is a binary in every clone forever.

/// A US letter page in points, invented here the way every name in these fixtures is.
const PAGE = { width: 612, height: 792 };

const DOC = {
  source: "tp-media://workspace/Notes%2Freport.pdf",
  name: "Notes/report.pdf",
};

/// A document whose page paints the rectangle it was handed, in a colour nothing else on the page
/// is. The point of the fake is that the pixels can only be there if the surface passed a real
/// context and a real viewport down to the page.
function painted(): DocumentProxy {
  return {
    numPages: 1,
    getPage: (_oneBased: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: PAGE.width * scale,
        height: PAGE.height * scale,
      }),
      render: (draw: { canvasContext: unknown; viewport: { width: number; height: number } }) => {
        const context = draw.canvasContext as { fillStyle?: unknown; fillRect: (x: number, y: number, w: number, h: number) => void };
        context.fillStyle = "#ff0000";
        context.fillRect(0, 0, draw.viewport.width, draw.viewport.height);
        return null;
      },
    }),
  };
}

/// A page that is still on its way: the answer never comes back, which is what a slow Drive or
/// OneDrive read looks like from the surface's side, without a clock in the test.
function arriving(): DocumentProxy {
  return {
    numPages: 1,
    getPage: (_oneBased: number) => new Promise<never>(() => {}),
  };
}

function seed(source: string, document: DocumentProxy) {
  parsed.set(source, { document });
}

const surfaceOf = (container: HTMLElement) => {
  const canvas = container.querySelector("canvas");
  if (canvas === null) throw new Error("the surface is not on the page");
  return canvas;
};

describe("A PDF page, painted in a real browser", () => {
  // The symptom: the panel opens, the page bar and the zoom controls are there, and the page itself
  // is an empty white area. The document parsed and the page was measured - only the drawing was
  // missing - so this is asserted on pixels, where a blank canvas and a drawn one are the same
  // element and only their contents differ.
  it("paints the page it was given, at the size it measured", async () => {
    seed(DOC.source, painted());
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "scale", scale: 1 }} onView={() => {}} />,
    );
    const canvas = surfaceOf(container);

    const ratio = window.devicePixelRatio || 1;
    await waitFor(() => expect(canvas.width).toBe(Math.round(PAGE.width * ratio)));
    expect(canvas.height).toBe(Math.round(PAGE.height * ratio));

    const context = canvas.getContext("2d")!;
    const [r = 0, g = 0, b = 0] = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    expect([r, g, b]).toEqual([255, 0, 0]);
  });

  // A page has pixels of its own, so a zoom is drawn at that zoom rather than stretched: the size
  // asked of the page is the size on screen times the display's own ratio, and the sample proves
  // the drawing followed the canvas to its new bounds rather than into the old ones.
  it("paints the page at the zoom it was asked for", async () => {
    seed(DOC.source, painted());
    const { container } = render(
      <PdfViewer {...DOC} view={{ kind: "scale", scale: 2 }} onView={() => {}} />,
    );
    const canvas = surfaceOf(container);

    const ratio = window.devicePixelRatio || 1;
    await waitFor(() => expect(canvas.width).toBe(Math.round(PAGE.width * 2 * ratio)));
    expect(canvas.height).toBe(Math.round(PAGE.height * 2 * ratio));

    // The far corner, outside anything the page would have covered at 100%.
    const [r = 0, g = 0, b = 0] = canvas
      .getContext("2d")!
      .getImageData(canvas.width - 2, canvas.height - 2, 1, 1).data;
    expect([r, g, b]).toEqual([255, 0, 0]);
  });

  // The other symptom: a Drive or OneDrive PDF spends seconds in ranges, and the panel says nothing
  // for all of it. The page is not there yet, so the panel says that it is coming rather than
  // holding an empty area the reader cannot tell apart from a page that failed.
  it("says it is opening while the page is still on its way", async () => {
    seed(DOC.source, arriving());
    render(
      <PdfViewer {...DOC} view={{ kind: "fit" }} onView={() => {}} />,
    );
    expect(screen.getByRole("status", { name: "Opening the document..." })).toBeDefined();
    // And nothing has been drawn while it is coming: a surface that was never sized was never
    // painted, so the reader is not looking at a page from a document that has not arrived.
    const canvas = document.querySelector("canvas");
    if (canvas !== null) expect(canvas.getAttribute("width")).toBeNull();
  });
});
