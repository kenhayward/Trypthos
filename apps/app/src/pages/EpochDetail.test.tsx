import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EPOCHS } from "../lib/releaseNotes";
import { ARCHIVE } from "../lib/releaseNotes/archive";
import { isWithinEpoch } from "../lib/releaseNotes/epochSpan";
import EpochDetail from "./EpochDetail";

/// The chapter drill-down.
///
/// A chapter is a heading over an intact archive, so the thing to assert is that it lists the span
/// EXACTLY: nothing merged, nothing condensed, nothing dropped, and nothing from the chapter next to
/// it. Run against the real archive, since that is the file this exists to show.

const epoch = EPOCHS[0]!;
const within = ARCHIVE.filter((release) => isWithinEpoch(release.version, epoch));
const outside = ARCHIVE.filter((release) => !isWithinEpoch(release.version, epoch));

describe("EpochDetail", () => {
  it("lists every release in the chapter", () => {
    render(<EpochDetail epoch={epoch} />);

    expect(within.length).toBeGreaterThan(0);
    for (const release of within) {
      expect(screen.getByText(release.headline)).toBeDefined();
    }
  });

  it("lists them verbatim, summary and bullets alike", () => {
    render(<EpochDetail epoch={epoch} />);

    const first = within[0]!;
    expect(screen.getByText(first.summary)).toBeDefined();
    for (const item of [...(first.added ?? []), ...(first.changed ?? []), ...(first.fixed ?? [])]) {
      expect(screen.getByText(item)).toBeDefined();
    }
  });

  // The epochs tile the archive, so a release outside this span belongs to another chapter. One
  // appearing here would be one listed twice in the app, from two different headings.
  it("lists nothing from any other chapter", () => {
    render(<EpochDetail epoch={epoch} />);

    expect(outside.length).toBeGreaterThan(0);
    for (const release of outside) {
      expect(screen.queryByText(release.headline)).toBeNull();
    }
  });

  it("draws one card per release", () => {
    render(<EpochDetail epoch={epoch} />);
    expect(screen.getAllByRole("article")).toHaveLength(within.length);
  });
});
