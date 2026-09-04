import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { TRAY_ICO_SIZES, packIco, trayTemplateSvg, windowsIconSvg } from "./iconAssets.mjs";

/// Writes the tray icons - the app icon's own artwork, so the notification area shows the same
/// tile as the taskbar, Start menu and Dock rather than a glyph drawn separately to resemble it.
///
///   tray.ico            Windows: every notification-area size in one file, picked by the shell
///   trayTemplate.png    macOS menu bar at 1x, white-on-transparent, recoloured by the system
///   trayTemplate@2x.png the same at 2x, which Electron finds by the suffix
///   tray.png            everywhere else
///
/// Rasterized by `sharp` like the app icon, for the same reason: the artwork has arcs and a mask,
/// which are easy to get subtly wrong by hand. The artwork and the .ico packer are hand-written and
/// tested in `iconAssets.mjs`.

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(out, { recursive: true });

const rasterize = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

const icoImages = await Promise.all(
  TRAY_ICO_SIZES.map(async (size) => ({ size, png: await rasterize(windowsIconSvg(size)) })),
);
writeFileSync(join(out, "tray.ico"), packIco(icoImages));
// The 16-point artwork at both densities: the menu bar is a 16-point slot, and at 2x it wants the
// same small design drawn with twice the pixels, not the 32px design.
writeFileSync(join(out, "trayTemplate.png"), await rasterize(trayTemplateSvg(16)));
writeFileSync(join(out, "trayTemplate@2x.png"), await rasterize(trayTemplateSvg(16, 32)));
writeFileSync(join(out, "tray.png"), await rasterize(windowsIconSvg(32)));
console.log(`wrote tray.ico, trayTemplate.png, trayTemplate@2x.png and tray.png to ${out}`);
