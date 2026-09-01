import type { Epoch, SpineEntry } from "./types";

/// Compares Major.Minor.Build. Returns <0, 0 or >0.
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isWithinEpoch(version: string, epoch: Epoch): boolean {
  return compareVersions(version, epoch.from) >= 0 && compareVersions(version, epoch.to) <= 0;
}

export interface EpochSpan {
  releaseCount: number;
  /// Oldest and newest dates in the span, or null when the epoch covers nothing.
  firstDate: string | null;
  lastDate: string | null;
}

/// Derives an epoch's size and date range from the spine.
///
/// Derived, never stored on the Epoch itself: a stored count is a second derivation that agrees with
/// the archive only by luck, and disagrees silently the first time an entry moves.
export function epochSpan(epoch: Epoch, spine: readonly SpineEntry[]): EpochSpan {
  const entries = spine.filter((entry) => isWithinEpoch(entry.version, epoch));
  if (entries.length === 0) return { releaseCount: 0, firstDate: null, lastDate: null };

  const dates = entries.map((entry) => entry.date).sort();
  return {
    releaseCount: entries.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
