import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { draw, png } from "./trayIconAssets.mjs";

/// Writes the tray icons. The artwork and the PNG encoder live in `trayIconAssets.mjs`, pure and
/// testable without touching disk - this is just the two calls that write their output.

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "tray.png"), png(draw({ mono: false })));
writeFileSync(join(out, "trayTemplate.png"), png(draw({ mono: true })));
console.log(`wrote tray.png and trayTemplate.png to ${out}`);
