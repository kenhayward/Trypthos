import { render, screen } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";

/// Where a right-click menu ends up, in a real browser - jsdom measures every box as zero, so whether
/// the menu fits in the window cannot be asked there.

function menuAt(x: number, y: number, above = false) {
  render(
    <ContextMenu label="Menu" x={x} y={y} above={above} onDismiss={vi.fn()}>
      <ContextMenuItem onClick={vi.fn()}>Open Obsidian vault</ContextMenuItem>
      <ContextMenuItem onClick={vi.fn()}>Open GitHub repository</ContextMenuItem>
      <ContextMenuItem onClick={vi.fn()}>Open folder</ContextMenuItem>
    </ContextMenu>,
  );
  return screen.getByRole("menu").getBoundingClientRect();
}

function inside(box: DOMRect) {
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
}

describe("a right-click menu", () => {
  it("opens at the pointer where there is room", async () => {
    await page.viewport(800, 600);
    const box = menuAt(100, 100);
    expect(Math.round(box.left)).toBe(100);
    expect(Math.round(box.top)).toBe(100);
  });

  // A right-click near the bottom of the window - the empty space under the folders is there - put
  // the last entries below the window, where nobody could click them.
  it("stays inside the window when opened near its bottom edge", async () => {
    await page.viewport(800, 600);
    const box = menuAt(100, 590);
    inside(box);
    // Opened upwards from the pointer, as a native menu does, rather than merely nudged.
    expect(Math.round(box.bottom)).toBe(590);
  });

  it("stays inside the window when opened near its right edge", async () => {
    await page.viewport(800, 600);
    const box = menuAt(790, 100);
    inside(box);
    expect(Math.round(box.right)).toBe(790);
  });

  it("stays inside a window too short to open it either way", async () => {
    await page.viewport(800, 80);
    inside(menuAt(100, 40));
  });

  it("stays inside the window when asked to open upwards from near the top", async () => {
    await page.viewport(800, 600);
    inside(menuAt(100, 10, true));
  });
});
