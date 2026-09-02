export type Grows = "right" | "left";

export interface DragRequest {
  /// Width when the drag began, not the current width - otherwise each move compounds the last and
  /// the panel accelerates away from the pointer.
  startWidth: number;
  /// Pointer travel since the drag began, in pixels.
  deltaX: number;
  /// Which way the panel grows. The workspace grows rightwards; the chat, on the other side, grows
  /// leftwards, so the same gesture must mean the opposite thing.
  grows: Grows;
  min: number;
  max: number;
}

/// Where a divider drag puts the panel edge.
///
/// Pure, so the two things that are easy to get backwards - the direction, and compounding versus
/// absolute travel - are tested without a pointer, a browser or a layout.
export function nextDividerWidth({ startWidth, deltaX, grows, min, max }: DragRequest): number {
  const travelled = grows === "right" ? deltaX : -deltaX;
  return Math.round(Math.min(Math.max(startWidth + travelled, min), max));
}

/// Where an arrow key puts it. Shift takes bigger steps, as it does in most editors.
export function nextKeyboardWidth(
  current: number,
  key: string,
  options: { grows: Grows; min: number; max: number; coarse: boolean },
): number | null {
  const step = options.coarse ? 32 : 8;
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (direction === 0) return null;

  const delta = options.grows === "right" ? direction * step : -direction * step;
  return Math.min(Math.max(current + delta, options.min), options.max);
}
