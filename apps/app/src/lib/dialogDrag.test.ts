import { describe, expect, it } from "vitest";
import { dragLimits, nextDialogPosition } from "./dialogDrag";

const start = { pointerX: 300, pointerY: 200, left: 100, top: 50 };
const limits = { minLeft: 0, maxLeft: 480, minTop: 0, maxTop: 400 };

describe("nextDialogPosition", () => {
  it("moves the dialog with the pointer", () => {
    expect(nextDialogPosition(start, { x: 340, y: 230 }, limits)).toEqual({ left: 140, top: 80 });
    expect(nextDialogPosition(start, { x: 260, y: 170 }, limits)).toEqual({ left: 60, top: 20 });
  });

  // Measured from where the drag BEGAN, not from the last move. Against the current position each
  // move would compound the one before, and the dialog would accelerate away under a steady pointer.
  it("measures from where the drag began", () => {
    expect(nextDialogPosition(start, { x: 310, y: 200 }, limits).left).toBe(110);
    expect(nextDialogPosition(start, { x: 320, y: 200 }, limits).left).toBe(120);
    expect(nextDialogPosition(start, { x: 330, y: 200 }, limits).left).toBe(130);
  });

  // The one that matters. A dialog dragged out of sight is a dialog with no way back: it has no
  // window chrome of its own, and the only thing that could bring it back is the drag it can no
  // longer be given.
  it("stops at the limits it is given", () => {
    expect(nextDialogPosition(start, { x: 9999, y: 9999 }, limits)).toEqual({
      left: 480,
      top: 400,
    });
    expect(nextDialogPosition(start, { x: -9999, y: -9999 }, limits)).toEqual({ left: 0, top: 0 });
  });

  // Negative limits are ordinary here, not an edge case: the position is measured from the panel the
  // dialog is a child of, and it is allowed to travel to the LEFT of that panel and over the one
  // beside it.
  it("follows limits that reach outside its own container", () => {
    const wider = { minLeft: -260, maxLeft: 700, minTop: 0, maxTop: 400 };
    expect(nextDialogPosition(start, { x: -9999, y: 200 }, wider).left).toBe(-260);
  });

  it("returns whole pixels", () => {
    const moved = nextDialogPosition(start, { x: 307.4, y: 203.6 }, limits);
    expect(Number.isInteger(moved.left)).toBe(true);
    expect(Number.isInteger(moved.top)).toBe(true);
  });
});

/// How far the dialog may travel, worked out from the window rather than from the panel it happens
/// to be a child of.
///
/// The panel is only where its coordinates are measured FROM. Every find is about the editor, so the
/// editor is exactly the area a user wants the dialog out of - confining it there would leave the one
/// place it may go being the one place it is in the way.
describe("dragLimits", () => {
  const measured = {
    originX: 300,
    originY: 60,
    viewportWidth: 1200,
    viewportHeight: 800,
    dialogWidth: 320,
    dialogHeight: 200,
  };

  it("lets the dialog reach both edges of the window", () => {
    const { minLeft, maxLeft } = dragLimits(measured);

    // In window terms: hard against the left edge, and hard against the right.
    expect(minLeft + measured.originX).toBe(0);
    expect(maxLeft + measured.originX + measured.dialogWidth).toBe(1200);
  });

  it("lets it reach the bottom of the window", () => {
    const { maxTop } = dragLimits(measured);
    expect(maxTop + measured.originY + measured.dialogHeight).toBe(800);
  });

  // The title bar is above the container's origin, and it carries the window controls. A panel
  // parked over the close button is a panel in the way of the only chrome this window has.
  it("will not go above the container it sits in, which is where the title bar is", () => {
    expect(dragLimits(measured).minTop).toBe(0);
  });

  // A window narrower than the dialog - dragged very small. Clamping to a maximum below the minimum
  // would pin it off the wrong edge, so the low bound wins.
  it("keeps the limits in order when the window is smaller than the dialog", () => {
    const cramped = { ...measured, viewportWidth: 200, viewportHeight: 100 };
    const { minLeft, maxLeft, minTop, maxTop } = dragLimits(cramped);

    expect(maxLeft).toBeGreaterThanOrEqual(minLeft);
    expect(maxTop).toBeGreaterThanOrEqual(minTop);
  });
});
