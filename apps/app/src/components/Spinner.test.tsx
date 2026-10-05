import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Spinner from "./Spinner";

describe("Spinner", () => {
  it("is a status with the label it was given", () => {
    render(<Spinner label="Loading..." />);
    expect(screen.getByRole("status", { name: "Loading..." })).toBeDefined();
  });

  // `motion-safe:` so a reader who asks their OS for less motion gets a still mark, not a spinning one.
  it("spins only when motion is welcome", () => {
    render(<Spinner label="Loading..." />);
    const glyph = screen.getByRole("status").querySelector("svg");
    const classes = (glyph?.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("motion-safe:animate-spin");
    expect(classes).not.toContain("animate-spin");
  });
});
