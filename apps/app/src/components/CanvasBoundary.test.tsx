import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectsConsoleError } from "../test-setup";
import CanvasBoundary from "./CanvasBoundary";

function Boom(): React.ReactNode {
  throw new Error("Failed to fetch dynamically imported module");
}

const MESSAGE = "The graph could not be drawn.";

describe("CanvasBoundary", () => {
  it("draws what it is given while there is nothing wrong with it", () => {
    render(
      <CanvasBoundary message={MESSAGE}>
        <p>the graph</p>
      </CanvasBoundary>,
    );
    expect(screen.getByText("the graph")).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  // The canvas arrives as a chunk fetched at the moment it is needed, and a fetch can fail. Without
  // a boundary that throw unmounts everything above it: the tab, its filters and the note beside it
  // all go, for a graph nobody could draw.
  it("shows the message instead of taking the page down when the canvas throws", () => {
    expectsConsoleError(/Failed to fetch dynamically imported module/);
    expectsConsoleError(/error occurred in the/i);
    render(
      <CanvasBoundary message={MESSAGE}>
        <Boom />
      </CanvasBoundary>,
    );
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });
});
