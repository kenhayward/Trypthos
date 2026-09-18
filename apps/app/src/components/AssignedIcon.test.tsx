import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AssignedIcon from "./AssignedIcon";

/// What an assignment looks like on a row. The icon is decoration beside a name that says the same
/// thing, so it is hidden from assistive technology exactly as every other glyph in the app is.

const mark = () => document.querySelector('[data-testid="assigned-icon"]');

describe("an assigned icon", () => {
  it("draws a Lucide icon as real paths", async () => {
    render(<AssignedIcon assignment={{ icon: "lucide-calendar-days", colour: null }} className="size-3.5" />);
    await waitFor(() =>
      expect(mark()?.querySelectorAll("path, rect, circle, line, polygon, polyline, ellipse").length).toBeGreaterThan(0),
    );
    expect(mark()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws an emoji as text", () => {
    render(<AssignedIcon assignment={{ icon: "\u{1F680}", colour: null }} className="size-3.5" />);
    expect(screen.getByTestId("assigned-icon").textContent).toBe("\u{1F680}");
  });

  it("takes the colour the user chose", async () => {
    render(<AssignedIcon assignment={{ icon: "lucide-calendar-days", colour: "red" }} className="size-3.5" />);
    await waitFor(() => expect(mark()?.getAttribute("style")).toContain("var(--tp-tone-red)"));
  });

  // An id the set does not hold must leave the row with the glyph it already had, rather than a gap
  // where an icon should be - which is what a row whose name then shifts left looks like.
  it("falls back to the row's own glyph for an icon Lucide does not have", async () => {
    render(
      <AssignedIcon
        assignment={{ icon: "lucide-not-a-real-icon", colour: null }}
        className="size-3.5"
        fallback={<span data-testid="own-glyph" />}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("own-glyph")).toBeTruthy());
    expect(mark()).toBe(null);
  });

  // And while the set is on its way. Without this the row has no icon for a moment and its name
  // jumps sideways when one arrives.
  it("shows the fallback until the icon set has loaded", () => {
    render(
      <AssignedIcon
        assignment={{ icon: "lucide-calendar-days", colour: null }}
        className="size-3.5"
        fallback={<span data-testid="own-glyph" />}
      />,
    );
    expect(screen.getByTestId("own-glyph")).toBeTruthy();
  });
});
