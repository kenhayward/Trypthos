import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "../testing/repoRoot";

/// /version.json is canonical. Every other copy is a mirror and must be bumped in lockstep.
///
/// This test exists because mirrors drift silently: nothing at runtime reads a lock file, so a stale
/// version there breaks nothing until an unrelated `npm install` rewrites it and turns a dependency
/// bump into a surprise version diff. In the project this pattern came from, two lock files sat
/// sixty releases behind because the guard covered only one of them.
///
/// When a new package joins the workspace, add it here in the same PR.

const readJson = (...segments: string[]): Record<string, unknown> =>
  JSON.parse(readFileSync(repoPath(...segments), "utf8")) as Record<string, unknown>;

const canonical = (readJson("version.json") as { version: string }).version;

const MANIFESTS = [
  "package.json",
  "apps/app/package.json",
  "apps/desktop/package.json",
  "packages/domain/package.json",
];

/// npm workspaces keep one lock file, but it carries the version of every workspace package as well
/// as its own - so each of these is a separate way to drift.
const LOCK_ENTRIES = ["", "apps/app", "apps/desktop", "packages/domain"];

describe("version mirrors", () => {
  it("uses a Major.Minor.Build version", () => {
    expect(canonical).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(MANIFESTS)("matches %s", (manifest: string) => {
    expect(readJson(...manifest.split("/"))["version"]).toBe(canonical);
  });

  it("matches the top level of package-lock.json", () => {
    expect(readJson("package-lock.json")["version"]).toBe(canonical);
  });

  it.each(LOCK_ENTRIES)("matches package-lock.json packages[%o]", (key: string) => {
    const lock = readJson("package-lock.json") as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages[key]?.version).toBe(canonical);
  });
});
