import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  nextZoom,
  panScroll,
  stepWheelTravel,
  wheelPixels,
  wheelZoomTravel,
  zoomKeyCommand,
  type WheelGesture,
  type ZoomKeyPress,
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

// The plain wheel's travel, on the zoom's scale: a mouse that reports lines or pages turns a PDF
// page as readily as one that reports pixels.
describe("wheelPixels", () => {
  it("scales lines and pages to pixels, and leaves pixels alone", () => {
    expect(wheelPixels(100, 0)).toBe(100);
    expect(wheelPixels(3, 1)).toBe(120);
    expect(wheelPixels(-1, 2)).toBe(-800);
  });
});

describe("wheelZoomTravel", () => {
  const wheel = (init: Partial<WheelGesture> = {}): WheelGesture => ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...init,
  });

  // A pinch on a trackpad arrives as a wheel with ctrlKey set, on macOS and on Windows alike.
  it("reads Ctrl and the wheel as zoom travel, forwards being negative", () => {
    expect(wheelZoomTravel(wheel({ ctrlKey: true, deltaY: -120 }))).toBe(-120);
    expect(wheelZoomTravel(wheel({ ctrlKey: true, deltaY: 120 }))).toBe(120);
  });

  it("reads Cmd and the wheel as zoom travel", () => {
    expect(wheelZoomTravel(wheel({ metaKey: true, deltaY: -100 }))).toBe(-100);
  });

  // Shift goes back to scrolling sideways.
  it("leaves Shift alone, and a plain wheel", () => {
    expect(wheelZoomTravel(wheel({ shiftKey: true, deltaX: -120 }))).toBeNull();
    expect(wheelZoomTravel(wheel({ shiftKey: true, deltaY: -120 }))).toBeNull();
    expect(wheelZoomTravel(wheel({ deltaY: -120 }))).toBeNull();
  });

  it("ignores a zoom wheel that went nowhere", () => {
    expect(wheelZoomTravel(wheel({ ctrlKey: true }))).toBeNull();
  });

  it("converts lines at 40 px and pages at 800 px", () => {
    expect(wheelZoomTravel(wheel({ ctrlKey: true, deltaY: -3, deltaMode: 1 }))).toBe(-120);
    expect(wheelZoomTravel(wheel({ ctrlKey: true, deltaY: 1, deltaMode: 2 }))).toBe(800);
  });
});

describe("stepWheelTravel", () => {
  // A Chromium mouse notch is 100 px, so a step per 50 px would jump two rungs per click.
  it("steps one rung for one event of 50 px or more, and clears what was pending", () => {
    expect(stepWheelTravel(20, 100)).toEqual({ pending: 0, direction: "out" });
    expect(stepWheelTravel(0, -100)).toEqual({ pending: 0, direction: "in" });
    expect(stepWheelTravel(0, -50)).toEqual({ pending: 0, direction: "in" });
  });

  it("accumulates small deltas and steps when they reach 50 px, keeping the remainder", () => {
    let pending = 0;
    const steps: (string | null)[] = [];
    for (let event = 0; event < 10; event += 1) {
      const result = stepWheelTravel(pending, -5);
      pending = result.pending;
      steps.push(result.direction);
    }
    expect(steps.filter((step) => step === "in")).toHaveLength(1);
    expect(steps[9]).toBe("in");
    expect(pending).toBe(0);

    expect(stepWheelTravel(-45, -8)).toEqual({ pending: -3, direction: "in" });
  });

  it("starts again when the direction flips", () => {
    expect(stepWheelTravel(-40, 5)).toEqual({ pending: 5, direction: null });
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

describe("zoomKeyCommand", () => {
  const press = (key: string, held: Partial<ZoomKeyPress> = {}): ZoomKeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...held,
  });

  it("reads the three shortcuts on Windows and Linux", () => {
    expect(zoomKeyCommand(press("=", { ctrlKey: true }), "win32")).toBe("in");
    expect(zoomKeyCommand(press("-", { ctrlKey: true }), "win32")).toBe("out");
    expect(zoomKeyCommand(press("0", { ctrlKey: true }), "linux")).toBe("reset");
  });

  it("reads Ctrl+1 (Cmd+1 on macOS) as actual size, under the same modifier rules", () => {
    expect(zoomKeyCommand(press("1", { ctrlKey: true }), "win32")).toBe("actual");
    expect(zoomKeyCommand(press("1", { metaKey: true }), "darwin")).toBe("actual");
    expect(zoomKeyCommand(press("1", { ctrlKey: true }), "darwin")).toBeNull();
    expect(zoomKeyCommand(press("1", { ctrlKey: true, altKey: true }), "win32")).toBeNull();
    expect(zoomKeyCommand(press("1"), "win32")).toBeNull();
  });

  // Ctrl and the plus key is Ctrl+Shift+= on a US layout and its own key on a numeric pad, so the
  // character that arrives is not always the one on the key cap.
  it("takes every spelling of the plus and minus keys", () => {
    expect(zoomKeyCommand(press("+", { ctrlKey: true }), "win32")).toBe("in");
    expect(zoomKeyCommand(press("_", { ctrlKey: true }), "win32")).toBe("out");
  });

  // Cmd on macOS, and Ctrl there is a right click rather than a modifier.
  it("uses the platform's modifier", () => {
    expect(zoomKeyCommand(press("=", { metaKey: true }), "darwin")).toBe("in");
    expect(zoomKeyCommand(press("=", { ctrlKey: true }), "darwin")).toBeNull();
    expect(zoomKeyCommand(press("=", { metaKey: true }), "win32")).toBeNull();
  });

  it("ignores the keys on their own", () => {
    expect(zoomKeyCommand(press("="), "win32")).toBeNull();
    expect(zoomKeyCommand(press("0"), "win32")).toBeNull();
  });

  // Ctrl+Alt+something is a different shortcut, and on Windows it is how AltGr arrives - so a
  // German keyboard typing a character with AltGr must not resize the document doing it.
  it("leaves a combination with Alt alone", () => {
    expect(zoomKeyCommand(press("-", { ctrlKey: true, altKey: true }), "win32")).toBeNull();
  });

  it("ignores keys that are not the zoom ones", () => {
    expect(zoomKeyCommand(press("s", { ctrlKey: true }), "win32")).toBeNull();
    expect(zoomKeyCommand(press("9", { ctrlKey: true }), "win32")).toBeNull();
  });
});
