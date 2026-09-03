"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/// The app icon: which artwork goes at which size, and the two binary containers it gets packed
/// into.
///
/// Rendering the vector art to pixels is delegated to `sharp` - getting gradients and arcs right by
/// hand is the kind of thing that is easy to get subtly wrong and hard to notice. What is NOT
/// delegated, and is tested here, is everything with an objectively right answer: which of the
/// hand-drawn variants applies at a given size, and the byte layout of the .ico and .icns
/// containers. A wrong OSType code or a mis-set directory offset produces a file that LOOKS fine
/// until the one moment somebody opens it in Explorer or Finder.

let iconAssets;
test.before(async () => {
  iconAssets = await import("../scripts/iconAssets.mjs");
});

test("Windows: the small size is a distinct variant from the rest", () => {
  const { windowsVariantFor } = iconAssets;
  assert.equal(windowsVariantFor(256), "full");
  assert.equal(windowsVariantFor(48), "full");
  assert.equal(windowsVariantFor(32), "full");
  assert.equal(windowsVariantFor(16), "small");
});

test("Windows: the full variant carries the gradient and the folded corner", () => {
  const svg = iconAssets.windowsIconSvg(256);
  assert.match(svg, /url\(#/);
  // The fold-corner triangle path, the one part that disappears at 16px.
  assert.match(svg, /M164 60 V76 H180 Z/);
});

// At 16px the gradient banding is invisible and a flat fill reads more cleanly - and the fold
// triangle is too small to read as anything but a smudge, so it is dropped rather than shrunk.
test("Windows: the small variant is flat, with no fold triangle", () => {
  const svg = iconAssets.windowsIconSvg(16);
  assert.doesNotMatch(svg, /url\(#/);
  assert.match(svg, /fill="#2E7D6B"/);
  assert.doesNotMatch(svg, /M164 60 V76 H180 Z/);
});

test("Windows: the rule lines thicken as the icon shrinks, so they stay legible", () => {
  const full = iconAssets.windowsIconSvg(32);
  const small = iconAssets.windowsIconSvg(16);
  assert.match(full, /stroke-width="6"/);
  assert.match(small, /stroke-width="10"/);
});

test("Windows: every declared ICO size renders without throwing", () => {
  for (const size of iconAssets.WINDOWS_ICO_SIZES) {
    assert.doesNotThrow(() => iconAssets.windowsIconSvg(size));
  }
});

/// macOS. The subtlety worth a test of its own: an OSType that is "16@2x" wants the SIXTEEN-PIXEL
/// artwork rendered at 32 pixels, not the native 32-pixel artwork. Two ICNS entries can therefore
/// share a pixel size while wanting different content.
test("macOS: the base size decides the artwork, independent of the pixel size it is rendered at", () => {
  const { macIconVariantFor } = iconAssets;
  assert.equal(macIconVariantFor(16), "small");
  assert.equal(macIconVariantFor(32), "medium");
  assert.equal(macIconVariantFor(128), "full");
  assert.equal(macIconVariantFor(256), "full");
  assert.equal(macIconVariantFor(512), "full");
});

test("macOS: the fold triangle appears only in the full variant", () => {
  const fold = /M159 60 V73 H172 Z/;
  assert.match(iconAssets.macIconSvg(128), fold);
  assert.doesNotMatch(iconAssets.macIconSvg(32), fold);
  assert.doesNotMatch(iconAssets.macIconSvg(16), fold);
});

// Baked into the artwork, not left to the OS: macOS composites its own drop shadow for a Dock icon,
// but an .icns viewed in Finder's icon view or Get Info panel shows exactly the pixels given to it.
test("macOS: every variant bakes in the ellipse shadow", () => {
  for (const base of [16, 32, 128, 256, 512]) {
    assert.match(iconAssets.macIconSvg(base), /<ellipse/);
  }
});

test("macOS: the rule lines thicken as the base size shrinks", () => {
  assert.match(iconAssets.macIconSvg(128), /stroke-width="5"/);
  assert.match(iconAssets.macIconSvg(32), /stroke-width="7"/);
  assert.match(iconAssets.macIconSvg(16), /stroke-width="9"/);
});

test("macOS: the ten ICNS slots span exactly five base sizes, one per OSType", () => {
  const bases = new Set(iconAssets.ICNS_SLOTS.map((slot) => slot.base));
  assert.deepEqual([...bases].sort((a, b) => a - b), [16, 32, 128, 256, 512]);
  assert.equal(iconAssets.ICNS_SLOTS.length, 10);
});

test("macOS: each slot's rendered pixel size is its base size times its scale", () => {
  for (const slot of iconAssets.ICNS_SLOTS) {
    assert.equal(slot.px, slot.base * slot.scale);
  }
});

/// The ICO container. A minimal, well-documented binary format: a 6-byte header, one 16-byte
/// directory entry per image, then the raw PNG bytes back to back.

test("packIco: produces a valid header for however many images it is given", () => {
  const { packIco } = iconAssets;
  const ico = packIco([
    { size: 16, png: Buffer.from([1, 2, 3]) },
    { size: 32, png: Buffer.from([4, 5]) },
  ]);

  assert.equal(ico.readUInt16LE(0), 0); // reserved
  assert.equal(ico.readUInt16LE(2), 1); // type: icon
  assert.equal(ico.readUInt16LE(4), 2); // image count
});

test("packIco: each directory entry names its image's declared size", () => {
  const { packIco } = iconAssets;
  const ico = packIco([
    { size: 16, png: Buffer.from([1]) },
    { size: 48, png: Buffer.from([2]) },
  ]);

  // Directory entries start at byte 6, 16 bytes each. Width and height are single bytes.
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(6 + 1), 16);
  assert.equal(ico.readUInt8(6 + 16), 48);
  assert.equal(ico.readUInt8(6 + 16 + 1), 48);
});

// The one genuinely easy-to-get-wrong rule in the whole format: a byte cannot hold 256, so the spec
// reserves 0 to mean "256". Missing this produces an ico Explorer treats as an empty image at that
// slot.
test("packIco: encodes 256 as the special zero byte, not as 256 itself", () => {
  const { packIco } = iconAssets;
  const ico = packIco([{ size: 256, png: Buffer.from([9, 9]) }]);

  assert.equal(ico.readUInt8(6), 0);
  assert.equal(ico.readUInt8(7), 0);
});

test("packIco: each entry's declared byte count and offset point at its own bytes, in order", () => {
  const { packIco } = iconAssets;
  const a = Buffer.from([1, 1, 1]);
  const b = Buffer.from([2, 2]);
  const ico = packIco([
    { size: 16, png: a },
    { size: 32, png: b },
  ]);

  const entryAt = (index) => 6 + index * 16;
  const sizeA = ico.readUInt32LE(entryAt(0) + 8);
  const offsetA = ico.readUInt32LE(entryAt(0) + 12);
  const sizeB = ico.readUInt32LE(entryAt(1) + 8);
  const offsetB = ico.readUInt32LE(entryAt(1) + 12);

  assert.equal(sizeA, a.length);
  assert.equal(sizeB, b.length);
  assert.deepEqual(ico.subarray(offsetA, offsetA + sizeA), a);
  assert.deepEqual(ico.subarray(offsetB, offsetB + sizeB), b);
});

test("packIco: the whole buffer is exactly the header, the directory, and the images", () => {
  const { packIco } = iconAssets;
  const a = Buffer.from([1, 2, 3, 4]);
  const ico = packIco([{ size: 16, png: a }]);

  assert.equal(ico.length, 6 + 16 * 1 + a.length);
});

test("packIco: refuses to produce a file with nothing in it", () => {
  assert.throws(() => iconAssets.packIco([]));
});

/// The ICNS container. Ten TLV chunks behind a magic header, each named by a four-character OSType
/// rather than by a size - so getting the CODE right for a given size is the whole difficulty.

test("packIcns: opens with the magic bytes and the whole file's length", () => {
  const { packIcns } = iconAssets;
  const icns = packIcns([{ type: "icp4", png: Buffer.from([1, 2, 3]) }]);

  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
});

test("packIcns: each chunk carries its OSType, its own length, and its own bytes", () => {
  const { packIcns } = iconAssets;
  const a = Buffer.from([9, 9, 9]);
  const b = Buffer.from([7, 7]);
  const icns = packIcns([
    { type: "icp4", png: a },
    { type: "ic08", png: b },
  ]);

  // First chunk starts right after the 8-byte file header.
  let at = 8;
  assert.equal(icns.subarray(at, at + 4).toString("ascii"), "icp4");
  const lengthA = icns.readUInt32BE(at + 4);
  assert.equal(lengthA, 8 + a.length); // the chunk's own header counts towards its length
  assert.deepEqual(icns.subarray(at + 8, at + lengthA), a);

  at += lengthA;
  assert.equal(icns.subarray(at, at + 4).toString("ascii"), "ic08");
  const lengthB = icns.readUInt32BE(at + 4);
  assert.deepEqual(icns.subarray(at + 8, at + lengthB), b);
});

test("packIcns: refuses an OSType it does not recognise", () => {
  // Every code this packer accepts is meant to come from ICNS_SLOTS. Anything else is a typo, not a
  // new size somebody is adding on purpose.
  assert.throws(() => iconAssets.packIcns([{ type: "notreal", png: Buffer.from([1]) }]));
});

test("packIcns: refuses to produce a file with nothing in it", () => {
  assert.throws(() => iconAssets.packIcns([]));
});

// The bug this guards against: an ICNS "@2x" slot must render the SMALLER base's artwork at the
// LARGER pixel size, not the larger base's own artwork. Getting this wrong produces an icns where
// half the slots silently show the wrong design.
test("macOS: an artwork variant can be rasterized at a size other than its own base", () => {
  const svg = iconAssets.macIconSvg(16, 32);
  assert.match(svg, /width="32" height="32"/);
  // Still the 16-tier content: no fold, the thickest rule lines.
  assert.doesNotMatch(svg, /M159 60 V73 H172 Z/);
  assert.match(svg, /stroke-width="9"/);
});
