/// Deciding whether a published release is worth offering.
///
/// Pure, and in the domain, because both update paths need the same answer: electron-updater on
/// Windows and the hand-rolled GitHub check on macOS, where an unsigned build cannot update itself.

/// One asset attached to a release - an installer, a disk image, an updater feed file.
export interface PublishedAsset {
  name: string;
  browser_download_url: string;
}

/// One release, as GitHub reports it. Only the fields the decision depends on.
export interface PublishedRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  /// Optional: a release GitHub returns mid-upload, or an older test fixture, may carry none. Read
  /// as an empty list rather than required, so "nothing to offer yet" is not a crash.
  assets?: PublishedAsset[];
}

export interface AvailableUpdate {
  version: string;
  url: string;
  /// Carried forward so the caller can find the file worth downloading automatically, rather than
  /// sending the user to the releases page to find and click it themselves.
  assets: { name: string; url: string }[];
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

    best = {
      version,
      url: release.html_url,
      assets: (release.assets ?? []).map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
      })),
    };
  }

  return best;
}

/// The exact asset name each platform's build produces, mirroring `electron-builder.config.cjs`'s
/// `artifactName` templates. An exact match, not "ends with .exe" or "ends with .dmg" - both
/// installers ship a same-extension `.blockmap` sidecar beside them, and matching on the extension
/// alone would just as happily hand the user that instead of the thing they can run.
///
/// Linux publishes nothing yet, so it always answers null - which is the same "nothing found"
/// answer a version that has not been built for yet, or an asset list still uploading, gives. All
/// three fall back to the same place: the releases page, which is honest about what is actually
/// there.
function expectedAssetName(platform: string, version: string): string | null {
  if (platform === "win32") return `Trypthos-Setup-${version}.exe`;
  if (platform === "darwin") return `Trypthos-${version}-arm64.dmg`;
  return null;
}

/// The asset to download for this platform's installer, or null if there is none - a release still
/// uploading, a version this platform has never had a build for, or a platform nothing is published
/// for at all.
///
/// Returns the name alongside the URL so a caller writing the download to disk does not have to
/// re-derive the filename by a second route - there is exactly one place that knows what a build's
/// artifact is called, and this is it.
export function downloadAssetFor(
  assets: readonly { name: string; url: string }[],
  platform: string,
  version: string,
): { name: string; url: string } | null {
  const expected = expectedAssetName(platform, version);
  if (expected === null) return null;

  return assets.find((asset) => asset.name === expected) ?? null;
}
