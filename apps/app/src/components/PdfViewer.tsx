import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Glyph from "./Glyph";
import {
  anchoredScroll,
  fitScale,
  scaleOf,
  stepPicture,
  toggleFit,
  wheelPicture,
  type PictureView,
  type Point,
  type Size,
} from "../lib/pictureZoom";
import { panScroll, wheelZoomTravel, type PanStart } from "../lib/zoom";
import WORKER_URL from "pdfjs-dist/build/pdf.worker.mjs?url";

/// What the viewer asks of a parsed document, and of one of its pages. This is the boundary the
/// viewer crosses, stated here rather than read off the engine: pdfjs hands back far more than a
/// viewport and a render, and the rest of it is a library's promise about a page the viewer never
/// asks for. The one place the two meet is the cast in the parse step, below.
interface PageProxy {
  getViewport: (at: { scale: number }) => Size;
  render: (draw: { canvasContext: unknown; viewport: Size; transform?: unknown[] }) => unknown;
}

export interface DocumentProxy {
  /// A page the engine has not handed over yet is a promise; the surface awaits either, so a test
  /// can seed a plain one.
  numPages: number;
  getPage: (oneBased: number) => PageProxy | PromiseLike<PageProxy>;
}

/// A finished parse: the document, or the reason there is none.
type Outcome = { document: DocumentProxy; error?: never } | { error: unknown; document?: never };

/// One parse per source, for as long as the app is open.
///
/// A document is parsed once and kept: a re-render of the same source - a panel resized, a tab
/// reopened - must not fetch the head of the file and re-run the parser, and a PDF reader asks the
/// transport for ranges rather than for one lump, so a second parse is a second round of them.
///
/// It is exported so the surface's tests can seed it with a hand-written document: the engine is
/// never reached from jsdom, and the real window is the proof of the engine.
export const parsed = new Map<string, Outcome>();

/// The padding around the page, on every side - the picture's, so a fitted page is not drawn
/// against the panel's edge.
const PADDING = 16;

interface Props {
  /// The document, as the shell's own URL. The bytes are streamed over it on demand - the head,
  /// then the xref, then the objects a page needs - never in one lump, and never read here.
  source: string;
  /// Names the document for assistive technology - the path it was opened from.
  name: string;
  /// Fit, or a scale where 1 is the page's own pixels. A page has a natural size like a picture
  /// does, so fit and scale mean the same thing here as they do there.
  view: PictureView;
  /// A new view, and the point within the panel the gesture was aimed at - null for a button or a
  /// key, which are aimed at nothing and zoom about the middle. The viewer keeps that point in place
  /// itself once the new size is drawn; it is reported so a caller can tell the two apart.
  onView: (next: PictureView, anchor: Point | null) => void;
  /// The scale Fit currently works out to, whenever it changes. The window's zoom keys step from
  /// the scale on screen, and only the viewer can measure what that is while in Fit.
  onFit?: (fit: number) => void;
}

