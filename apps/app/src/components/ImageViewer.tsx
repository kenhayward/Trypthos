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

interface Props {
  /// The picture, as a data URL. The main process read the file; nothing here touches the disk.
  source: string;
  /// Names the picture for assistive technology - the path it was opened from.
  name: string;
  /// Fit, or a scale where 1 is the picture's own pixels. Applied to its natural size rather than
  /// to the panel, so 100% means the same thing here as it does anywhere else that shows an image.
  view: PictureView;
  /// A new view, and the point within the panel the gesture was aimed at - null for a button or a
  /// key, which are aimed at nothing and zoom about the middle. The viewer keeps that point in place
  /// itself once the new size is drawn; it is reported so a caller can tell the two apart.
  onView: (next: PictureView, anchor: Point | null) => void;
  /// The scale Fit currently works out to, whenever it changes. The window's zoom keys step from
  /// the scale on screen, and only the viewer can measure what that is while in Fit.
  onFit?: (fit: number) => void;
}

/// The padding around the picture, on every side. Taken off the panel's box before fitting, so a
/// fitted picture is not drawn against the panel's edge - and so that a fitted picture fits.
const PADDING = 16;

/// A picture, drawn rather than edited.
///
/// It opens at Fit - the whole picture in view, but never enlarged past its own pixels - because the
/// first question about a picture is what it is, and a screenshot opened at 100% in a side panel
/// answers that with a corner of it. The detail is a gesture away: a double-click or Ctrl/Cmd+1 for
/// 100%, and Ctrl/Cmd with the wheel, or a pinch, to zoom about the pointer.
///
/// The scaling is done by setting a width and height in pixels, not by `transform`. A transform
/// paints the picture larger and leaves the layout box the size it was, so the surface has nothing
/// to scroll and a zoomed-in picture cannot be panned - which is half the feature.
///
/// The gestures are its own rather than `useZoomPan`'s, because they differ from text's: the zoom
/// is continuous rather than by rungs, it is about the pointer, and a plain drag pans - there is no
/// text here for a drag to select, so it needs no modifier.
export default function ImageViewer({ source, name, view, onView, onFit }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  /// The picture's own pixels, once the browser has them.
  ///
  /// Null until it loads, and the picture is invisible until then: its fitted size depends on its
  /// natural one, so anything drawn before that would be the wrong size for a frame.
  const [natural, setNatural] = useState<Size | null>(null);
  /// The panel's visible box less the padding - what Fit fits into.
  const [box, setBox] = useState<Size | null>(null);

  const fit = natural !== null && box !== null ? fitScale(natural, box) : 1;
  const scale = scaleOf(view, fit);

  useEffect(() => onFit?.(fit), [fit, onFit]);

  /// The view and fit as they are now, for listeners attached once. A wheel spin is many events
  /// between two renders, so each one also moves `latest` on rather than all starting from the
  /// view the last render drew.
  const latest = useRef({ view, fit, onView });
  useLayoutEffect(() => {
    latest.current = { view, fit, onView };
  }, [view, fit, onView]);

  /// Where the last gesture was aimed, waiting for the size it asked for to be drawn.
  const pending = useRef<Point | null>(null);

  const change = (next: PictureView, anchor: Point | null) => {
    latest.current.view = next;
    pending.current = anchor;
    latest.current.onView(next, anchor);
  };
  /// What was last drawn: the scale, where the picture sat in the content, and the scroll. The
  /// anchor arithmetic needs all three as they were BEFORE the change, and by the time the new size
  /// is laid out the browser has already moved the picture and clamped the scroll.
  const drawn = useRef<{ scale: number; offset: Point; scroll: Point } | null>(null);

  // Measured on mount, before the first paint, and again whenever the panel changes size - so a
  // picture in Fit stays fitted as panels are dragged and the window resized.
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

  // After a new size is drawn, scroll so the point the gesture was aimed at is where it was. A
  // button or key has no point, so it keeps the middle of the panel where it was instead.
  useLayoutEffect(() => {
    const element = scroller.current;
    const picture = image.current;
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
    // Only a picture with something to scroll can be panned; the cursor says which.
    element.toggleAttribute(
      "data-pannable",
      element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
    );
  }, [scale, natural, box]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    const pointerIn = (event: MouseEvent): Point => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left - element.clientLeft, y: event.clientY - rect.top - element.clientTop };
    };

    // Attached by hand rather than through `onWheel`: React's wheel listener is passive, so its
    // `preventDefault` would not stop the browser zooming the whole page alongside the picture.
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
      // Prevented whatever happens next: the browser's own response to a press on a picture is to
      // start dragging a copy of it out of the window, and on a double-click to select it.
      event.preventDefault();
      if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return;
      start = { x: event.clientX, y: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
      // Marked on the element rather than held in state: a pan redraws nothing, and a re-render per
      // mouse move would be a re-render per mouse move.
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
      // The picture can go while the button is down, when a tab is closed from a menu.
      stop();
    };
    // `change` reads everything it needs through refs, so the listeners are attached once.
  }, []);

  const step = (dir: "in" | "out") => change(stepPicture(latest.current.view, latest.current.fit, dir), null);
  const percent = Math.round(scale * 100);
  const button =
    "flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-ink-3 hover:bg-hover hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink";

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        data-testid="picture-view"
        className="h-full overflow-auto bg-sunken select-none data-[pannable]:cursor-grab data-[panning]:cursor-grabbing"
      >
        {/* Centres a picture smaller than the panel, and lets a larger one scroll from its start:
            `place-items: center` on a box only as wide as the panel would centre an overflowing
            picture too, and push its left half somewhere no scrollbar reaches. Positioned, so the
            picture's offset is measured from here. */}
        <div
          className="relative grid place-items-center"
          style={{ minWidth: "100%", minHeight: "100%", width: "max-content", padding: PADDING }}
        >
          <img
            ref={image}
            src={source}
            alt={t("editor.imageAlt", { name })}
            draggable={false}
            onLoad={(event) => {
              const picture = event.currentTarget;
              // A picture that failed to decode reports zero, and a zero width would scale to a
              // picture that is not there.
              if (picture.naturalWidth > 0) {
                setNatural({ width: picture.naturalWidth, height: picture.naturalHeight });
              }
            }}
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
      {/* Over the picture rather than in a header, so a picture gets the whole panel. */}
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
      </div>
    </div>
  );
}
