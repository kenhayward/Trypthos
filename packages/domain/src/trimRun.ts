/// Removing a run of characters from the end of a string, in linear time.
///
/// The obvious regular expression - `/\/+$/`, `/\s*$/` - is quadratic on a string holding a long run
/// of that character anywhere but the end: the engine starts a match at every position in the run,
/// walks to its end, finds no `$`, and starts again one character later. The strings these patterns
/// meet are a user's notes, a model's replies and pasted URLs, so a line of a few thousand spaces is
/// enough to stall the app. A loop from the end reads each character once.

export function trimTrailing(value: string, characters: string): string {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

export function trimLeading(value: string, characters: string): string {
  let start = 0;
  while (start < value.length && characters.includes(value[start]!)) start += 1;
  return value.slice(start);
}

/// An ATX heading's title without its closing sequence: `Plan ##` is `Plan`.
///
/// Whitespace, then hashes, then whitespace, taken off the end - what `/\s*#*\s*$/` meant, and which
/// took seconds on a heading line of two thousand spaces.
export function withoutClosingHashes(title: string): string {
  return trimTrailing(title.trimEnd(), "#").trim();
}
