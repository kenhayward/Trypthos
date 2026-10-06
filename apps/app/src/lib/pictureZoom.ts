import { ZOOM_LEVELS, type ZoomDirection } from "./zoom";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/// How a picture is being looked at.
///
/// Fit is a kind of its own rather than the number it currently works out to, because the number
/// depends on the panel: a picture left in Fit has to stay fitted when the panel is resized, and a
/// stored 0.37 would not. A chosen scale, by contrast, is the reader's and stays put.
export type PictureView = { kind: "fit" } | { kind: "scale"; scale: number };

/// The most a picture is enlarged to. Eight times is past the point where pixels are squares, which
/// is as far as anyone inspecting a screenshot needs to go.
export const PICTURE_MAX = 8;

/// The rungs the buttons and keys step between: the text ladder, extended at both ends.
///
/// The same rungs in the middle so 100% is still on the ladder and stepping back lands on it. The
/// extra ones exist because a picture's range is wider than text's - a photograph can be ten times
/// the panel, and a detail in a screenshot wants more than 4x.
export const PICTURE_ZOOM_LEVELS: readonly number[] = [0.1, 0.25, 0.33, ...ZOOM_LEVELS, 5, 6, PICTURE_MAX];

/// Two scales closer than this are the same scale. They are products of division, and a fit scale
/// recomputed from the same panel can differ in the last bit.
const SAME = 1e-9;

/// The scale at which the whole picture shows in the box - but never above 1.
///
/// Never enlarged, because a small picture blown up to fill the panel is a blurred picture, not a
/// clearer one. A box with no size (a panel not yet laid out) answers 1, which draws the picture
/// rather than nothing.
export function fitScale(natural: Size, box: Size): number {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return 1;
  return Math.min(1, box.width / natural.width, box.height / natural.height);
}

/// The smallest a picture goes: the bottom rung, or its fit scale if that is smaller - a picture so
/// large that fitting it takes it below the ladder must still be able to get back to Fit by zooming.
export function minScale(fit: number): number {
  return Math.min(PICTURE_ZOOM_LEVELS[0] ?? fit, fit);
}

function clamp(scale: number, fit: number): number {
  return Math.min(PICTURE_MAX, Math.max(minScale(fit), scale));
}

/// The scale on screen.
export function scaleOf(view: PictureView, fit: number): number {
  return view.kind === "fit" ? fit : view.scale;
}

/// The next rung in the direction asked, from the scale on screen.
///
/// From the scale on screen, so zooming in on a picture fitted at 30% goes to 33% rather than
/// jumping to the rung above 100%. A scale between rungs - which the wheel leaves - moves to the
/// next rung rather than snapping back to one behind it.
export function stepPicture(view: PictureView, fit: number, dir: ZoomDirection): PictureView {
  const current = scaleOf(view, fit);
  const next =
    dir === "in"
      ? (PICTURE_ZOOM_LEVELS.find((level) => level > current + SAME) ?? PICTURE_MAX)
      : (PICTURE_ZOOM_LEVELS.filter((level) => level < current - SAME).at(-1) ?? minScale(fit));
  return { kind: "scale", scale: clamp(next, fit) };
}

/// How quickly the wheel zooms: the scale multiplies by e for every 500 px of travel. One mouse
/// notch (100 px in Chromium) is about 22%, and a pinch's few pixels a frame are a smooth motion.
const WHEEL_RATE = 0.002;

/// The scale after a wheel or pinch gesture of `travel` pixels, negative meaning in.
///
/// Continuous rather than by rungs, unlike text. Text steps because a font has sizes it renders
/// well at; a picture has no such sizes, and a pinch that moved in visible jumps would feel broken.
/// Exponential, so the same travel in and out returns to the same scale.
export function wheelPicture(view: PictureView, fit: number, travel: number): PictureView {
  return { kind: "scale", scale: clamp(scaleOf(view, fit) * Math.exp(-travel * WHEEL_RATE), fit) };
}

/// What a double-click does: from Fit to the picture's own pixels, and from anything else back to
/// Fit. A scale that happens to equal the fit scale looks like Fit, so it toggles like it.
export function toggleFit(view: PictureView, fit: number): PictureView {
  const fitted = view.kind === "fit" || Math.abs(view.scale - fit) < SAME;
  return fitted ? { kind: "scale", scale: 1 } : { kind: "fit" };
}

/// Where to scroll so the picture point under the pointer is still under it after a zoom.
///
/// `scroll` is the panel's scroll offset, `pointer` is where the pointer is within the panel's
/// visible box, and `offset` is where the picture sits within the scrolled content - it moves,
/// because a picture smaller than the panel is centred in it. The point under the pointer, in the
/// picture's own pixels, is `(scroll + pointer - offset) / oldScale`; placing that same point under
/// the same pointer at the new scale gives the new scroll. Floored at 0, because a panel cannot
/// scroll before its start; the browser clamps the other end itself.
export function anchoredScroll(a: {
  scroll: Point;
  pointer: Point;
  offset: Point;
  oldScale: number;
  newScale: number;
  newOffset: Point;
}): Point {
  const axis = (scroll: number, pointer: number, offset: number, newOffset: number) => {
    const point = (scroll + pointer - offset) / a.oldScale;
    return Math.max(0, point * a.newScale + newOffset - pointer);
  };
  return {
    x: axis(a.scroll.x, a.pointer.x, a.offset.x, a.newOffset.x),
    y: axis(a.scroll.y, a.pointer.y, a.offset.y, a.newOffset.y),
  };
}
