import { describe, expect, it } from "vitest";
import { nextDividerWidth, nextKeyboardWidth } from "./dividerDrag";

const bounds = { min: 180, max: 480 };

describe("nextDividerWidth", () => {
  it("widens a right-growing panel when the pointer moves right", () => {
    expect(nextDividerWidth({ startWidth: 268, deltaX: 80, grows: "right", ...bounds })).toBe(348);
  });

  // The chat panel sits on the other side, so the same gesture means the opposite thing. Getting
  // this backwards makes the panel run away from the pointer.
  it("widens a left-growing panel when the pointer moves left", () => {
    expect(nextDividerWidth({ startWidth: 268, deltaX: -80, grows: "left", ...bounds })).toBe(348);
    expect(nextDividerWidth({ startWidth: 268, deltaX: 80, grows: "left", ...bounds })).toBe(188);
  });

  // Measured from where the drag STARTED. Against the current width each move would compound the
  // last, and the panel would accelerate away under a steady pointer.
  it("measures from the width the drag started at", () => {
    const start = 268;
    expect(nextDividerWidth({ startWidth: start, deltaX: 10, grows: "right", ...bounds })).toBe(278);
    expect(nextDividerWidth({ startWidth: start, deltaX: 20, grows: "right", ...bounds })).toBe(288);
    expect(nextDividerWidth({ startWidth: start, deltaX: 30, grows: "right", ...bounds })).toBe(298);
  });

  it("stops at the bounds however far the pointer travels", () => {
    expect(nextDividerWidth({ startWidth: 268, deltaX: -9999, grows: "right", ...bounds })).toBe(180);
    expect(nextDividerWidth({ startWidth: 268, deltaX: 9999, grows: "right", ...bounds })).toBe(480);
  });

  it("returns whole pixels", () => {
    expect(Number.isInteger(nextDividerWidth({ startWidth: 268, deltaX: 7.4, grows: "right", ...bounds }))).toBe(true);
  });
});

describe("nextKeyboardWidth", () => {
  it("steps a right-growing panel with the arrow keys", () => {
    expect(nextKeyboardWidth(268, "ArrowRight", { grows: "right", ...bounds, coarse: false })).toBe(276);
    expect(nextKeyboardWidth(268, "ArrowLeft", { grows: "right", ...bounds, coarse: false })).toBe(260);
  });

  it("steps a left-growing panel the other way", () => {
    expect(nextKeyboardWidth(268, "ArrowRight", { grows: "left", ...bounds, coarse: false })).toBe(260);
  });

  it("takes larger steps with shift", () => {
    expect(nextKeyboardWidth(268, "ArrowRight", { grows: "right", ...bounds, coarse: true })).toBe(300);
  });

  it("respects the bounds", () => {
    expect(nextKeyboardWidth(182, "ArrowLeft", { grows: "right", ...bounds, coarse: false })).toBe(180);
  });

  // Any other key must fall through, or the divider swallows keys that belong to the app.
  it("ignores keys that are not arrows", () => {
    expect(nextKeyboardWidth(268, "Enter", { grows: "right", ...bounds, coarse: false })).toBeNull();
    expect(nextKeyboardWidth(268, "s", { grows: "right", ...bounds, coarse: false })).toBeNull();
  });
});
