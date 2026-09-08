import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../../testing/repoRoot";
import { stripComments } from "../../testing/stripComments";

const SRC = repoPath("apps", "app", "src");

/// Only these modules may import the archive. Everything else reaching it puts the entire release
/// history - which grows without bound - into the initial bundle.
///
/// Asserted against the module graph itself because nothing else would catch it: adding
/// `import { ARCHIVE } from "./archive"` to an eager module type-checks, renders correctly, and
/// passes every other test in the suite.
const ALLOWED_ARCHIVE_IMPORTERS = [
  "lib/releaseNotes/archive.ts",
  "lib/releaseNotes/epochs.test.ts",
  "lib/releaseNotes/bundleBoundary.test.ts",
  "pages/EpochDetail.tsx",
  "pages/EpochDetail.test.tsx",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const toPosix = (value: string): string => value.split(sep).join("/");

describe("release notes bundle boundary", () => {
  it("is imported only by the modules allowed to hold the whole history", () => {
    // Any specifier that ENDS in the archive module, not only a sibling `./archive`: the pages that
    // may load it are two directories away and reach it as `../lib/releaseNotes/archive`, which the
    // narrower pattern read straight past. A guard that cannot see the one real importer is a guard
    // that passes for the wrong reason.
    const importsArchive = /from\s+["'][^"']*archive["']/;

    const offenders = sourceFiles(SRC)
      .filter((file) => importsArchive.test(readFileSync(file, "utf8")))
      .map((file) => toPosix(relative(SRC, file)))
      .filter((file) => !ALLOWED_ARCHIVE_IMPORTERS.includes(file));

    expect(offenders).toEqual([]);
  });

  /// The release notes as a whole - not just the archive - stay out of what loads with the app.
  ///
  /// `RECENT` is the smaller half of the same history and grows with every PR, so the window that
  /// shows it is reached through `lazy(() => import(...))` and nothing else. A static import of it
  /// from any eager module would put the notes on every page load, and would look completely
  /// correct doing it.
  it("is reached only through a lazy import, so nothing eager pulls the history in", () => {
    const staticImport = /from\s+["'][^"']*(?:releaseNotes|ReleaseNotes|EpochDetail|ReleaseList)["']/;
    // The guard's own guard: a regex that matched nothing would pass this test by finding no work,
    // which is the one way a check like this fails silently.
    expect(staticImport.test('import { RECENT } from "./lib/releaseNotes";')).toBe(true);

    const offenders = sourceFiles(SRC)
      .filter((file) => staticImport.test(readFileSync(file, "utf8")))
      .map((file) => toPosix(relative(SRC, file)))
      .filter(
        (file) => !file.startsWith("pages/") && !file.startsWith("lib/releaseNotes/"),
      );

    expect(offenders).toEqual([]);
  });

  it("is not re-exported from the barrel", () => {
    // Comments stripped first: the barrel documents this very rule, and the explanation reads
    // exactly like a violation of it.
    const barrel = stripComments(
      readFileSync(join(SRC, "lib", "releaseNotes", "index.ts"), "utf8"),
    );
    // Targets the module and the binding by name, not the substring: ARCHIVED_SPINE contains
    // "ARCHIVE" and belongs here - it is precisely what lets the summary page derive counts and
    // date spans WITHOUT loading the archive.
    expect(barrel).not.toMatch(/from\s+["'][^"']*archive["']/i);
    expect(barrel).not.toMatch(/\bARCHIVE\b/);
  });
});
