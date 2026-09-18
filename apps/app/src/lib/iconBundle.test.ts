import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { offenders, STATIC_LOAD } from "../testing/moduleGraph";

/// Lucide's icon set stays out of the initial bundle.
///
/// It is 1,848 icons and 417KB minified, wanted only by a vault that has actually assigned icons.
/// Nothing but who imports what enforces that: a static import of the JSON type-checks, renders and
/// passes every other test while putting the whole set on every page load. So `lucideIcons.ts` is
/// the only module allowed to name it, and it reaches it through `import(...)`.

const SRC = repoPath("apps", "app", "src");

const ICON_ONLY = new Set(["lib/lucideIcons.ts"]);

const LUCIDE_IMPORT = new RegExp(`^\\s*${STATIC_LOAD}["']lucide-static(?:\\/[^"']*)?["']`, "m");

describe("the Lucide set stays out of the initial bundle", () => {
  it("is named only by the module that loads it lazily", () => {
    expect(offenders(SRC, LUCIDE_IMPORT, ICON_ONLY)).toEqual([]);
  });

  it("would catch a static import if one appeared", () => {
    expect(LUCIDE_IMPORT.test('import nodes from "lucide-static/icon-nodes.json";')).toBe(true);
    expect(LUCIDE_IMPORT.test('import "lucide-static";')).toBe(true);
    expect(LUCIDE_IMPORT.test('export * from "lucide-static";')).toBe(true);
    expect(LUCIDE_IMPORT.test('import type { IconNode } from "lucide-static";')).toBe(false);
    expect(LUCIDE_IMPORT.test('const icons = await import("lucide-static/icon-nodes.json");')).toBe(false);
  });
});
