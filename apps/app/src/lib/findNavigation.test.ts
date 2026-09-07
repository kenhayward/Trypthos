import { describe, expect, it } from "vitest";
import { stepIndex } from "./findNavigation";

describe("stepIndex", () => {
  it("walks forwards and backwards", () => {
    expect(stepIndex(4, 1, "next")).toBe(2);
    expect(stepIndex(4, 1, "previous")).toBe(0);
  });

  // Wrapping rather than stopping. Every editor's find does it, and a Next that goes dead at the
  // last match makes somebody scroll back to the top by hand to carry on.
  it("wraps at both ends", () => {
    expect(stepIndex(4, 3, "next")).toBe(0);
    expect(stepIndex(4, 0, "previous")).toBe(3);
  });

  // -1 is "a search has run and you are not on any of them yet". Next goes to the first, and
  // Previous to the last, which is what those two words mean from nowhere.
  it("starts at either end when nothing is current", () => {
    expect(stepIndex(4, -1, "next")).toBe(0);
    expect(stepIndex(4, -1, "previous")).toBe(3);
  });

  it("has nowhere to go with no matches", () => {
    expect(stepIndex(0, -1, "next")).toBe(-1);
    expect(stepIndex(0, 0, "previous")).toBe(-1);
  });

  // An index left over from a longer list - a second search that found fewer - must not walk off
  // the end of the new one.
  it("comes back into range from an index the list no longer has", () => {
    expect(stepIndex(3, 9, "next")).toBe(0);
    expect(stepIndex(3, 9, "previous")).toBe(2);
  });
});
