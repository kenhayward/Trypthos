import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ContextDial from "./ContextDial";

/// The dial over the composer.
///
/// Every number it shows is an estimate - only the provider's own tokeniser can count, and it only
/// reports after the request the dial exists to inform. So the wording is "about", everywhere.

describe("ContextDial", () => {
  it("says how much of the window is in use", () => {
    render(<ContextDial usage={{ tokens: 1200, limit: 8000, fraction: 0.15, over: false }} />);

    expect(screen.getByRole("img", { name: /About 1,200 of 8,000 tokens used/ })).toBeDefined();
  });

  // The common case: nobody knows their endpoint's window, and it cannot be asked for. The count is
  // still worth showing - what is missing is the proportion, so the dial says which.
  it("shows the count and asks for the window when there is no total", () => {
    render(<ContextDial usage={{ tokens: 1200, limit: null, fraction: null, over: false }} />);

    const dial = screen.getByRole("img", { name: /About 1,200 tokens/ });
    expect(dial.getAttribute("aria-label")).toMatch(/context window/i);
  });

  // Worth saying plainly: past the end, an endpoint typically drops the oldest of the conversation
  // rather than refusing, so the answer quietly stops accounting for the start of the chat.
  it("warns when the conversation has outgrown the window", () => {
    render(<ContextDial usage={{ tokens: 9000, limit: 8000, fraction: 1, over: true }} />);

    expect(screen.getByRole("img", { name: /past this model's 8,000/ })).toBeDefined();
  });

  // The tooltip is the whole feature - it is where the amount and the total live, and a dial with a
  // ring but no numbers would be a decoration.
  it("puts the same words in the hover as in the label", () => {
    render(<ContextDial usage={{ tokens: 1200, limit: 8000, fraction: 0.15, over: false }} />);

    const dial = screen.getByRole("img", { name: /About 1,200 of 8,000/ });
    expect(dial.getAttribute("title")).toBe(dial.getAttribute("aria-label"));
  });
});
