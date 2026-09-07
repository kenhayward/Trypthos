export type FindStep = "next" | "previous";

/// Which match Next or Previous lands on.
///
/// Wraps at both ends, because that is what every editor's find does and a Next that goes dead at
/// the last match makes somebody scroll back to the top by hand.
///
/// `-1` means a search has run and the reader is not on any of its results yet: Next goes to the
/// first and Previous to the last, which is what those two words mean from nowhere. An index the
/// list no longer has - a second search that found fewer - is brought back into range rather than
/// walked off the end of.
export function stepIndex(count: number, current: number, step: FindStep): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return step === "next" ? 0 : count - 1;
  return step === "next" ? (current + 1) % count : (current - 1 + count) % count;
}
