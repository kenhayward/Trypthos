import { describe, expect, it } from "vitest";
import { PAGE_TURN_PAUSE, PAGE_TURN_TRAVEL, REST, wheelPageTurn, type PageWheel } from "./pageWheel";

/// A page that fits the panel: at its top and its bottom at once, which is every page at Fit.
const FITS = { atTop: true, atBottom: true };
const MIDDLE = { atTop: false, atBottom: false };
const BOTTOM = { atTop: false, atBottom: true };
const TOP = { atTop: true, atBottom: false };

const wheel = (over: Partial<PageWheel>): PageWheel => ({
  travel: 100,
  ...FITS,
  page: 2,
  pages: 5,
  now: 10_000,
  ...over,
});

describe("wheelPageTurn", () => {
  it("turns forward on a notch down when the page fits, and back on a notch up", () => {
    expect(wheelPageTurn(REST, wheel({ travel: 100 })).turn).toBe(1);
    expect(wheelPageTurn(REST, wheel({ travel: -100 })).turn).toBe(-1);
  });

  // Inside a page larger than the panel the wheel is the browser's: it scrolls the page, and a
  // turn there would take the reader off a page they were halfway down.
  it("leaves the wheel to scroll a page that has somewhere to scroll to", () => {
    expect(wheelPageTurn(REST, wheel({ ...MIDDLE, travel: 100 })).turn).toBe(0);
    expect(wheelPageTurn(REST, wheel({ ...TOP, travel: 100 })).turn).toBe(0);
    expect(wheelPageTurn(REST, wheel({ ...BOTTOM, travel: -100 })).turn).toBe(0);
  });

  it("turns at the edge the wheel is moving past", () => {
    expect(wheelPageTurn(REST, wheel({ ...BOTTOM, travel: 100 })).turn).toBe(1);
    expect(wheelPageTurn(REST, wheel({ ...TOP, travel: -100 })).turn).toBe(-1);
  });

  it("stops at the first and last pages", () => {
    expect(wheelPageTurn(REST, wheel({ page: 5, travel: 100 })).turn).toBe(0);
    expect(wheelPageTurn(REST, wheel({ page: 1, travel: -100 })).turn).toBe(0);
  });

  // A notch is one event, so the mouse spun quickly turns a page per notch rather than one per spin.
  it("turns once per notch, however quickly the notches come", () => {
    const first = wheelPageTurn(REST, wheel({ now: 1000 }));
    const second = wheelPageTurn(first.next, wheel({ now: 1020, page: 3 }));
    expect([first.turn, second.turn]).toEqual([1, 1]);
  });

  // A trackpad is dozens of small events. They add up to a notch before a page turns, so a nudge
  // turns nothing and a stroke turns one.
  it("adds a trackpad's small travel up to a notch before turning", () => {
    let state = REST;
    const turns: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const step = wheelPageTurn(state, wheel({ travel: PAGE_TURN_TRAVEL / 10, now: 1000 + i * 10 }));
      turns.push(step.turn);
      state = step.next;
    }
    expect(turns.every((turn) => turn === 0)).toBe(true);
    expect(wheelPageTurn(state, wheel({ travel: PAGE_TURN_TRAVEL / 10, now: 1100 })).turn).toBe(1);
  });

  // A flick keeps sending travel for a second after the fingers lift. One stroke is one page: the
  // small events that follow a turn are swallowed until they pause.
  it("swallows a flick's tail after a turn until the travel pauses", () => {
    let state = wheelPageTurn(REST, wheel({ travel: PAGE_TURN_TRAVEL, now: 1000 })).next;
    for (let at = 1010; at < 2000; at += 10) {
      const step = wheelPageTurn(state, wheel({ travel: 30, now: at, page: 3 }));
      expect(step.turn).toBe(0);
      state = step.next;
    }
    // After a pause, the next stroke is a stroke.
    const after = 1990 + PAGE_TURN_PAUSE + 1;
    let turned = 0;
    for (let i = 0; i < 5; i += 1) {
      const step = wheelPageTurn(state, wheel({ travel: 30, now: after + i * 10, page: 3 }));
      turned += step.turn;
      state = step.next;
    }
    expect(turned).toBe(1);
  });

  it("forgets travel built up in the other direction", () => {
    const down = wheelPageTurn(REST, wheel({ travel: PAGE_TURN_TRAVEL * 0.9, now: 1000 })).next;
    const up = wheelPageTurn(down, wheel({ travel: -PAGE_TURN_TRAVEL * 0.2, now: 1010 }));
    expect(up.turn).toBe(0);
    expect(up.next.carried).toBeCloseTo(-PAGE_TURN_TRAVEL * 0.2);
  });

  // Scrolling inside the page is the browser's, and travel built up there is not travel past the
  // edge: arriving at the bottom starts from nothing.
  it("starts from nothing on reaching the edge", () => {
    const inside = wheelPageTurn(REST, wheel({ ...MIDDLE, travel: PAGE_TURN_TRAVEL * 0.9, now: 1000 })).next;
    expect(inside.carried).toBe(0);
  });
});
