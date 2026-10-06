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
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  deltaX: number;
  deltaY: number;
  /// 0 pixels, 1 lines, 2 pages - the DOM's `WheelEvent.deltaMode`.
  deltaMode: number;
}

/// What a line and a page of wheel travel are worth in pixels, so a mouse that reports lines (Firefox
/// does, and so does a Windows setting) lands on the same scale as one that reports pixels.
const PIXELS_PER_LINE = 40;
const PIXELS_PER_PAGE = 800;

/// Pixels of zoom travel in a wheel event - negative is in - or null when it is not a zoom gesture.
///
/// Ctrl or Cmd with the wheel, which is what a browser and VS Code do. A trackpad pinch needs no
/// case of its own: Chromium reports it as a wheel event with `ctrlKey` set, on macOS and on
/// Windows alike, so reading Ctrl is how a pinch is read. Shift is NOT a zoom modifier - it is
/// sideways scrolling, and the browser is left to do that.
export function wheelZoomTravel(event: WheelGesture): number | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  // Ctrl+Shift can move a vertical wheel onto the horizontal axis, so fall back to it rather than
  // reading a zero.
  const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
  if (raw === 0) return null;
  if (event.deltaMode === 1) return raw * PIXELS_PER_LINE;
  if (event.deltaMode === 2) return raw * PIXELS_PER_PAGE;
  return raw;
}

/// Travel that makes one rung, and the size of one Chromium mouse notch is twice this.
const PIXELS_PER_STEP = 50;

/// Folds one event's travel into what is pending, and says whether that is a rung.
///
/// Two regimes, because the two devices differ by an order of magnitude. A mouse notch is one event
/// of 100 px: stepping per 50 px of ACCUMULATED travel would make one click jump two rungs, so an
/// event that is a step by itself steps exactly one and clears what was pending. A pinch is dozens
/// of events of a few px each: those accumulate, and every time they reach 50 px they step once and
/// keep the remainder. Flipping direction discards the pending travel, so a pinch that reverses does
/// not start already halfway to a step the other way.
export function stepWheelTravel(
  pending: number,
  travel: number,
): { pending: number; direction: ZoomDirection | null } {
  const heldBack = Math.sign(pending) === Math.sign(travel) ? pending : 0;
  // Away from the user is negative, and means closer.
  const toward = (amount: number): ZoomDirection => (amount < 0 ? "in" : "out");

  if (Math.abs(travel) >= PIXELS_PER_STEP) return { pending: 0, direction: toward(travel) };

  const total = heldBack + travel;
  if (Math.abs(total) >= PIXELS_PER_STEP) {
    return { pending: total - Math.sign(total) * PIXELS_PER_STEP, direction: toward(total) };
  }
  return { pending: total, direction: null };
}

/// What a zoom shortcut asks for. `reset` is the one the gestures cannot express: the wheel walks
/// the ladder, and getting back to 100% by turning it is only reliable BECAUSE 1 is a rung - a key
/// says it in one press from anywhere on the ladder.
///
/// `actual` is Ctrl/Cmd+1: a picture's own pixels, which for a picture is not the same as its
/// fitted size. Text has no such distinction, so a text surface ignores it.
export type ZoomCommand = ZoomDirection | "reset" | "actual";

export interface ZoomKeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/// Which key combinations mean in, out, or back to 100%.
///
/// The plus and minus keys have more than one spelling because the character that arrives is not
/// the one on the key cap: Ctrl and plus is Ctrl+Shift+= on a US layout, so `=` and `+` are the same
/// request, as are `-` and `_`. Shift is therefore NOT part of the test - it is how half of these
/// are typed.
///
/// Alt is, though. Ctrl+Alt is AltGr on a Windows keyboard, so without that clause somebody typing
/// a bracket or a backslash on a European layout would resize their document doing it.
export function zoomKeyCommand(
  press: ZoomKeyPress,
  platform: "darwin" | "win32" | "linux",
): ZoomCommand | null {
  if (press.altKey) return null;
  // The platform's modifier, and only it. Ctrl on macOS is a right click rather than a modifier,
  // and a Cmd that also worked on Windows would collide with the shell's own shortcuts.
  const held = platform === "darwin" ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!held) return null;

  if (press.key === "=" || press.key === "+") return "in";
  if (press.key === "-" || press.key === "_") return "out";
  if (press.key === "0") return "reset";
  if (press.key === "1") return "actual";
  return null;
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
