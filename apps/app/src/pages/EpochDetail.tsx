import type { Epoch } from "../lib/releaseNotes";
import { isWithinEpoch } from "../lib/releaseNotes/epochSpan";
import { ARCHIVE } from "../lib/releaseNotes/archive";
import ReleaseList from "./ReleaseList";

/// One chapter, listing every release in it.
///
/// **The only module in the app that may import the archive**, which grows without bound - see
/// `bundleBoundary.test.ts`, which asserts that by name. It is reached through a lazy import from
/// `ReleaseNotes`, so the whole history is fetched when somebody opens a chapter and never before.
///
/// The span is filtered here rather than stored on the epoch, for the same reason its count is
/// derived: a stored list is a second copy of the archive that agrees with it only by luck.
export default function EpochDetail({ epoch }: { epoch: Epoch }) {
  const releases = ARCHIVE.filter((release) => isWithinEpoch(release.version, epoch));

  return <ReleaseList releases={releases} />;
}
