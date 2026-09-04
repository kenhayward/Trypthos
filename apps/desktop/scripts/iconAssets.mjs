/// The app icon: SVG artwork per platform and size, and the two binary containers it packs into.
///
/// Separated from `make-app-icon.mjs` so the parts with an objectively right answer - which variant
/// applies at a given size, and the byte layout of `.ico`/`.icns` - can be tested without invoking
/// `sharp` or touching disk. Rendering the vector art to pixels is the part left to `sharp`:
/// gradients and rounded-rect arcs are easy to get subtly wrong by hand and hard to notice when
/// wrong, which is exactly the kind of risk worth handing to a mature renderer instead.
///
/// The design is a Claude Design handoff (`Trypthos-Windows-Icon.dc.html` in the PR), high-fidelity:
/// the coordinates and colors below are taken from it directly, not approximated.

/// The mark's colors. `LEAF` is the app's existing `--tp-leaf`; the gradient is a new variant of it
/// for icon contexts, kept flat at small sizes where banding would be invisible anyway and a solid
/// fill reads more cleanly.
const GRADIENT_FROM = "#3D9484";
const GRADIENT_TO = "#1F5A4C";
const LEAF = "#2E7D6B";
const PAGE = "#F4FBF8";
const FOLD = "#C9E6DC";

export const WINDOWS_ICO_SIZES = [16, 32, 48, 256];

/// The notification-area sizes Windows asks for as display scaling changes: 16 at 100%, 20 at
/// 125%, 24 at 150%, 32 at 200%, 48 at 300%. Packed into one .ico so the shell picks the entry
/// itself rather than scaling a single PNG - a 32px PNG scaled down to 20 looks exactly like that.
export const TRAY_ICO_SIZES = [16, 20, 24, 32, 48];

/// Windows: which hand-drawn variant applies at a given size.
///
/// Only the small sizes differ. Up to 24px the fold-corner triangle is a pixel or two - a smudge,
/// not a fold - and a two-stop gradient's banding is invisible anyway, so both are dropped in favour
/// of a flat fill and thicker rules that read more cleanly. That covers the 16px ICO entry and every
/// tray size below 32.
export function windowsVariantFor(size) {
  return size <= 24 ? "small" : "full";
}

/// The page glyph and its two rule lines, shared by the tile and the tray template so the two can
/// never drift. `page`, `fold` and `rule` are the paint for each part; `full` decides whether the
/// fold triangle is drawn and how thick the rules are.
function pageGlyph({ full, page, fold, rule }) {
  const strokeWidth = full ? 6 : 10;
  const foldPath = full ? `<path d="M164 60 V76 H180 Z" fill="${fold}"/>` : "";
  return `<path d="M76 60 H164 L180 76 V196 A8 8 0 0 1 172 204 H84 A8 8 0 0 1 76 196 Z" fill="${page}"/>
  ${foldPath}
  <line x1="92" y1="128" x2="164" y2="128" stroke="${rule}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.55"/>
  <line x1="92" y1="152" x2="150" y2="152" stroke="${rule}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.55"/>`;
}

/// The Windows tile: a Fluent-style rounded square, the page-with-folded-corner glyph, two rule
/// lines. Same 256-unit coordinate space regardless of the pixel size it will be rendered at -
/// stroke widths and every other measurement scale with the canvas because they are specified in
/// SVG user-space units, not fixed pixels.
///
/// `base` decides WHICH artwork, `px` how many pixels it is rasterized at; they differ for a
/// high-DPI rendering of a small icon, which wants the small artwork drawn large - the same rule
/// `macIconSvg` follows for the ICNS "@2x" slots.
export function windowsIconSvg(base, px = base) {
  const full = windowsVariantFor(base) === "full";
  const container = full
    ? `<rect x="4" y="4" width="248" height="248" rx="56" fill="url(#g)"/>`
    : `<rect x="4" y="4" width="248" height="248" rx="56" fill="${LEAF}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${GRADIENT_FROM}"/><stop offset="100%" stop-color="${GRADIENT_TO}"/>
  </linearGradient></defs>
  ${container}
  ${pageGlyph({ full, page: PAGE, fold: FOLD, rule: LEAF })}
</svg>`;
}

