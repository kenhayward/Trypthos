import { describe, expect, it } from "vitest";
import { normaliseEndpoint } from "./endpoints";

describe("normaliseEndpoint", () => {
  it("leaves a plain endpoint alone", () => {
    expect(normaliseEndpoint("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("treats a trailing slash as the same endpoint", () => {
    expect(normaliseEndpoint("https://api.example.com/v1/")).toBe(
      normaliseEndpoint("https://api.example.com/v1"),
    );
  });

  it("ignores repeated trailing slashes, which a hand-edited setting can carry", () => {
    expect(normaliseEndpoint("https://api.example.com/v1///")).toBe(
      normaliseEndpoint("https://api.example.com/v1"),
    );
  });

  it("ignores the case of the host", () => {
    expect(normaliseEndpoint("https://API.Example.com/v1")).toBe(
      normaliseEndpoint("https://api.example.com/v1"),
    );
  });

  it("ignores surrounding whitespace, which a pasted URL usually carries", () => {
    expect(normaliseEndpoint("  https://api.example.com/v1  ")).toBe(
      normaliseEndpoint("https://api.example.com/v1"),
    );
  });

  // Different providers must stay different, or one user's key would be offered to another's
  // endpoint.
  it("keeps genuinely different endpoints apart", () => {
    expect(normaliseEndpoint("https://api.example.com/v1")).not.toBe(
      normaliseEndpoint("https://api.example.com/v2"),
    );
    expect(normaliseEndpoint("https://a.example.com/v1")).not.toBe(
      normaliseEndpoint("https://b.example.com/v1"),
    );
  });

  it("does not mistake an empty endpoint for a real one", () => {
    expect(normaliseEndpoint("   ")).toBe("");
  });
});
