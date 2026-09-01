import { describe, expect, it } from "vitest";
import { ARCHIVE } from "./archive";
import { ARCHIVED_SPINE, EPOCHS, OPEN_EPOCH_ID } from "./epochs";
import { isWithinEpoch } from "./epochSpan";

describe("EPOCHS", () => {
  it("never claims the reserved id for the open span", () => {
    expect(EPOCHS.map((epoch) => epoch.id)).not.toContain(OPEN_EPOCH_ID);
  });

  it("has unique ids", () => {
    const ids = EPOCHS.map((epoch) => epoch.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Asserted as ONE equality over the whole archive, on purpose. Per-epoch checks are the trap:
  // every epoch can be well-formed while the set as a whole leaves a hole, and a release falling
  // between two epochs is simply never listed - no 404, no error, just missing.
  it("tiles the archive exactly: every archived release in exactly one epoch", () => {
    const coverage = ARCHIVE.map((release) => ({
      version: release.version,
      epochs: EPOCHS.filter((epoch) => isWithinEpoch(release.version, epoch)).map((e) => e.id),
    }));

    const expected = ARCHIVE.map((release) => ({ version: release.version, count: 1 }));
    const actual = coverage.map((entry) => ({ version: entry.version, count: entry.epochs.length }));

    expect(actual).toEqual(expected);
  });
});

describe("ARCHIVED_SPINE", () => {
  // The spine lets the summary page derive counts and date spans without loading the archive, which
  // only works while it is an exact mirror - same entries, same order.
  it("mirrors ARCHIVE exactly, in the same order", () => {
    expect(ARCHIVED_SPINE).toEqual(
      ARCHIVE.map((release) => ({ version: release.version, date: release.date })),
    );
  });
});
