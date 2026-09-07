export interface DialogDragStart {
  /// Where the pointer was when the drag began.
  pointerX: number;
  pointerY: number;
  /// Where the dialog was when the drag began, relative to the panel it floats over. Held rather
  /// than read each move, so a steady pointer holds a steady position instead of compounding its
  /// own travel.
  left: number;
  top: number;
}

export interface DialogBounds {
  panelWidth: number;
  panelHeight: number;
  dialogWidth: number;
  dialogHeight: number;
}

/// Where a drag puts a floating dialog.
///
/// Clamped so the whole dialog stays inside the panel, and that is the part worth having as a
/// function: a dialog dragged off the edge is a dialog with no way back. It has no window chrome of
/// its own, so the only thing that could return it is the drag it can no longer be given.
///
/// A panel smaller than the dialog gives a negative maximum, where clamping the wrong way round
/// would pin it off the left edge instead of at it - so the low bound wins.
export function nextDialogPosition(
  start: DialogDragStart,
  at: { x: number; y: number },
  bounds: DialogBounds,
): { left: number; top: number } {
  const furthestLeft = Math.max(0, bounds.panelWidth - bounds.dialogWidth);
  const furthestTop = Math.max(0, bounds.panelHeight - bounds.dialogHeight);

  return {
    left: Math.round(
      Math.min(Math.max(start.left + (at.x - start.pointerX), 0), furthestLeft),
    ),
    top: Math.round(Math.min(Math.max(start.top + (at.y - start.pointerY), 0), furthestTop)),
  };
}