/// The macOS menu-bar icon: the Windows tile in silhouette. A Template image is recoloured by macOS
/// from its alpha channel alone, so the tile is opaque white, the page is CUT OUT of it (a mask, so
/// the hole is real transparency rather than a painted-on colour macOS would ignore), and the rule
/// lines are put back inside the hole. Same coordinates as `windowsIconSvg`, so it is the same icon
/// in every respect but colour. Edge-to-edge like the Windows tile, not the inset macOS Dock float:
/// at menu-bar size the float's margin would leave a mark too small to read.
export function trayTemplateSvg(base, px = base) {
  const full = windowsVariantFor(base) === "full";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256">
  <defs><mask id="page">
    <rect x="0" y="0" width="256" height="256" fill="white"/>
    ${pageGlyph({ full, page: "black", fold: "white", rule: "white" })}
  </mask></defs>
  <rect x="4" y="4" width="248" height="248" rx="56" fill="white" mask="url(#page)"/>
</svg>`;
}

/// macOS: which hand-drawn variant applies at a given BASE size (16, 32, 128, 256 or 512 - never a
/// raw pixel count, which is the point: an ICNS "16@2x" slot renders at 32 pixels but wants the
/// SIXTEEN-pixel artwork, not the native 32-pixel one).
export function macIconVariantFor(base) {
  if (base <= 16) return "small";
  if (base <= 32) return "medium";
  return "full";
}

/// The macOS tile: a shallower "continuous" squircle occupying roughly 80% of the canvas (Apple's
/// float placement, not edge-to-edge like the Windows tile), the same glyph and gradient, and a
/// baked-in soft shadow - macOS composites its own for the Dock, but Finder's icon view and Get Info
/// panel show exactly the pixels given to them.
///
/// `base` decides WHICH artwork (the content variant); `px` decides what pixel size it is rasterized
/// at, and defaults to `base` for the common case where they are the same. They differ for an ICNS
/// "@2x" slot: `ic11` wants the SIXTEEN-pixel artwork - no fold, the thickest lines - rendered at 32
/// physical pixels, not the native 32px artwork shrunk or the 16px artwork left small.
export function macIconSvg(base, px = base) {
  const variant = macIconVariantFor(base);
  const strokeWidth = { small: 9, medium: 7, full: 5 }[variant];
  const fold = variant === "full" ? `<path d="M159 60 V73 H172 Z" fill="${FOLD}"/>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${GRADIENT_FROM}"/><stop offset="100%" stop-color="${GRADIENT_TO}"/>
  </linearGradient></defs>
  <ellipse cx="128" cy="238" rx="72" ry="8" fill="rgba(20,40,30,0.16)"/>
  <rect x="26" y="18" width="204" height="204" rx="46" fill="url(#g)"/>
  <path d="M97 60 H159 L172 73 V178 A6 6 0 0 1 166 184 H103 A6 6 0 0 1 97 178 Z" fill="${PAGE}"/>
  ${fold}
  <line x1="110" y1="112" x2="159" y2="112" stroke="${LEAF}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.55"/>
  <line x1="110" y1="132" x2="149" y2="132" stroke="${LEAF}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="0.55"/>
</svg>`;
}

/// The ten images an `.icns` needs, per Apple's format: five base sizes (16, 32, 128, 256, 512),
/// each with a "@2x" pixel-doubled sibling - and 256 and 512 each coincide with the base size below
/// their own @2x, which is exactly why this is 10 entries rather than 12: `ic08` (256 native) and
/// `ic13` (128@2x) both render "full" artwork at 256 pixels; the two are not merged into one because
/// each has to be written under its own OSType regardless of whether the bytes happen to match.
export const ICNS_SLOTS = [
  { type: "icp4", base: 16, scale: 1, px: 16 },
  { type: "ic11", base: 16, scale: 2, px: 32 },
  { type: "icp5", base: 32, scale: 1, px: 32 },
  { type: "ic12", base: 32, scale: 2, px: 64 },
  { type: "ic07", base: 128, scale: 1, px: 128 },
  { type: "ic13", base: 128, scale: 2, px: 256 },
  { type: "ic08", base: 256, scale: 1, px: 256 },
  { type: "ic14", base: 256, scale: 2, px: 512 },
  { type: "ic09", base: 512, scale: 1, px: 512 },
  { type: "ic10", base: 512, scale: 2, px: 1024 },
];

/// Packs PNG-format images into a Windows `.ico`.
///
/// The format: a 6-byte header, one 16-byte directory entry per image, then the raw PNG bytes back
/// to back. PNG entries (rather than the legacy uncompressed DIB format) have been supported since
/// Vista and are required for a 256px entry regardless, since a byte cannot hold 256 - the format's
/// own directory field is one reason a 256×256 classic BMP frame was never possible.
export function packIco(images) {
  if (images.length === 0) throw new Error("packIco: at least one image is required");

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directorySize = 16 * images.length;
  let offset = 6 + directorySize;
  const directory = Buffer.alloc(directorySize);

  images.forEach(({ size, png }, index) => {
    const at = index * 16;
    // 0 stands for 256: the field is a single byte, and 256 does not fit in one.
    const byteSize = size === 256 ? 0 : size;
    directory.writeUInt8(byteSize, at); // width
    directory.writeUInt8(byteSize, at + 1); // height
    directory.writeUInt8(0, at + 2); // palette colours: none
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

/// The OSType codes this packer accepts, taken from `ICNS_SLOTS` so there is exactly one place that
/// says which codes are real.
const KNOWN_ICNS_TYPES = new Set(ICNS_SLOTS.map((slot) => slot.type));

/// Packs PNG-format images into a macOS `.icns`.
///
/// The format: a magic header naming the whole file's length, then a TLV chunk per image - a
/// four-character OSType, the chunk's own length (including its 8-byte header), then the PNG bytes.
/// There is no field naming a chunk's pixel size; the OSType code IS the size, from a fixed table -
/// which is the entire reason `ICNS_SLOTS` exists as a single shared source for it.
export function packIcns(images) {
  if (images.length === 0) throw new Error("packIcns: at least one image is required");

  const chunks = images.map(({ type, png }) => {
    if (!KNOWN_ICNS_TYPES.has(type)) throw new Error(`packIcns: unrecognised OSType "${type}"`);

    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    return chunk;
  });

  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(totalLength, 4);

  return Buffer.concat([header, ...chunks]);
}
