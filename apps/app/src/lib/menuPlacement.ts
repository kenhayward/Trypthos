/// Where a right-click menu goes so that all of it is in the window.
///
/// Pure, so the rule is tested over numbers; the menu measures itself and asks. It behaves as a
/// native menu does: the corner stays on the pointer and the menu opens the other way when there is
/// no room, and only when neither way fits is it pushed against the window's edge.

interface Size {
  width: number;
  height: number;
}

/// One axis: from `at`, forwards by `length` unless that overruns `limit`, then backwards, then
/// whatever keeps it inside.
function along(at: number, length: number, limit: number, backwards: boolean): number {
  const forward = at;
  const backward = at - length;
  const fitsForward = forward + length <= limit;
  const fitsBackward = backward >= 0;

  if (backwards ? fitsBackward : !fitsForward && fitsBackward) return backward;
  if (fitsForward) return forward;
  return Math.max(0, Math.min(backwards ? backward : forward, limit - length));
}

export function placeMenu({
  x,
  y,
  size,
  viewport,
  above = false,
}: {
  x: number;
  y: number;
  size: Size;
  viewport: Size;
  /// Prefer up and left of the pointer - for a menu opened from the status bar.
  above?: boolean;
}): { left: number; top: number } {
  return {
    left: along(x, size.width, viewport.width, above),
    top: along(y, size.height, viewport.height, above),
  };
}
