/// Deciding whether a published release is worth offering.
///
/// Pure, and in the domain, because both update paths need the same answer: electron-updater on
/// Windows and the hand-rolled GitHub check on macOS, where an unsigned build cannot update itself.

/// One release, as GitHub reports it. Only the fields the decision depends on.
export interface PublishedRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
}

export interface AvailableUpdate {
  version: string;
  url: string;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/// The version a release tag names, or null if the tag is not one of ours.
///
/// Strict on purpose. A tag like `nightly` or `v2-beta` is not a version, and letting one through
/// would have it compared as though it were - most likely as `0.0.0`, which compares as older than
/// everything and is silently ignored, or worse, as newer.
export function parseReleaseTag(tag: string): string | null {
  const match = VERSION.exec(tag.trim());
  if (match === null) return null;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function parts(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (match === null) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/// Whether `candidate` is a later version than `current`.
///
/// Numeric, part by part. The trap a string comparison falls into is real and reachable here:
/// "0.10.0" sorts BEFORE "0.9.0" as text, so a user on 0.9.0 would be told 0.10.0 was older and
/// never offered it - and the bug only appears once the minor version reaches double figures.
export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parts(current);
  const b = parts(candidate);
  for (let i = 0; i < 3; i += 1) {
    if (b[i]! > a[i]!) return true;
    if (b[i]! < a[i]!) return false;
  }
  return false;
}

/// The newest published release worth offering, or null.
///
/// The HIGHEST newer version, not the first newer one encountered. GitHub happens to return newest
/// first, but nothing guarantees it, and picking the first would offer an upgrade to a version that
/// has already been superseded.
///
/// Drafts and prereleases are excluded: a draft is not published, and a prerelease was not asked for
/// by anyone running a stable build.
export function pickUpdate(
  releases: readonly PublishedRelease[],
  current: string,
): AvailableUpdate | null {
  let best: AvailableUpdate | null = null;

  for (const release of releases) {
    if (release.draft || release.prerelease) continue;

    const version = parseReleaseTag(release.tag_name);
    if (version === null) continue;
    if (!isNewerVersion(current, version)) continue;
    if (best !== null && !isNewerVersion(best.version, version)) continue;

    best = { version, url: release.html_url };
  }

  return best;
}
