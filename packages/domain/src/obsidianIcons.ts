import { z } from "zod";

/// The icons an Obsidian vault has had assigned with the Iconic plugin.
///
/// Obsidian itself has no folder icons. Iconic is a community plugin, so this file is another
/// application's private format: it is read, never written, and everything about it is untrusted.
/// Anything unexpected - a missing file, invalid JSON, a shape the schema refuses, a plugin version
/// that has moved on - means no icons and no message. They are decoration, and an error about
/// another application's data directory is noise the user cannot act on.

export const OBSIDIAN_ICONS_FILE = ".obsidian/plugins/iconic/data.json";

/// The map crosses IPC whenever a workspace opens, so it is bounded. A file claiming more icons than
/// a vault could plausibly hold is a file this parser has misread, and none of it is then trusted.
export const ICON_LIMIT = 2000;

export interface IconAssignment {
  /// Either a Lucide id of the form `lucide-<kebab-name>` or a literal emoji.
  icon: string;
  /// A colour the user chose: one of Iconic's nine tone names, a CSS colour name, a hex value, or an
  /// `rgb(...)` built from its object form. Null when there is none, or none that is plainly a colour.
  colour: string | null;
}

export type IconMap = Readonly<Record<string, IconAssignment>>;

export const NO_ICONS: IconMap = Object.freeze({});

const Rgb = z.object({ r: z.number(), g: z.number(), b: z.number() });

/// Loose on purpose. Iconic will gain fields, and a schema that refused an unknown one would make a
/// plugin update look like every icon being deleted.
const Entry = z.looseObject({
  icon: z.string().nullish(),
  color: z.union([z.string(), Rgb]).nullish(),
});

const IconicData = z.looseObject({ fileIcons: z.record(z.string(), Entry) });

/// A colour this app is willing to put in a style attribute.
///
/// A hex value, or a bare word - which covers Iconic's nine tone names and the 149 CSS colour names
/// alike, and is answered in `iconTone`. Everything else is dropped: the value is written by another
/// application into an attribute the browser parses, and a narrow allow-list is cheaper to be sure
/// about than a list of things to forbid.
const PLAIN_COLOUR = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]+)$/;

function colourOf(raw: unknown): string | null {
  if (typeof raw === "string") return PLAIN_COLOUR.test(raw) ? raw : null;
  const rgb = Rgb.safeParse(raw);
  if (!rgb.success) return null;
  const { r, g, b } = rgb.data;
  const whole = [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  return whole ? `rgb(${r}, ${g}, ${b})` : null;
}

export function parseObsidianIcons(raw: unknown): IconMap {
  const parsed = IconicData.safeParse(raw);
  if (!parsed.success) return NO_ICONS;

  const entries = Object.entries(parsed.data.fileIcons);
  if (entries.length > ICON_LIMIT) return NO_ICONS;

  const map: Record<string, IconAssignment> = {};
  for (const [path, entry] of entries) {
    if (path === "" || typeof entry.icon !== "string" || entry.icon === "") continue;
    map[path] = { icon: entry.icon, colour: colourOf(entry.color) };
  }
  return map;
}

/// The assignment for one workspace-relative path, or null.
///
/// Iconic keys folders by their path with no extension and files by their path with one, which is
/// exactly how this app names them too, so no translation is needed - only the workspace id has to
/// be off the front, which is the caller's job.
export function iconFor(map: IconMap, path: string): IconAssignment | null {
  return Object.prototype.hasOwnProperty.call(map, path) ? (map[path] ?? null) : null;
}
