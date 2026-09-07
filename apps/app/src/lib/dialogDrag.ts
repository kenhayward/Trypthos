export interface DialogDragStart {
  /// Where the pointer was when the drag began.
  pointerX: number;
  pointerY: number;
  /// Where the dialog was when the drag began, in the coordinates of the element it is positioned
  /// against. Held rather than read each move, so a steady pointer holds a steady position instead
  /// of compounding its own travel.
  left: number;
  top: number;
}

/// How far the dialog may travel, in those same coordinates.
///
/// Any of them can be negative, and that is the point rather than an edge case: the dialog is
/// positioned against one panel and is allowed to travel over the ones beside it.
export interface DialogLimits {
  minLeft: number;
  maxLeft: number;
  minTop: number;
  maxTop: number;
}

export interface DragMeasurements {
  /// Where the positioning container sits in the window.
  originX: number;
  originY: number;
  viewportWidth: number;
  viewportHeight: number;
  dialogWidth: number;
  dialogHeight: number;
}

/// Where a floating dialog may go, worked out from the WINDOW rather than from the panel it happens
/// to be a child of.
///
/// The panel is only where its coordinates are measured from. Confining it there is the mistake this
/// replaces: every find is about the editor, so the editor is exactly the area a reader wants the
/// dialog out of - and the one place it could go was the one place it was in the way.
///
/// Two bounds are deliberately not the window's:
///
/// - **The top is the container's own top**, because above it is the title bar, and this window
///   draws its own - a panel parked over the close button is in the way of the only chrome there is.
/// - **Nothing may leave the window**, in any direction. The dialog has no chrome of its own, so one
///   pushed out of sight is one that can never be dragged back.
export function dragLimits({
  originX,
  originY,
  viewportWidth,
  viewportHeight,
  dialogWidth,
  dialogHeight,
}: DragMeasurements): DialogLimits {
  const minLeft = -originX;
  const minTop = 0;

  return {
    minLeft,
    // A window narrower than the dialog gives a maximum below the minimum, which would clamp it off
    // the wrong edge - so the low bound wins.
    maxLeft: Math.max(minLeft, viewportWidth - dialogWidth - originX),
    minTop,
    maxTop: Math.max(minTop, viewportHeight - dialogHeight - originY),
  };
}

/// Where a drag puts a floating dialog.
export function nextDialogPosition(
  start: DialogDragStart,
  at: { x: number; y: number },
  limits: DialogLimits,
): { left: number; top: number } {
  return {
    left: Math.round(
      Math.min(Math.max(start.left + (at.x - start.pointerX), limits.minLeft), limits.maxLeft),
    ),
    top: Math.round(
      Math.min(Math.max(start.top + (at.y - start.pointerY), limits.minTop), limits.maxTop),
    ),
  };
}
