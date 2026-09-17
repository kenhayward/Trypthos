import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlacement";

const viewport = { width: 800, height: 600 };
const size = { width: 200, height: 100 };

describe("placeMenu", () => {
  it("opens down and right from the pointer where there is room", () => {
    expect(placeMenu({ x: 100, y: 100, size, viewport })).toEqual({ left: 100, top: 100 });
  });

  it("opens up and left from the pointer when asked to", () => {
    expect(placeMenu({ x: 500, y: 400, size, viewport, above: true })).toEqual({ left: 300, top: 300 });
  });

  // As a native menu does: the corner stays on the pointer, and the menu opens the other way.
  it("opens upwards when there is no room below", () => {
    expect(placeMenu({ x: 100, y: 590, size, viewport })).toEqual({ left: 100, top: 490 });
  });

  it("opens leftwards when there is no room to the right", () => {
    expect(placeMenu({ x: 790, y: 100, size, viewport })).toEqual({ left: 590, top: 100 });
  });

  it("opens down and right when asked for up and left but there is no room there", () => {
    expect(placeMenu({ x: 100, y: 10, size, viewport, above: true })).toEqual({ left: 100, top: 10 });
  });

  // Neither way fits: pushed against the window's edge rather than hanging off it.
  it("keeps to the window when neither direction fits", () => {
    expect(placeMenu({ x: 100, y: 40, size, viewport: { width: 800, height: 80 } })).toEqual({ left: 100, top: 0 });
    expect(placeMenu({ x: 150, y: 100, size: { width: 300, height: 100 }, viewport: { width: 320, height: 600 } })).toEqual({
      left: 20,
      top: 100,
    });
  });
});
