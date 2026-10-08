/// The plain wheel over a document: scroll the page, and turn it at the edge.
///
/// One page is on screen at a time, so the wheel has two jobs. Inside a page larger than the panel
/// it is the browser's, and scrolls the page; once the page is at the edge the wheel is moving past,
/// it turns to the next page or the previous one. At Fit a page has no inside to scroll, so the wheel
/// turns a page per notch - the reason this exists at all, since a fitted document otherwise did
/// nothing under the wheel.
///
/// Pure, so the edge, the accumulation and the pause are tested without a browser: what decides a
/// turn is arithmetic over the travel and the time, and only the scroll edges come from layout.

/// Travel past the edge that turns a page: one notch of a Chromium mouse, which reports 100 px.
/// A notch is one event of this size, so it turns a page by itself; a trackpad's small events add
/// up to it.
export const PAGE_TURN_TRAVEL = 100;

/// How long the small travel after a turn must stop before it can turn another page. A flick on a
/// trackpad keeps sending travel for a second after the fingers lift, and one stroke is one page;
/// every swallowed event pushes the pause on, so the tail is swallowed however long it is.
export const PAGE_TURN_PAUSE = 200;

/// What one wheel event over the page carries.
export interface PageWheel {
  /// Vertical travel in pixels, positive down - already scaled from lines or pages.
  travel: number;
  /// Whether the page is scrolled as far up, or down, as it goes. A page that fits is both.
  atTop: boolean;
  atBottom: boolean;
  /// The page on screen, 1-based, and how many there are.
  page: number;
  pages: number;
  /// The event's time in milliseconds.
  now: number;
}

/// What is carried from one event to the next: travel past the edge not yet worth a page, and the
/// time before which small travel is a flick's tail rather than a new stroke.
export interface PageWheelState {
  carried: number;
  quietUntil: number;
}

export const REST: PageWheelState = { carried: 0, quietUntil: Number.NEGATIVE_INFINITY };

/// The page turn one wheel event makes - forward, back or none - and the state for the next.
export function wheelPageTurn(
  state: PageWheelState,
  wheel: PageWheel,
): { turn: -1 | 0 | 1; next: PageWheelState } {
  const { travel, now } = wheel;
  if (travel === 0) return { turn: 0, next: state };
  const direction = travel > 0 ? 1 : -1;
  const atEdge = direction > 0 ? wheel.atBottom : wheel.atTop;
  const noPage = direction > 0 ? wheel.page >= wheel.pages : wheel.page <= 1;
  // Inside the page, the browser scrolls it; at the first or last page there is nowhere to turn to.
  // Either way nothing past the edge is building up.
  if (!atEdge || noPage) return { turn: 0, next: { carried: 0, quietUntil: state.quietUntil } };

  const turned = { turn: direction, next: { carried: 0, quietUntil: now + PAGE_TURN_PAUSE } } as const;
  // A notch is a deliberate click of the wheel, and a page per click however fast they come.
  if (Math.abs(travel) >= PAGE_TURN_TRAVEL) return turned;
  // A flick's tail: swallowed, and the pause pushed on.
  if (now < state.quietUntil) return { turn: 0, next: { carried: 0, quietUntil: now + PAGE_TURN_PAUSE } };

  // Travel the other way is a reader changing their mind, not more of the same stroke.
  const sameWay = state.carried === 0 || Math.sign(state.carried) === direction;
  const carried = sameWay ? state.carried + travel : travel;
  if (Math.abs(carried) >= PAGE_TURN_TRAVEL) return turned;
  return { turn: 0, next: { carried, quietUntil: state.quietUntil } };
}
