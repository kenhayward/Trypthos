import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";
import { stripComments } from "../testing/stripComments";

/// User-facing text uses a plain hyphen. Feedback on em and en dashes is negative.
///
/// Code, comments and internal docs are exempt - which is why comments are stripped before the scan.
/// Enforced by a test rather than by discipline because these arrive invisibly: pasted from a
/// document, or produced by a tool that "improves" punctuation.

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

const SURFACES = [repoPath("apps", "app", "src")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("user-facing text", () => {
  it("uses plain hyphens, never em or en dashes", () => {
    const offences: string[] = [];

    for (const surface of SURFACES) {
      for (const file of sourceFiles(surface)) {
        const stripped = stripComments(readFileSync(file, "utf8"));
        stripped.split("\n").forEach((line, index) => {
          if (line.includes(EM_DASH) || line.includes(EN_DASH)) {
            offences.push(`${relative(repoPath(), file).split(sep).join("/")}:${index + 1}`);
          }
        });
      }
    }

    expect(offences).toEqual([]);
  });
});
