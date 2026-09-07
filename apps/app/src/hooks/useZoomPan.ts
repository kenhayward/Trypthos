import { useEffect, useRef, type RefObject } from "react";
import { panScroll, wheelZoomDirection, type PanStart, type ZoomDirection } from "../lib/zoom";

interface Options {
  /// The element the gestures are read on.
  host: RefObject<HTMLElement | null>;
  /// The element that actually scrolls, when it is not the host.
  ///
  /// A function rather than an element, because the answer can arrive after this hook runs:
  /// CodeMirror's scroller is created by CodeMirror, and only exists once the view has been built.
  scroller?: () => HTMLElement | null;
  /// A wheel notch with Shift held. The surface decides what a step means - a font size, or an
  /// image's pixels - which is why this reports a direction and not a number.
  onZoom: (direction: ZoomDirection) => void;
}

/// Shift+wheel to zoom, Shift+drag to pan.
///
/// One hook for all three surfaces - the editor, rendered prose, and a picture - so the gesture is
/// the same wherever the pointer is, and there is one place to correct it if it is wrong.
///
/// Two pieces of DOM detail are load-bearing here, and both are invisible when they are wrong:
///
/// - The wheel listener is attached by hand rather than through `onWheel`. React attaches its wheel
///   listener PASSIVELY at the root, so `preventDefault` from a React handler does nothing: the zoom
///   would happen and the browser would scroll the surface sideways at the same time.
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

    const onWheel = (event: WheelEvent) => {
      const direction = wheelZoomDirection(event);
      if (direction === null) return;
      event.preventDefault();
      latestOnZoom.current(direction);
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
