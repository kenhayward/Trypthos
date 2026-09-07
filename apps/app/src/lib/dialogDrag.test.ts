import { describe, expect, it } from "vitest";
import { nextDialogPosition } from "./dialogDrag";

const start = { pointerX: 300, pointerY: 200, left: 100, top: 50 };
const bounds = { panelWidth: 800, panelHeight: 600, dialogWidth: 320, dialogHeight: 200 };

describe("nextDialogPosition", () => {
  it("moves the dialog with the pointer", () => {
    expect(nextDialogPosition(start, { x: 340, y: 230 }, bounds)).toEqual({ left: 140, top: 80 });
    expect(nextDialogPosition(start, { x: 260, y: 170 }, bounds)).toEqual({ left: 60, top: 20 });
  });

  // Measured from where the drag BEGAN, not from the last move. Against the current position each
  // move would compound the one before, and the dialog would accelerate away under a steady pointer.
  it("measures from where the drag began", () => {
    expect(nextDialogPosition(start, { x: 310, y: 200 }, bounds).left).toBe(110);
    expect(nextDialogPosition(start, { x: 320, y: 200 }, bounds).left).toBe(120);
    expect(nextDialogPosition(start, { x: 330, y: 200 }, bounds).left).toBe(130);
  });

  // The one that matters. A dialog dragged off the edge is a dialog with no way back: it has no
  // window chrome of its own, and the only thing that could bring it back is the drag it can no
  // longer be given.
  it("keeps the whole dialog inside the panel", () => {
    expect(nextDialogPosition(start, { x: 9999, y: 9999 }, bounds)).toEqual({
      left: 800 - 320,
      top: 600 - 200,
    });
    expect(nextDialogPosition(start, { x: -9999, y: -9999 }, bounds)).toEqual({ left: 0, top: 0 });
  });

  // A panel narrower than the dialog - a window dragged very small, or the editor squeezed between
  // two open side panels. Clamping to a negative maximum would pin it off the left edge, so the
  // left edge wins.
  it("pins to the top left when the panel is smaller than the dialog", () => {
    const cramped = { panelWidth: 200, panelHeight: 100, dialogWidth: 320, dialogHeight: 200 };
    expect(nextDialogPosition(start, { x: 9999, y: 9999 }, cramped)).toEqual({ left: 0, top: 0 });
  });

  it("returns whole pixels", () => {
    const moved = nextDialogPosition(start, { x: 307.4, y: 203.6 }, bounds);
    expect(Number.isInteger(moved.left)).toBe(true);
    expect(Number.isInteger(moved.top)).toBe(true);
  });
});
