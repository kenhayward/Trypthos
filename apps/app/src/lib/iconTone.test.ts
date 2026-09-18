import { describe, expect, it } from "vitest";
import { ICON_TONES, toneColour } from "./iconTone";

/// Iconic's nine tones resolve against the Obsidian theme the vault is using, which this app cannot
/// read. They are therefore translated to tokens of our own, so a red folder is red in both themes
/// here rather than a value that only works in one.

describe("an icon's colour", () => {
  it("translates each of Iconic's nine tones to a token", () => {
    expect(Object.keys(ICON_TONES).sort()).toEqual([
      "blue",
      "cyan",
      "gray",
      "green",
      "orange",
      "pink",
      "purple",
      "red",
      "yellow",
    ]);
    for (const token of Object.values(ICON_TONES)) expect(token.startsWith("var(--tp-tone-")).toBe(true);
  });

  it("uses the token for a named tone", () => {
    expect(toneColour("red")).toBe("var(--tp-tone-red)");
    expect(toneColour("BLUE")).toBe("var(--tp-tone-blue)");
  });

  it("passes a value the user chose through as given", () => {
    expect(toneColour("#3f6dd1")).toBe("#3f6dd1");
    expect(toneColour("rebeccapurple")).toBe("rebeccapurple");
    expect(toneColour("rgb(12, 200, 255)")).toBe("rgb(12, 200, 255)");
  });

  // No colour means the icon takes the colour of the row it sits in, like every other glyph.
  it("says nothing when there is no colour", () => {
    expect(toneColour(null)).toBe(undefined);
  });
});
