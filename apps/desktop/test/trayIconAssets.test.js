"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/// The tray glyph's pixels: which are filled, and which colour. Kept separate from
/// `make-tray-icon.mjs` (which only writes the two PNGs to disk) for the same reason `iconAssets.mjs`
/// is separate from `make-app-icon.mjs` - the part with an objectively right answer should be
/// testable without touching the filesystem.
///
/// The glyph used to be an outline: only the pixels on the page's edge were drawn, everything inside
/// left transparent. That read as thin and pale next to the new bold, filled app icon, so the tray
/// now fills the page solid and cuts the rule lines out of it instead - the same "flat fill, no
/// gradient, thicker marks" treatment `iconAssets.mjs` already uses for the app icon's own smallest
/// size, so the tray reads as the same design system rather than a different, older icon.

let trayIconAssets;
test.before(async () => {
  trayIconAssets = await import("../scripts/trayIconAssets.mjs");
});

function pixelAt(pixels, size, x, y) {
  const at = (y * size + x) * 4;
  return { r: pixels[at], g: pixels[at + 1], b: pixels[at + 2], a: pixels[at + 3] };
}

test("the page is a solid fill, not an outline", () => {
  const { draw, SIZE } = trayIconAssets;
  const pixels = draw({ mono: false });

  // Well inside the page body, away from the rule lines and the folded corner - an outline-only
  // renderer leaves this transparent, a filled one does not.
  const inside = pixelAt(pixels, SIZE, 10, 10);
  assert.equal(inside.a, 255);
  assert.deepEqual([inside.r, inside.g, inside.b], [46, 125, 107], "fills with the app's leaf green");
});

test("the rule lines are cut out of the fill, not drawn on top of it", () => {
  const { draw, SIZE } = trayIconAssets;
  const pixels = draw({ mono: false });

  const rule = pixelAt(pixels, SIZE, 15, 17);
  assert.equal(rule.a, 0, "a rule line is a transparent notch through the solid page");
});

test("the folded corner's crease is a distinct, lighter tone from the page fill", () => {
  const { draw, SIZE } = trayIconAssets;
  const pixels = draw({ mono: false });

  // The crease runs the diagonal of the folded top-right corner - one point on it is enough to prove
  // it is drawn in the fold colour, not the page's leaf green.
  const crease = pixelAt(pixels, SIZE, 24, 9);
  assert.equal(crease.a, 255);
  assert.notDeepEqual([crease.r, crease.g, crease.b], [46, 125, 107]);
});

test("outside the page, nothing is drawn", () => {
  const { draw, SIZE } = trayIconAssets;
  const pixels = draw({ mono: false });

  assert.equal(pixelAt(pixels, SIZE, 0, 0).a, 0);
  assert.equal(pixelAt(pixels, SIZE, SIZE - 1, SIZE - 1).a, 0);
});

// A Template image is recoloured by macOS to suit the menu bar in either appearance - it works from
// the alpha channel alone, so every visible pixel must be pure white regardless of whether it is
// fill or crease. Colour there would not be wrong so much as pointless: macOS ignores it.
test("the mono variant is pure white everywhere it is visible, fill and crease alike", () => {
  const { draw, SIZE } = trayIconAssets;
  const pixels = draw({ mono: true });

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const { r, g, b, a } = pixelAt(pixels, SIZE, x, y);
      if (a === 0) continue;
      assert.deepEqual([r, g, b], [255, 255, 255], `pixel (${x},${y}) must be white, not tinted`);
    }
  }
});

test("png() still produces a 32x32 PNG", () => {
  const { draw, png, SIZE } = trayIconAssets;
  const bytes = png(draw({ mono: false }));

  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "PNG signature",
  );
  assert.equal(bytes.readUInt32BE(16), SIZE, "IHDR width");
  assert.equal(bytes.readUInt32BE(20), SIZE, "IHDR height");
});
