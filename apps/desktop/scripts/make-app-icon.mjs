import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ICNS_SLOTS,
  WINDOWS_ICO_SIZES,
  macIconSvg,
  packIco,
  packIcns,
  windowsIconSvg,
} from "./iconAssets.mjs";

/// Generates the packaged app icon: `icon.ico` for Windows, `icon.icns` for macOS, and `icon.png`
/// for Linux/AppImage.
///
/// Sibling to `make-tray-icon.mjs` and following the same "drawn in code, not committed as a binary"
/// convention - regenerable when the mark changes, and the source of truth is this file rather than
/// an opaque asset nobody can diff. It differs from that script in one respect: the tray glyph is a
/// flat silhouette simple enough to rasterize by hand with a scanline renderer, but this icon has a
/// diagonal gradient, rounded-rect arcs and a soft shadow - rendering those correctly by hand is easy
/// to get subtly wrong and hard to notice, so `sharp` does the actual rasterizing. The artwork itself
/// (`iconAssets.mjs`) and the two binary containers stay hand-written and tested, since those have an
/// objectively right answer.
///
/// Source design: `Trypthos-Windows-Icon.dc.html`, a Claude Design handoff. High-fidelity - colors
/// and coordinates here are taken from it directly.

/// The SVG already carries its own width/height (set by `windowsIconSvg`/`macIconSvg`), so sharp
/// rasterizes at exactly the size the artwork was built for - no separate resize step, and no risk
/// of a resize silently disagreeing with what the string says.
async function rasterize(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildIco() {
  const images = await Promise.all(
    WINDOWS_ICO_SIZES.map(async (size) => ({
      size,
      png: await rasterize(windowsIconSvg(size)),
    })),
  );
  return packIco(images);
}

async function buildIcns() {
  // Rendered once per distinct base size, not once per OSType slot: `ic08` (256 native) and `ic13`
  // (128@2x) both want "full" artwork rendered at 256 pixels, and rendering it twice would be
  // wasted work for bytes that come out identical either way.
  const rendered = new Map();
  const at = async (base, px) => {
    const key = `${base}:${px}`;
    if (!rendered.has(key)) rendered.set(key, await rasterize(macIconSvg(base, px)));
    return rendered.get(key);
  };

  const images = await Promise.all(
    ICNS_SLOTS.map(async (slot) => ({ type: slot.type, png: await at(slot.base, slot.px) })),
  );
  return packIcns(images);
}

async function buildLinuxPng() {
  // Windows geometry, not the macOS float: Linux desktop environments follow Fluent/GNOME-style
  // square tiles more often than Apple's inset placement. 512px is large enough for every context
  // AppImage integration actually uses (application menus, .desktop file previews).
  return rasterize(windowsIconSvg(256, 512));
}

async function main() {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
  mkdirSync(out, { recursive: true });

  const [ico, icns, png] = await Promise.all([buildIco(), buildIcns(), buildLinuxPng()]);

  writeFileSync(join(out, "icon.ico"), ico);
  writeFileSync(join(out, "icon.icns"), icns);
  writeFileSync(join(out, "icon.png"), png);

  console.log(`wrote icon.ico, icon.icns and icon.png to ${out}`);
}

await main();
