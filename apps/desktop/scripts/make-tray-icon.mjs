import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/// Generates the tray icons.
///
/// Drawn in code rather than committed as binaries, for two reasons: the design handoff ships no
/// image assets (every icon there is inline SVG), and a generated icon can be regenerated when the
/// mark changes instead of being an opaque blob nobody can edit.
///
/// The glyph is the same document outline the title bar uses - a page with a folded corner - so the
/// tray, the window and the workspace tree all show the same shape.
///
/// Two variants:
///   - tray.png       full colour, for Windows
///   - trayTemplate   monochrome with alpha, for macOS. A "Template" image is recoloured by macOS to
///                    suit the menu bar, light or dark; a coloured icon there looks wrong in one of
///                    the two and cannot adapt.

const SIZE = 32;
const LEAF = [46, 125, 107]; // the app's green, matching --tp-leaf

/// A 32x32 RGBA canvas, drawn with a tiny scanline renderer. No image library: the shape is a few
/// straight edges, and a dependency to draw a rectangle earns nothing.
function draw({ mono }) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const [r, g, b] = mono ? [255, 255, 255] : LEAF;

  const set = (x, y, alpha) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const at = (y * SIZE + x) * 4;
    pixels[at] = r;
    pixels[at + 1] = g;
    pixels[at + 2] = b;
    pixels[at + 3] = Math.max(pixels[at + 3], Math.round(alpha * 255));
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

  const edge = (x, y) => {
    if (!onPage(x, y)) return false;
    // An edge pixel is one on the page with a neighbour off it.
    return !onPage(x - 1, y) || !onPage(x + 1, y) || !onPage(x, y - 1) || !onPage(x, y + 1);
  };

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (edge(x, y)) set(x, y, 1);
    }
  }

  // The fold's own crease, and two text rules, so the shape reads as a document at 16px rather than
  // as a plain rectangle.
  for (let i = 0; i <= fold; i += 1) set(right - fold + i, top + i, 1);
  for (let x = left + 3; x <= right - 3; x += 1) {
    set(x, 17, 0.85);
    set(x, 21, 0.85);
  }

  return pixels;
}

function png(pixels) {
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

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "tray.png"), png(draw({ mono: false })));
writeFileSync(join(out, "trayTemplate.png"), png(draw({ mono: true })));
console.log(`wrote tray.png and trayTemplate.png to ${out}`);
