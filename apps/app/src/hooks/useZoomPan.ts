import { useEffect, useRef, type RefObject } from "react";
import { panScroll, stepWheelTravel, wheelZoomTravel, type PanStart, type ZoomDirection } from "../lib/zoom";

interface Options {
  /// The element the gestures are read on.
  host: RefObject<HTMLElement | null>;
  /// The element that actually scrolls, when it is not the host.
  ///
  /// A function rather than an element, because the answer can arrive after this hook runs:
  /// CodeMirror's scroller is created by CodeMirror, and only exists once the view has been built.
  scroller?: () => HTMLElement | null;
  /// One rung of zoom, from a Ctrl or Cmd wheel notch or a pinch. The surface decides what a step
  /// means - a font size, or rendered prose's `em` - which is why this reports a direction and not
  /// a number.
  onZoom: (direction: ZoomDirection) => void;
}

/// Ctrl/Cmd+wheel or pinch to zoom, Shift+drag to pan. Shift+wheel is left to scroll sideways.
///
/// One hook for both text surfaces - the editor and rendered prose - so the gesture is the same
/// wherever the pointer is, and there is one place to correct it if it is wrong. A picture has its
/// own (see `ImageViewer`): it zooms continuously about the pointer, and a plain drag pans it.
///
/// Two pieces of DOM detail are load-bearing here, and both are invisible when they are wrong:
///
/// - The wheel listener is attached by hand rather than through `onWheel`. React attaches its wheel
///   listener PASSIVELY at the root, so `preventDefault` from a React handler does nothing: the zoom
///   would happen and the browser's own page zoom would fire alongside it.
/// - The press is taken in the CAPTURE phase and stopped there. CodeMirror handles a shifted
///   mousedown as "extend the selection to here", so without this a pan also selects everything it
///   is dragged across - and then the next keystroke replaces it.
export function useZoomPan({ host, scroller, onZoom }: Options): void {
  /// Read through a ref so the listeners, which are attached once, never call a stale handler.
  const latestOnZoom = useRef(onZoom);
  const latestScroller = useRef(scroller);
  useEffect(() => {
    latestOnZoom.current = onZoom;
    latestScroller.current = scroller;
  }, [onZoom, scroller]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const scrolling = () => latestScroller.current?.() ?? element;

    /// Travel not yet worth a rung. A pinch is a stream of tiny deltas, so the accumulator is what
    /// stops it stepping the whole ladder in one gesture; see `stepWheelTravel`.
    let pending = 0;

    const onWheel = (event: WheelEvent) => {
      const travel = wheelZoomTravel(event);
      if (travel === null) return;
      // Prevented for every zoom event, stepping or not - a pinch's small deltas would otherwise
      // fall through to the browser's own page zoom between rungs.
      event.preventDefault();
      const result = stepWheelTravel(pending, travel);
      pending = result.pending;
      if (result.direction !== null) latestOnZoom.current(result.direction);
    };

    let start: PanStart | null = null;
    let target: HTMLElement | null = null;

    const onMove = (event: MouseEvent) => {
      if (start === null || target === null) return;
      const { left, top } = panScroll(start, { x: event.clientX, y: event.clientY });
      target.scrollLeft = left;
      target.scrollTop = top;
    };

    const stop = () => {
      start = null;
      target = null;
      element.removeAttribute("data-panning");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!event.shiftKey || event.button !== 0) return;

      const scrolled = scrolling();
      if (scrolled === null) return;

      event.preventDefault();
      event.stopPropagation();

      target = scrolled;
      start = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: scrolled.scrollLeft,
        scrollTop: scrolled.scrollTop,
      };
      // Marked on the element rather than held in state: a pan redraws nothing, and a re-render per
      // mouse move would be a re-render per mouse move.
      element.setAttribute("data-panning", "true");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", stop);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("mousedown", onMouseDown, true);

    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("mousedown", onMouseDown, true);
      // A drag can still be under way - the surface can go while the button is down, when a tab is
      // closed from a menu. Without this the window keeps a listener holding a detached element.
      stop();
    };
  }, [host]);
}
