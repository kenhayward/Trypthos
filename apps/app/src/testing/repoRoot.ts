import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/// Finds the repository root by walking up for /version.json.
///
/// Deliberately not derived from import.meta.url: under vitest that is not always a file:// URL, and
/// not from a fixed number of "../" hops either, since those break the moment a file moves. The
/// canonical version file is the marker because its location is what defines the root.
export function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "version.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not find version.json above " + process.cwd());
    dir = parent;
  }
}

export function repoPath(...segments: string[]): string {
  return join(repoRoot(), ...segments);
}
