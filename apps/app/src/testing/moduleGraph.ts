import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./stripComments";

/// Walking the renderer's source to ask what imports what.
///
/// Shared by the bundle guards, which all ask the same question about different libraries: is this
/// reached eagerly by anything that is not allowed to reach it eagerly? Two copies of the import
/// pattern would eventually disagree, and the one that was wrong would be the one that silently
/// stopped catching anything.

/// Every way a module can be pulled in at load time, and no way it cannot.
///
/// Three branches, because a static import wears three faces: `import x from "y"`, the side-effect
/// `import "y"`, and the re-export `export * from "y"` - which loads the module just as eagerly
/// while looking nothing like an import. `import type` and `export type` are excluded: they vanish
/// at compile time and cost the bundle nothing. `import("y")` has no leading `import` keyword at the
/// start of a line and so cannot match, which is the whole point.
export const STATIC_LOAD = String.raw`(?:import\s+(?!type\b)[^;]*?from\s+|import\s+|export\s+(?!type\b)[^;]*?from\s+)`;

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/// Every source file under `root` that matches `pattern` and is not one of the modules allowed to.
export function offenders(root: string, pattern: RegExp, allowed: ReadonlySet<string>): string[] {
  return sourceFiles(root)
    .map((file) => ({
      file: relative(root, file).split(sep).join("/"),
      text: stripComments(readFileSync(file, "utf8")),
    }))
    .filter(({ file, text }) => pattern.test(text) && !allowed.has(file))
    .map(({ file }) => file);
}
