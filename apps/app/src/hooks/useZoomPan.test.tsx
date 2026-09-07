import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useZoomPan } from "./useZoomPan";
import type { ZoomDirection } from "../lib/zoom";

/// A surface with something scrollable inside it, which is the shape every caller has: the editor
/// reads gestures on its host and scrolls CodeMirror's scroller, and the picture viewer reads them
/// on the element that scrolls.
function Surface({
  onZoom,
  separateScroller = false,
  onInnerMouseDown,
}: {
  onZoom: (direction: ZoomDirection) => void;
  separateScroller?: boolean;
  onInnerMouseDown?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useZoomPan({
    host,
    scroller: separateScroller ? () => inner.current : undefined,
    onZoom,
  });

  return (
    <div ref={host} data-testid="host">
      <div ref={inner} data-testid="inner" onMouseDown={() => onInnerMouseDown?.()}>
        content
      </div>
    </div>
  );
}

const host = () => screen.getByTestId("host");
const inner = () => screen.getByTestId("inner");

const wheel = (target: HTMLElement, init: WheelEventInit) =>
  target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }));

const mouse = (target: EventTarget, type: string, init: MouseEventInit) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

describe("useZoomPan: the wheel", () => {
  it("zooms when the wheel turns with Shift held", () => {
    const onZoom = vi.fn();
    render(<Surface onZoom={onZoom} />);

    wheel(host(), { shiftKey: true, deltaY: -120 });
    expect(onZoom).toHaveBeenCalledWith("in");

    wheel(host(), { shiftKey: true, deltaY: 120 });
    expect(onZoom).toHaveBeenLastCalledWith("out");
  });

  // A shifted wheel arrives on the horizontal axis, which is also what the browser would scroll
  // sideways with. Both halves matter: the zoom happens, and the sideways scroll does not.
  it("takes the shifted wheel away from the browser", () => {
    const onZoom = vi.fn();
    render(<Surface onZoom={onZoom} />);

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      deltaX: -120,
    });
    host().dispatchEvent(event);

    expect(onZoom).toHaveBeenCalledWith("in");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves an ordinary wheel alone", () => {
    const onZoom = vi.fn();
    render(<Surface onZoom={onZoom} />);

    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 });
    host().dispatchEvent(event);

    expect(onZoom).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // A wheel that reaches the surface after the component has gone must not reach a handler that no
  // longer has a component to zoom.
  it("stops listening when the surface goes", () => {
    const onZoom = vi.fn();
    const { unmount } = render(<Surface onZoom={onZoom} />);
    const surface = host();
    unmount();

    wheel(surface, { shiftKey: true, deltaY: -120 });
    expect(onZoom).not.toHaveBeenCalled();
  });
});

describe("useZoomPan: the drag", () => {
  it("scrolls the surface the other way to the pointer", () => {
    render(<Surface onZoom={vi.fn()} />);
    host().scrollLeft = 100;
    host().scrollTop = 100;

    mouse(host(), "mousedown", { shiftKey: true, clientX: 200, clientY: 200 });
    mouse(window, "mousemove", { shiftKey: true, clientX: 240, clientY: 170 });

    expect(host().scrollLeft).toBe(60);
    expect(host().scrollTop).toBe(130);
  });

  // The editor reads the gesture on its host and scrolls CodeMirror's scroller, which is a
  // descendant. Scrolling the host there moves nothing.
  it("scrolls the element it was told scrolls", () => {
    render(<Surface onZoom={vi.fn()} separateScroller />);
    inner().scrollLeft = 100;

    mouse(host(), "mousedown", { shiftKey: true, clientX: 200, clientY: 200 });
    mouse(window, "mousemove", { shiftKey: true, clientX: 230, clientY: 200 });

    expect(inner().scrollLeft).toBe(70);
    expect(host().scrollLeft).toBe(0);
  });

  // CodeMirror starts extending its selection on a shifted mousedown. Taking the event in the
  // capture phase is what stops a pan from also selecting everything it drags across.
  it("keeps a shifted press away from what is underneath", () => {
    const onInnerMouseDown = vi.fn();
    render(<Surface onZoom={vi.fn()} onInnerMouseDown={onInnerMouseDown} />);

    mouse(inner(), "mousedown", { shiftKey: true, clientX: 10, clientY: 10 });
    expect(onInnerMouseDown).not.toHaveBeenCalled();

    mouse(inner(), "mousedown", { clientX: 10, clientY: 10 });
    expect(onInnerMouseDown).toHaveBeenCalledTimes(1);
  });

  it("ignores a press with no Shift held", () => {
    render(<Surface onZoom={vi.fn()} />);
    host().scrollTop = 100;

    mouse(host(), "mousedown", { clientX: 200, clientY: 200 });
    mouse(window, "mousemove", { clientX: 200, clientY: 150 });

    expect(host().scrollTop).toBe(100);
  });

  // The right button opens a context menu; a pan on it would fight the menu.
  it("ignores a press of anything but the left button", () => {
    render(<Surface onZoom={vi.fn()} />);
    host().scrollTop = 100;

    mouse(host(), "mousedown", { shiftKey: true, button: 2, clientX: 200, clientY: 200 });
    mouse(window, "mousemove", { shiftKey: true, clientX: 200, clientY: 150 });

    expect(host().scrollTop).toBe(100);
  });

  it("stops when the button is released", () => {
    render(<Surface onZoom={vi.fn()} />);
    host().scrollTop = 100;

    mouse(host(), "mousedown", { shiftKey: true, clientX: 200, clientY: 200 });
    mouse(window, "mouseup", { clientX: 200, clientY: 200 });
    mouse(window, "mousemove", { clientX: 200, clientY: 100 });

    expect(host().scrollTop).toBe(100);
  });

  // Nothing else says a drag is happening: the pointer is over text, and without this the cursor
  // stays an I-beam through a gesture that is not selecting anything.
  it("marks the surface while a pan is under way", () => {
    render(<Surface onZoom={vi.fn()} />);
    expect(host().hasAttribute("data-panning")).toBe(false);

    mouse(host(), "mousedown", { shiftKey: true, clientX: 200, clientY: 200 });
    expect(host().getAttribute("data-panning")).toBe("true");

    mouse(window, "mouseup", { clientX: 200, clientY: 200 });
    expect(host().hasAttribute("data-panning")).toBe(false);
  });

  // A drag that outlives its component would keep a window listener - and a reference to a
  // detached element - for the rest of the session.
  it("lets go of the window when the surface goes", () => {
    const { unmount } = render(<Surface onZoom={vi.fn()} />);
    const surface = host();
    surface.scrollTop = 100;

    mouse(surface, "mousedown", { shiftKey: true, clientX: 200, clientY: 200 });
    unmount();
    mouse(window, "mousemove", { shiftKey: true, clientX: 200, clientY: 150 });

    expect(surface.scrollTop).toBe(100);
  });
});
