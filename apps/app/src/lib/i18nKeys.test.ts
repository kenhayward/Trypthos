import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import en from "../locales/en.json";

/// Every key a component asks for must exist in the catalogue.
///
/// i18next answers a missing key by returning the key itself, so the failure renders as
/// `workspace.openFolder` sitting in the interface where a label should be. It breaks no test, throws
/// nothing, and is easy to skim past in review - especially for a string that only appears in an
/// error state nobody triggers.
///
/// The reverse direction is checked too. An orphaned key is harmless on screen, but it is the residue
/// of a deleted component, and a catalogue full of them stops being a reliable inventory of what the
/// app actually says.

const SRC = repoPath("apps", "app", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const CATALOGUE = new Set(flatten(en));

/// Matches t("key") and t("key", { ... }). Template literals and computed keys are deliberately not
/// matched - if one appears, it needs adding to the exemptions below with a reason, because a key
/// this test cannot see is a key it cannot protect.
const T_CALL = /\bt\(\s*"([a-zA-Z][\w.]*)"/g;

/// Keys built at runtime, listed by the prefix they are built from.
///
/// Each entry is a promise that something iterates the set - the editor modes, the failure reasons,
/// the themes - so the guard cannot see the individual `t()` call. Adding a prefix here is how a key
/// stops being protected, so it wants a reason each time.
const DYNAMIC_PREFIXES = [
  "editor.mode.",
  "editor.modeHint.",
  "errors.",
  // Built from THEME_PREFERENCES as the settings dialog renders its options.
  "settings.theme.",
  "settings.themeHint.",
  // Built from SETTINGS_SECTIONS as the settings rail draws its items, so the rail and the routing
  // read one list rather than two.
  "settings.section.",
  // Built from MENU_NAMES as the title bar draws the menu bar. The names live in the domain because
  // the shell reads them too, so the set is iterated rather than written out.
  "menu.",
];

function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(T_CALL)) {
      const key = match[1]!;
      const where = relative(SRC, file).split(sep).join("/");
      used.set(key, [...(used.get(key) ?? []), where]);
    }
  }
  return used;
}

describe("translation keys", () => {
  it("every key a component asks for exists in the catalogue", () => {
    const missing = [...usedKeys().entries()]
      .filter(([key]) => !CATALOGUE.has(key))
      .map(([key, files]) => `${key} (${files.join(", ")})`);

    expect(missing).toEqual([]);
  });

  it("has no orphaned keys", () => {
    const used = new Set(usedKeys().keys());
    const orphans = [...CATALOGUE].filter(
      (key) => !used.has(key) && !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );

    expect(orphans).toEqual([]);
  });

  it("uses named interpolation, never positional", () => {
    // i18next has no positional placeholders; a stray {0} renders literally.
    const values = JSON.stringify(en);
    expect(values).not.toMatch(/\{\{\s*\d+\s*\}\}/);
  });
});
