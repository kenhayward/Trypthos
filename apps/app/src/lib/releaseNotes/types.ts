export interface Release {
  /// Must match /version.json for RECENT[0]. Asserted by releases.test.ts.
  version: string;
  /// ISO date, YYYY-MM-DD.
  date: string;
  /// The GitHub PR that shipped it.
  pr: number;
  headline: string;
  /// PR-level prose: enough for a user to understand the impact without reading the bullets.
  summary: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

/// A named span of releases. An epoch is a chapter heading over an intact archive, never a rewrite
/// of it - the drill-down lists every release in the span verbatim.
export interface Epoch {
  id: string;
  title: string;
  /// Inclusive version bounds.
  from: string;
  to: string;
  summary: string;
}

/// Version and date for one archived release. The spine exists so the summary page can derive counts
/// and date spans without importing the archive itself.
export interface SpineEntry {
  version: string;
  date: string;
}
