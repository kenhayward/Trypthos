import { describe, expect, it } from "vitest";
import { ZOOM_LEVELS } from "./zoom";
import {
  PICTURE_MAX,
  PICTURE_ZOOM_LEVELS,
  anchoredScroll,
  fitScale,
  minScale,
  scaleOf,
  stepPicture,
  toggleFit,
  wheelPicture,
  type PictureView,
} from "./pictureZoom";

const FIT: PictureView = { kind: "fit" };
const at = (scale: number): PictureView => ({ kind: "scale", scale });

describe("PICTURE_ZOOM_LEVELS", () => {
  // The text ladder, extended at both ends: a picture can be far larger than the panel, and a
  // detail can be far smaller than a pixel is worth reading at.
  it("is the text ladder with rungs below and above it", () => {
    expect([...PICTURE_ZOOM_LEVELS]).toEqual([0.1, 0.25, 0.33, ...ZOOM_LEVELS, 5, 6, 8]);
  });

  it("ends at the maximum", () => {
    expect(PICTURE_ZOOM_LEVELS.at(-1)).toBe(PICTURE_MAX);
  });
});

describe("fitScale", () => {
  it("shrinks a picture larger than the box until the whole of it shows", () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 500, height: 500 })).toBe(0.25);
  });

  // The tighter of the two axes wins, or the other one would overflow.
  it("is limited by whichever axis is tighter", () => {
    expect(fitScale({ width: 1000, height: 2000 }, { width: 500, height: 500 })).toBe(0.25);
  });

  // Never enlarged: a small screenshot blown up to the panel is blurred, not clearer.
  it("is exactly 1 for a picture smaller than the box", () => {
    expect(fitScale({ width: 40, height: 20 }, { width: 500, height: 500 })).toBe(1);
  });

  it("is never above 1", () => {
    expect(fitScale({ width: 10, height: 10 }, { width: 5000, height: 5000 })).toBeLessThanOrEqual(1);
  });

  // A panel not yet laid out has no size to fit to; 1 draws the picture rather than nothing.
  it("is 1 for a zero box", () => {
    expect(fitScale({ width: 400, height: 200 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("minScale", () => {
  it("is the bottom rung for a picture that fits above it", () => {
    expect(minScale(0.5)).toBe(0.1);
  });

  // A picture so large that fitting it goes below the ladder must still be able to reach Fit.
  it("goes down to the fit scale when that is smaller", () => {
    expect(minScale(0.04)).toBe(0.04);
  });
});

describe("scaleOf", () => {
  it("is the fit scale in Fit", () => {
    expect(scaleOf(FIT, 0.3)).toBe(0.3);
  });

  it("is the chosen scale otherwise", () => {
    expect(scaleOf(at(2), 0.3)).toBe(2);
  });
});

describe("stepPicture", () => {
  // From Fit the step starts at the scale on screen, not at 100% - otherwise "zoom in" on a
  // picture fitted at 25% would jump to 110%.
  it("steps from Fit starting at the fit scale", () => {
    expect(stepPicture(FIT, 0.3, "in")).toEqual(at(0.33));
    expect(stepPicture(FIT, 0.3, "out")).toEqual(at(0.25));
  });

  it("walks the ladder from a scale", () => {
    expect(stepPicture(at(1), 0.3, "in")).toEqual(at(1.1));
    expect(stepPicture(at(1), 0.3, "out")).toEqual(at(0.9));
  });

  // A scale between rungs - left there by the wheel - still moves to the next one the way asked.
  it("moves off a scale between rungs to the next rung", () => {
    expect(stepPicture(at(1.05), 0.3, "in")).toEqual(at(1.1));
    expect(stepPicture(at(1.05), 0.3, "out")).toEqual(at(1));
  });

  it("stops at the maximum", () => {
    expect(stepPicture(at(PICTURE_MAX), 0.3, "in")).toEqual(at(PICTURE_MAX));
  });

  it("stops at the bottom rung", () => {
    expect(stepPicture(at(0.1), 0.3, "out")).toEqual(at(0.1));
  });

  it("stops at the fit scale when that is below the ladder", () => {
    expect(stepPicture(FIT, 0.04, "out")).toEqual(at(0.04));
  });
});

describe("wheelPicture", () => {
  // Continuous rather than rung by rung: a pinch is a stream of small deltas and should feel like
  // one smooth motion.
  it("scales continuously with the travel, negative meaning in", () => {
    expect(wheelPicture(at(1), 0.3, -100)).toEqual(at(Math.exp(0.2)));
    expect(wheelPicture(at(1), 0.3, 100)).toEqual(at(Math.exp(-0.2)));
  });

  it("starts from the fit scale in Fit", () => {
    const next = wheelPicture(FIT, 0.5, -100);
    expect(next.kind).toBe("scale");
    expect(scaleOf(next, 0.5)).toBeCloseTo(0.5 * Math.exp(0.2), 10);
  });

  it("clamps at the maximum", () => {
    expect(wheelPicture(at(7.9), 0.3, -10000)).toEqual(at(PICTURE_MAX));
  });

  it("clamps at the minimum", () => {
    expect(wheelPicture(at(0.2), 0.3, 10000)).toEqual(at(0.1));
    expect(wheelPicture(at(0.05), 0.04, 10000)).toEqual(at(0.04));
  });
});

describe("toggleFit", () => {
  it("goes from Fit to 100%", () => {
    expect(toggleFit(FIT, 0.3)).toEqual(at(1));
  });

  it("comes back from 100% to Fit", () => {
    expect(toggleFit(at(1), 0.3)).toEqual(FIT);
  });

  // A scale the wheel happened to land on at exactly the fit scale looks like Fit, so it acts like it.
  it("treats a scale equal to the fit scale as Fit", () => {
    expect(toggleFit(at(0.3), 0.3)).toEqual(at(1));
  });

  it("goes to Fit from any other scale", () => {
    expect(toggleFit(at(2.5), 0.3)).toEqual(FIT);
  });
});

describe("anchoredScroll", () => {
  it("keeps the picture point under the pointer where it was", () => {
    const scroll = { x: 100, y: 40 };
    const pointer = { x: 150, y: 90 };
    const offset = { x: 16, y: 16 };
    const newOffset = { x: 16, y: 16 };
    const next = anchoredScroll({ scroll, pointer, offset, oldScale: 1, newScale: 2, newOffset });

    // The picture point under the pointer before, in the picture's own pixels...
    const before = { x: (scroll.x + pointer.x - offset.x) / 1, y: (scroll.y + pointer.y - offset.y) / 1 };
    // ...is the picture point under it after.
    const after = { x: (next.x + pointer.x - newOffset.x) / 2, y: (next.y + pointer.y - newOffset.y) / 2 };
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  // The offset moves when a picture is centred in a panel larger than it, and the arithmetic has to
  // take the new one rather than assume the picture stayed put.
  it("accounts for the picture moving within the panel", () => {
    const next = anchoredScroll({
      scroll: { x: 0, y: 0 },
      pointer: { x: 300, y: 200 },
      offset: { x: 100, y: 50 },
      oldScale: 0.5,
      newScale: 2,
      newOffset: { x: 16, y: 16 },
    });
    // Point (400, 300) in the picture's pixels; at 2 it sits at 816, 616 in the content, and the
    // pointer is 300, 200 into the panel.
    expect(next).toEqual({ x: 516, y: 416 });
  });

  it("never scrolls to a negative offset", () => {
    const next = anchoredScroll({
      scroll: { x: 0, y: 0 },
      pointer: { x: 10, y: 10 },
      offset: { x: 16, y: 16 },
      oldScale: 2,
      newScale: 1,
      newOffset: { x: 16, y: 16 },
    });
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.y).toBeGreaterThanOrEqual(0);
  });
});
