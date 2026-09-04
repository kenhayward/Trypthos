import { deflateSync } from "node:zlib";

/// The tray glyph: a page with a folded top-right corner, filled solid rather than outlined - the
/// same "flat fill, thicker marks" treatment `iconAssets.mjs` uses for the app icon's own smallest
/// size, so the tray reads as part of the same design system instead of a separate, thinner icon.
/// The rule lines are cut out of the fill as transparent notches rather than drawn on top, which
/// keeps them legible against any tray background without needing a second colour.
///
/// Two variants:
///   - tray.png       full colour, for Windows
///   - trayTemplate   monochrome with alpha, for macOS. A "Template" image is recoloured by macOS to
///                    suit the menu bar, light or dark - a coloured icon there looks wrong in one of
///                    the two and cannot adapt, so every visible pixel is pure white and only the
///                    alpha channel carries the shape.

export const SIZE = 32;
export const LEAF = [46, 125, 107]; // the app's green, matching --tp-leaf and iconAssets.mjs's LEAF
const FOLD = [201, 230, 220]; // matching iconAssets.mjs's FOLD

/// A 32x32 RGBA canvas, drawn with a tiny scanline renderer. No image library: the shape is a few
/// straight edges, and a dependency to draw a rectangle earns nothing.
export function draw({ mono }) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const fill = mono ? [255, 255, 255] : LEAF;
  const crease = mono ? [255, 255, 255] : FOLD;

  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const at = (y * SIZE + x) * 4;
    pixels[at] = r;
    pixels[at + 1] = g;
    pixels[at + 2] = b;
    pixels[at + 3] = 255;
  };

  // Page outline: x 7..25, y 4..28, with the top-right corner folded from (19,4) to (25,10).
  const left = 7;
  const right = 25;
  const top = 4;
  const bottom = 28;
  const fold = 6;

  const onPage = (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    // The folded corner is cut away along the diagonal.
    if (x > right - fold && y < top + fold) return x - (right - fold) <= y - top;
    return true;
  };

  // The crease is the fold's own diagonal - one pixel wide, running from the corner where the page
  // is cut away down to where the fold meets the page's right edge.
  const onCrease = (x, y) => x > right - fold && y < top + fold && x - (right - fold) === y - top;

  // Two text rules, so the shape reads as a document rather than a plain rounded rectangle.
  const onRule = (x, y) => (y === 17 || y === 21) && x >= left + 3 && x <= right - 3;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!onPage(x, y) || onRule(x, y)) continue;
      set(x, y, onCrease(x, y) ? crease : fill);
    }
  }

  return pixels;
}

export function png(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4)).copy(
      raw,
      y * (SIZE * 4 + 1) + 1,
    );
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
