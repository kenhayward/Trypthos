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
function painted(count = 1): DocumentProxy {
  return {
    numPages: count,
    getPage: (_oneBased: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: PAGE.width * scale,
        height: PAGE.height * scale,
      }),
      render: (draw: { canvasContext: unknown; viewport: { width: number; height: number } }) => {
        const context = draw.canvasContext as { fillStyle?: unknown; fillRect: (x: number, y: number, w: number, h: number) => void };
        context.fillStyle = "#ff0000";
        context.fillRect(0, 0, draw.viewport.width, draw.viewport.height);
        return { promise: Promise.resolve(), cancel: () => {} };
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

/// A parse that finishes when the test says so: the document arrives after the first frame, as it
/// does from the engine, rather than synchronously from the cache.
function parsing(source: string) {
  let finish: (document: DocumentProxy) => void = () => {};
  parsed.set(source, new Promise((resolve) => (finish = (document) => resolve({ document }))));
  return (document: DocumentProxy) => finish(document);
}

/// A page whose every drawing is recorded, and finishes or fails only when the test says so - the
/// shape of the engine's render task, which reports a failure through its promise rather than by
/// throwing from the call.
function recorded() {
  const tasks: { cancelled: boolean; fail: (error: unknown) => void }[] = [];
  const document: DocumentProxy = {
    numPages: 1,
    getPage: (_oneBased: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: PAGE.width * scale, height: PAGE.height * scale }),
      render: (_draw: unknown) => {
        let fail: (error: unknown) => void = () => {};
        const promise = new Promise<void>((_resolve, reject) => (fail = reject));
        const task = { cancelled: false, fail };
        tasks.push(task);
        return {
          promise,
          cancel: () => {
            task.cancelled = true;
            fail({ name: "RenderingCancelledException" });
          },
        };
      },
    }),
  };
  return { document, tasks };
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

  // The engine parses after the first frame, never during it. Fit measures the panel it fits into,
  // and a panel that only appeared once the parse was done was never measured - so every real
  // document opened at 100% while the button said Fit. The panel here is smaller than the page in
  // both directions, so Fit and 100% cannot be the same size.
  it("fits a document that arrives after the first frame to the panel it is in", async () => {
    const source = "tp-media://workspace/Notes%2Flater.pdf";
    const arrive = parsing(source);
    const { container } = render(
      <div style={{ width: "400px", height: "300px" }}>
        <PdfViewer source={source} name="Notes/later.pdf" view={{ kind: "fit" }} onView={() => {}} />
      </div>,
    );
    arrive(painted());

    const canvas = surfaceOf(container);
    const view = container.querySelector('[data-testid="page-view"]') as HTMLElement;
    const fit = Math.min(1, (view.clientWidth - 32) / PAGE.width, (view.clientHeight - 32) / PAGE.height);
    expect(fit).toBeLessThan(1);
    await waitFor(() => expect(parseFloat(canvas.style.width)).toBeCloseTo(PAGE.width * fit, 1));
  });

  // A zoom asks for a new drawing while the last one may still be running, and the engine refuses a
  // second drawing on a busy canvas - through the drawing's own promise, after the call returned. So
  // the drawing in flight is cancelled before the next starts, and its cancellation is not a failure.
  it("cancels a drawing still running when the zoom changes, and does not call that a failure", async () => {
    const { document: doc, tasks } = recorded();
    seed(DOC.source, doc);
    const { rerender } = render(<PdfViewer {...DOC} view={{ kind: "scale", scale: 1 }} onView={() => {}} />);
    await waitFor(() => expect(tasks).toHaveLength(1));

    rerender(<PdfViewer {...DOC} view={{ kind: "scale", scale: 2 }} onView={() => {}} />);
    await waitFor(() => expect(tasks).toHaveLength(2));
    expect(tasks[0]?.cancelled).toBe(true);
    // A turn for the cancelled promise to settle, then the page is still the page.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/could not be opened/i)).toBeNull();
  });

  // A drawing that fails after the call returned is still a page that is not showing, and the panel
  // says so rather than leaving the canvas blank.
  it("says the page could not be shown when a drawing fails after it started", async () => {
    const { document: doc, tasks } = recorded();
    seed(DOC.source, doc);
    render(<PdfViewer {...DOC} view={{ kind: "scale", scale: 1 }} onView={() => {}} />);
    await waitFor(() => expect(tasks).toHaveLength(1));
    tasks[0]?.fail(new Error("The page could not be drawn."));
    await waitFor(() => expect(screen.getByText(/could not be opened/i)).toBeDefined());
  });
});

/// One notch of a mouse wheel over the page, the size Chromium reports one as. Returns whether the
/// surface took it - a notch the browser should scroll with is left alone.
function notch(view: HTMLElement, deltaY: number): boolean {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  view.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("A PDF under the mouse wheel", () => {
  const WHEEL = { source: "tp-media://workspace/Notes%2Fwheel.pdf", name: "Notes/wheel.pdf" };

  const open = (scale: number | "fit") => {
    seed(WHEEL.source, painted(3));
    const { container } = render(
      <div style={{ width: "400px", height: "300px" }}>
        <PdfViewer
          {...WHEEL}
          view={scale === "fit" ? { kind: "fit" } : { kind: "scale", scale }}
          onView={() => {}}
        />
      </div>,
    );
    return container.querySelector('[data-testid="page-view"]') as HTMLElement;
  };

  // At Fit the page has no inside to scroll, so the wheel did nothing at all. A notch now turns a page.
  it("turns a page per notch when the page fits the panel", async () => {
    const view = open("fit");
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeDefined());
    expect(notch(view, 100)).toBe(true);
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeDefined());
    notch(view, -100);
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeDefined());
  });

  // Zoomed in, the wheel is the browser's until the page runs out: then it turns, and the reader
  // lands where reading continues - the top of the next page, or the bottom of the one before.
  it("scrolls a zoomed page, and turns at its edge onto where reading continues", async () => {
    const view = open(2);
    await waitFor(() => expect(view.scrollHeight).toBeGreaterThan(view.clientHeight));
    const bottom = () => view.scrollHeight - view.clientHeight;

    // Halfway down, the notch is the browser's.
    view.scrollTop = bottom() / 2;
    expect(notch(view, 100)).toBe(false);
    expect(screen.getByText("Page 1 of 3")).toBeDefined();

    view.scrollTop = bottom();
    expect(notch(view, 100)).toBe(true);
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeDefined());
    await waitFor(() => expect(view.scrollTop).toBe(0));

    expect(notch(view, -100)).toBe(true);
    await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeDefined());
    await waitFor(() => expect(view.scrollTop).toBeGreaterThanOrEqual(bottom() - 1));
  });
});
