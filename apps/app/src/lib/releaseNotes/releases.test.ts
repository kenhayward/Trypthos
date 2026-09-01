import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "../../testing/repoRoot";
import { RECENT } from "./current";
import { compareVersions } from "./epochSpan";

const canonical = JSON.parse(readFileSync(repoPath("version.json"), "utf8")) as { version: string };

describe("RECENT", () => {
  it("leads with the version in /version.json", () => {
    expect(RECENT[0]?.version).toBe(canonical.version);
  });

  it("is ordered newest first", () => {
    for (let i = 1; i < RECENT.length; i += 1) {
      expect(compareVersions(RECENT[i - 1]!.version, RECENT[i]!.version)).toBeGreaterThan(0);
    }
  });

  it("has no duplicate versions", () => {
    const versions = RECENT.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("gives every release a date, a PR number, a headline and a summary", () => {
    for (const release of RECENT) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.pr).toBeGreaterThan(0);
      expect(release.headline.length).toBeGreaterThan(0);
      expect(release.summary.length).toBeGreaterThan(0);
    }
  });

  // A safety net, not the trigger. Epochs close when an arc of work finishes, which is a judgement
  // about narrative - ask, do not close one because a counter tripped.
  it("stays under the size at which an epoch is overdue", () => {
    expect(RECENT.length).toBeLessThanOrEqual(80);
  });
});
