export type ZoomDirection = "in" | "out";

/// The rungs a zoom gesture steps between.
///
/// A ladder rather than a multiplier, and the reason is 1: stepping out of a zoom has to land back
/// on exactly 100%, or the only way back to the size a document opened at is to close the tab. A
/// factor of 1.1 per notch drifts past it and never returns.
///
/// One ladder for text and pictures alike. The two scale different things - a font size and an
/// image's pixels - but "how far in am I" is the same question, and two ranges would mean a
/// document that zooms further than the screenshot beside it for no reason a user could name.
export const ZOOM_LEVELS: readonly number[] = [
  0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

/// The ends of the ladder, named so `nextZoom` has somewhere to stop that does not depend on
/// indexing an array the type system will not promise is populated. Tested against the ladder, so
/// the two cannot drift apart.
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

/// What a document opens at: its own size.
export const DEFAULT_ZOOM = 1;

/// The rung above or below the one given.
///
/// Tolerates a level that is not on the ladder rather than snapping it back to 1 - a value from
/// anywhere but this function still has to move, and move the way the gesture asked.
export function nextZoom(current: number, direction: ZoomDirection): number {
  if (direction === "in") {
    return ZOOM_LEVELS.find((level) => level > current) ?? MAX_ZOOM;
  }
  return ZOOM_LEVELS.filter((level) => level < current).at(-1) ?? MIN_ZOOM;
}

export interface WheelGesture {
  shiftKey: boolean;
  deltaX: number;
  deltaY: number;
}

/// Which way a wheel notch means to zoom, or null when it is an ordinary scroll.
///
/// Both axes are read, and that is the whole point of the function. Holding Shift makes the browser
/// report a vertical wheel as HORIZONTAL travel, so `deltaY` is zero on exactly the gesture this
/// feature is bound to - a handler reading it alone never fires, and does so silently.
export function wheelZoomDirection({ shiftKey, deltaX, deltaY }: WheelGesture): ZoomDirection | null {
  if (!shiftKey) return null;
  const travel = deltaY !== 0 ? deltaY : deltaX;
  if (travel === 0) return null;
  // Away from the user is negative on both axes, and means closer.
  return travel < 0 ? "in" : "out";
}

export interface PanStart {
  /// Where the pointer was when the drag began.
  x: number;
  y: number;
  /// Where the surface was scrolled to when the drag began. Held rather than read each move, so a
  /// steady pointer holds a steady offset instead of compounding its own travel.
  scrollLeft: number;
  scrollTop: number;
}

/// Where a pan drag puts the scroll offset.
///
/// The content follows the pointer - grab and drag - so the offset moves the opposite way to the
/// travel. Pure, because that inversion is the thing that is easy to get backwards and impossible
/// to notice in a diff.
export function panScroll(start: PanStart, at: { x: number; y: number }): { left: number; top: number } {
  return {
    left: Math.max(0, Math.round(start.scrollLeft - (at.x - start.x))),
    top: Math.max(0, Math.round(start.scrollTop - (at.y - start.y))),
  };
}
