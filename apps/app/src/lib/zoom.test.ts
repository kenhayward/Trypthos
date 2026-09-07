import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  nextZoom,
  panScroll,
  wheelZoomDirection,
} from "./zoom";

describe("ZOOM_LEVELS", () => {
  // The ladder is what makes stepping back from a zoom land on exactly 100% rather than 99.7%,
  // which is the difference between a reset gesture and a reset button.
  it("contains 1 exactly, and is the default", () => {
    expect(ZOOM_LEVELS).toContain(1);
    expect(DEFAULT_ZOOM).toBe(1);
  });

  it("ascends", () => {
    const sorted = [...ZOOM_LEVELS].sort((a, b) => a - b);
    expect([...ZOOM_LEVELS]).toEqual(sorted);
  });

  // The ends are named separately, so a rung added beyond one of them without moving the name would
  // be a rung the gesture could never reach.
  it("ends where the named bounds say it does", () => {
    expect(ZOOM_LEVELS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(MAX_ZOOM);
  });
});

describe("nextZoom", () => {
  it("steps to the next rung up and down", () => {
    expect(nextZoom(1, "in")).toBeGreaterThan(1);
    expect(nextZoom(1, "out")).toBeLessThan(1);
  });

  it("stops at the ends rather than running away", () => {
    expect(nextZoom(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
    expect(nextZoom(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
  });

  // Every rung reachable from every other, so a long spin ends up at the end rather than stalling
  // halfway.
  it("walks the whole ladder", () => {
    let level = MIN_ZOOM;
    for (let step = 0; step < ZOOM_LEVELS.length + 3; step += 1) level = nextZoom(level, "in");
    expect(level).toBe(MAX_ZOOM);
  });

  // A level that is not on the ladder - which nothing produces today, and which a persisted or
  // pasted value could - still has to move, and move the right way.
  it("moves off a level that is not on the ladder", () => {
    expect(nextZoom(1.02, "in")).toBeGreaterThan(1.02);
    expect(nextZoom(1.02, "out")).toBeLessThan(1.02);
  });
});

describe("wheelZoomDirection", () => {
  it("ignores a wheel with no shift held", () => {
    expect(wheelZoomDirection({ shiftKey: false, deltaX: 0, deltaY: -120 })).toBeNull();
  });

  it("reads a wheel forwards as zooming in", () => {
    expect(wheelZoomDirection({ shiftKey: true, deltaX: 0, deltaY: -120 })).toBe("in");
    expect(wheelZoomDirection({ shiftKey: true, deltaX: 0, deltaY: 120 })).toBe("out");
  });

  // The one that is easy to miss: holding Shift makes the browser report a vertical wheel on the
  // HORIZONTAL axis, so a handler reading deltaY alone sees zero on every notch and never zooms.
  it("reads the horizontal axis, which is where a shifted wheel arrives", () => {
    expect(wheelZoomDirection({ shiftKey: true, deltaX: -120, deltaY: 0 })).toBe("in");
    expect(wheelZoomDirection({ shiftKey: true, deltaX: 120, deltaY: 0 })).toBe("out");
  });

  it("ignores a wheel that went nowhere", () => {
    expect(wheelZoomDirection({ shiftKey: true, deltaX: 0, deltaY: 0 })).toBeNull();
  });
});

describe("panScroll", () => {
  const start = { x: 100, y: 100, scrollLeft: 40, scrollTop: 80 };

  // Grab-and-drag: the content follows the pointer, so the scroll offset moves the other way.
  it("moves the content with the pointer", () => {
    expect(panScroll(start, { x: 130, y: 100 })).toEqual({ left: 10, top: 80 });
    expect(panScroll(start, { x: 100, y: 60 })).toEqual({ left: 40, top: 120 });
  });

  // Measured from where the drag began, not from the last move - otherwise each move compounds the
  // one before and the content accelerates away under a steady pointer.
  it("measures from where the drag began", () => {
    expect(panScroll(start, { x: 110, y: 100 })).toEqual({ left: 30, top: 80 });
    expect(panScroll(start, { x: 120, y: 100 })).toEqual({ left: 20, top: 80 });
    expect(panScroll(start, { x: 130, y: 100 })).toEqual({ left: 10, top: 80 });
  });

  // A scroller clamps its own offsets, but a negative one assigned every frame is still churn, and
  // a fractional one leaves the text blurred on a non-retina display.
  it("never asks for a negative or fractional offset", () => {
    expect(panScroll(start, { x: 400.5, y: 400.5 })).toEqual({ left: 0, top: 0 });
  });
});