/// A document, opened to be read rather than edited.
///
/// It opens at Fit for the picture's reason, unchanged: the first question about a document is what
/// it is, and 100% answers that with a corner of one page. The detail is a gesture away, and the
/// gestures are the picture's - `pictureZoom` is called, not reimplemented, because a page has a
/// natural size exactly as a picture does.
///
/// One page is on screen at a time, drawn to a canvas. A stacked scroll would erase the page
/// boundary, which is the whole point of a document; the page bar is what carries the rest of it.
///
/// The engine is imported inside the parse step, never at the top: nothing eager pays pdf.js, the
/// same rule the grammar packages are held to, and a window that has no document open has no
/// megabytes of parser in its first paint.
export default function PdfViewer({ source, name, view, onView, onFit }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  /// The parse: null while the document is still arriving, then the document or the reason not.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /// The page on screen, 1-based.
  const [page, setPage] = useState(1);
  /// A page the engine could not give. Reported like a failed read rather than drawn as a blank
  /// canvas - a blank page explains nothing, and this one is not even a page.
  const [pageFailed, setPageFailed] = useState(false);
  /// The current page's own pixels, once the engine has them - what Fit fits into, and what 100%
  /// means. Null until then, and nothing is drawn until then: a page's fitted size depends on its
  /// own, so anything drawn before that would be the wrong size for a frame.
  const [natural, setNatural] = useState<Size | null>(null);
  /// The panel's visible box less the padding - what Fit fits into.
  const [box, setBox] = useState<Size | null>(null);

  const doc = outcome?.document ?? null;
  const failure = outcome?.error;
  const pages = doc?.numPages ?? 0;
  const fit = natural !== null && box !== null ? fitScale(natural, box) : 1;
  const scale = scaleOf(view, fit);
  /// Kept behind a password rather than unreadable: the engine rejects those with a PasswordException
  /// rather than an error, and the words for one are not the words for the other.
  const needsPassword =
    typeof failure === "object" && failure !== null && (failure as { name?: string }).name === "PasswordException";
  const failed = failure !== undefined || pageFailed;

  /// The page as the engine has it, once it has it. Held in a ref rather than in state: the size it
  /// answers with is what re-renders the surface, and the page itself draws nothing until that size
  /// is laid out.
  const shown = useRef<PageProxy | null>(null);

  /// Parse once per source. A source already in the cache is answered from it, synchronously -
  /// which is also how a test's hand-written document arrives.
  useLayoutEffect(() => {
    const ask = async () => {
      const cached = parsed.get(source);
      if (cached !== undefined) {
        setOutcome(cached);
        return;
      }
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
        const found = await pdfjs.getDocument({ url: source }).promise;
        /// The engine's answer is wider than the boundary above, and the cast is the one place the
        /// two meet: what the viewer reads is a viewport and a render, and nothing else of a page
        /// proxy is asked for anywhere.
        const result: Outcome = { document: found as unknown as DocumentProxy };
        parsed.set(source, result);
        setOutcome(result);
      } catch (error) {
        const result: Outcome = { error };
        parsed.set(source, result);
        setOutcome(result);
      }
    };
    void ask();
  }, [source]);

  /// The view, the fit, the page and the count as they are now, for listeners attached once. A
  /// wheel spin is many events between two renders, so each one also moves these on rather than
  /// all starting from the state the last render drew.
  const latest = useRef({ view, fit, onView, pages, page });
  useLayoutEffect(() => {
    latest.current = { view, fit, onView, pages, page };
  }, [view, fit, onView, pages, page]);

  /// Where the last gesture was aimed, waiting for the size it asked for to be drawn.
  const pending = useRef<Point | null>(null);

  const change = (next: PictureView, anchor: Point | null) => {
    latest.current.view = next;
    pending.current = anchor;
    latest.current.onView(next, anchor);
  };

  /// What was last drawn: the scale, where the page sat in the content, and the scroll. The
  /// anchor arithmetic needs all three as they were BEFORE the change, and by the time the new size
  /// is laid out the browser has already moved the page and clamped the scroll.
  const drawn = useRef<{ scale: number; offset: Point; scroll: Point } | null>(null);

  /// Where to a page, clamped to the document: a position past the end is the last page, not a
  /// page that does not exist.
  const goTo = (next: number) => {
    const count = latest.current.pages;
    if (count === 0) return;
    const at = Math.min(count, Math.max(1, next));
    if (at === latest.current.page) return;
    latest.current.page = at;
    setPage(at);
  };

  // Measured on mount, before the first paint, and again whenever the panel changes size - so a
  // page in Fit stays fitted as panels are dragged and the window resized.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => {
      const width = Math.max(0, element.clientWidth - 2 * PADDING);
      const height = Math.max(0, element.clientHeight - 2 * PADDING);
      setBox((prev) => (prev !== null && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The page the surface is on, and its own size. A page the engine cannot give is a failure the
  // panel says so about, not a canvas that stays blank.
  useLayoutEffect(() => {
    if (doc === null) return;
    shown.current = null;
    const ask = async () => {
      try {
        const proxy = await doc.getPage(page);
        shown.current = proxy;
        const at = proxy.getViewport({ scale: 1 });
        setNatural({ width: at.width, height: at.height });
        setPageFailed(false);
      } catch {
        shown.current = null;
        setNatural(null);
        setPageFailed(true);
      }
    };
    void ask();
  }, [doc, page]);

  useEffect(() => onFit?.(fit), [fit, onFit]);

  // After a new size is drawn, scroll so the point the gesture was aimed at is where it was. A
  // button or key has no point, so it keeps the middle of the panel where it was instead.
  useLayoutEffect(() => {
    const element = scroller.current;
    const picture = surface.current;
    if (element === null || picture === null) return;
    const before = drawn.current;
    const offset = { x: picture.offsetLeft, y: picture.offsetTop };
    if (natural !== null && before !== null && before.scale !== scale) {
      const next = anchoredScroll({
        scroll: before.scroll,
        pointer: pending.current ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 },
        offset: before.offset,
        oldScale: before.scale,
        newScale: scale,
        newOffset: offset,
      });
      element.scrollLeft = next.x;
      element.scrollTop = next.y;
    }
    pending.current = null;
    drawn.current =
      natural === null ? null : { scale, offset, scroll: { x: element.scrollLeft, y: element.scrollTop } };
    // Only a page with something to scroll can be panned; the cursor says which.
    element.toggleAttribute(
      "data-pannable",
      element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
    );
  }, [scale, natural, box]);

  // The picture's gestures, called rather than reimplemented: the wheel zooms about the pointer, a
  // plain drag pans a page larger than the panel, a double-click asks for actual size.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const pointerIn = (event: MouseEvent): Point => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left - element.clientLeft, y: event.clientY - rect.top - element.clientTop };
    };

    // Attached by hand rather than through `onWheel`: React's wheel listener is passive, so its
    // `preventDefault` would not stop the browser zooming the whole page alongside the document.
    const onWheel = (event: WheelEvent) => {
      const travel = wheelZoomTravel(event);
      if (travel === null) return;
      event.preventDefault();
      const { view: now, fit: fitNow } = latest.current;
      change(wheelPicture(now, fitNow, travel), pointerIn(event));
    };

    const onScroll = () => {
      if (drawn.current !== null) drawn.current.scroll = { x: element.scrollLeft, y: element.scrollTop };
    };

    let start: PanStart | null = null;
    const onMove = (event: MouseEvent) => {
      if (start === null) return;
      const { left, top } = panScroll(start, { x: event.clientX, y: event.clientY });
      element.scrollLeft = left;
      element.scrollTop = top;
    };
    const stop = () => {
      start = null;
      element.removeAttribute("data-panning");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // A press on a scrollbar arrives here too, and is the scrollbar's: taken as a pan, it would
      // fight the thumb, since a pan moves the scroll the opposite way to the pointer.
      const local = pointerIn(event);
      if (local.x >= element.clientWidth || local.y >= element.clientHeight) return;
      // Prevented whatever happens next: the browser's own response to a press on a page is to
      // start dragging a copy of it out of the window, and on a double-click to select it.
      event.preventDefault();
      if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return;
      start = { x: event.clientX, y: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
      element.setAttribute("data-panning", "");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", stop);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const { view: now, fit: fitNow } = latest.current;
      change(toggleFit(now, fitNow), pointerIn(event));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("scroll", onScroll);
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("dblclick", onDoubleClick);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("dblclick", onDoubleClick);
      // The page can go while the button is down, when a tab is closed from a menu.
      stop();
    };
    // `change` and `goTo` read everything they need through refs, so the listeners are attached
    // once - and once the document arrives, which is when the page exists at all: an effect that
    // ran on mount would find nothing to attach to.
  }, [doc]);

  // The page bar: pressing it moves to the page under the press, and holding it walks the
  // document. PageDown and PageUp are bound here rather than in the window's key handler, because
  // this component only exists when a document is on screen - and a key that stepped a markdown
  // file's lines as well as a document's pages would be one key doing two things.
  useEffect(() => {
    const track = bar.current;
    if (track === null) return;

    const press = (event: MouseEvent) => {
      const count = latest.current.pages;
      if (count === 0) return;
      const rect = track.getBoundingClientRect();
      // A bar not yet laid out is one wide, so a press on it is the page it is pressed at rather
      // than a division by nothing.
      const width = Math.max(1, rect.width);
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / width));
      goTo(1 + Math.round(fraction * (count - 1)));
    };

    let held = false;
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      held = true;
      press(event);
    };
    const onMove = (event: MouseEvent) => {
      if (held) press(event);
    };
    const onUp = () => {
      held = false;
    };

    track.addEventListener("mousedown", onDown);
    track.addEventListener("mousemove", onMove);
    track.addEventListener("mouseup", onUp);
    return () => {
      track.removeEventListener("mousedown", onDown);
      track.removeEventListener("mousemove", onMove);
      track.removeEventListener("mouseup", onUp);
    };
    // The bar is only on screen once a document is parsed, so these are attached when it arrives.
  }, [doc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "PageDown") goTo(latest.current.page + 1);
      else if (event.key === "PageUp") goTo(latest.current.page - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const step = (dir: "in" | "out") => change(stepPicture(latest.current.view, latest.current.fit, dir), null);
  const percent = Math.round(scale * 100);
  const button =
    "flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-ink-3 hover:bg-hover hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink";
  const label = t("pdfViewer.pageOf", { page, pages });
  /// Where along the bar the thumb sits: the first page at the start, the last at the end. One page
  /// has nowhere to walk, so its thumb stays at the start.
  const at = pages > 1 ? `${((page - 1) / (pages - 1)) * 100}%` : "0%";

  return (
    <div className="relative h-full">
      {/* The page, or the reason there is none. A file that is not a PDF, or one kept behind a
          password, replaces the surface with the line that says which - a blank page explains
          nothing, and the error path is what makes the row defensible at all. */}
      {failed ? (
        <p data-testid="pdf-failure" className="text-sm text-ink-3">
          {needsPassword ? t("pdfViewer.needsPassword") : t("pdfViewer.couldNotOpen")}
        </p>
      ) : doc === null ? null : (
        <div
          ref={scroller}
          data-testid="page-view"
          className="h-full overflow-auto bg-sunken select-none data-[pannable]:cursor-grab data-[panning]:cursor-grabbing"
        >
          <div
            className="relative grid place-items-center"
            style={{ minWidth: "100%", minHeight: "100%", width: "max-content", padding: PADDING }}
          >
            <canvas
              ref={surface}
              aria-label={name}
              className="block"
              style={{
                maxWidth: "none",
                ...(natural === null
                  ? { opacity: 0 }
                  : { width: `${natural.width * scale}px`, height: `${natural.height * scale}px` }),
              }}
            />
          </div>
        </div>
      )}
      {/* Over the page rather than in a header, so a document gets the whole panel: the picture's
          zoom controls, and the page bar - the analogue of the media scrub bar, which is what makes
          a 40-page document tedious with keys alone. Nothing here until a document is parsed: a
          bar that counts to zero is a bar that says nothing. */}
      {failed || doc === null ? null : (
        <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-md border border-rule bg-app p-0.5 shadow-tab">
          <button type="button" className={button} aria-pressed={view.kind === "fit"} onClick={() => change({ kind: "fit" }, null)}>
            {t("editor.picture.fit")}
          </button>
          <button
            type="button"
            className={button}
            aria-pressed={Math.abs(scale - 1) < 1e-9}
            onClick={() => change({ kind: "scale", scale: 1 }, null)}
          >
            {t("editor.picture.actual")}
          </button>
          <button
            type="button"
            className={button}
            aria-label={t("editor.picture.zoomOut")}
            title={t("editor.picture.zoomOut")}
            onClick={() => step("out")}
          >
            <Glyph>
              <path d="M5 12h14" />
            </Glyph>
          </button>
          {/* Read when reached, never announced: a pinch is dozens of wheel events, and a live region
              would speak the level after every one. */}
          <span
            aria-label={t("editor.picture.zoomLevel", { percent })}
            className="min-w-10 text-center text-xs text-ink-3 tabular-nums"
          >
            {t("editor.picture.zoomLevel", { percent })}
          </span>
          <button
            type="button"
            className={button}
            aria-label={t("editor.picture.zoomIn")}
            title={t("editor.picture.zoomIn")}
            onClick={() => step("in")}
          >
            <Glyph>
              <path d="M5 12h14M12 5v14" />
            </Glyph>
          </button>
          <span aria-label={label} className="min-w-10 text-center text-xs text-ink-3 tabular-nums">
            {label}
          </span>
          <div ref={bar} data-testid="page-bar" className="relative h-3 w-40 rounded bg-rule">
            <div
              ref={thumb}
              className="absolute top--0.5 bottom--0.5 w-2 rounded bg-ink"
              style={{ left: at }}
              aria-label={label}
            />
          </div>
        </div>
      )}
    </div>
  );
}
