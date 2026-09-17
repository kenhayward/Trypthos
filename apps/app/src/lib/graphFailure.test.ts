import { describe, expect, it } from "vitest";
import { graphFailureKind } from "./graphFailure";

describe("graphFailureKind", () => {
  it("blames the computer's limits only for a failure that says so", () => {
    expect(graphFailureKind(new RangeError("Invalid typed array length: 2147483648"))).toBe("tooLarge");
    expect(graphFailureKind(new Error("Array buffer allocation failed"))).toBe("tooLarge");
    expect(graphFailureKind(new Error("Sigma: could not create WebGL context"))).toBe("tooLarge");
    expect(graphFailureKind(new Error("WebGL context lost"))).toBe("tooLarge");
    expect(graphFailureKind(new Error("Out of memory"))).toBe("tooLarge");
  });

  it("says only that the graph could not be drawn for anything else", () => {
    expect(graphFailureKind(new Error("Failed to fetch dynamically imported module"))).toBe("drawFailed");
    expect(graphFailureKind(new TypeError("reducer is not a function"))).toBe("drawFailed");
    expect(graphFailureKind(new Error("Graph.areNeighbors: could not find the node"))).toBe("drawFailed");
  });

  // A stack overflow is a RangeError too, but it says nothing about the vault's size - blaming it
  // on "too large" sends the user looking for a problem that is not there.
  it("does not blame the vault's size for a stack overflow", () => {
    expect(graphFailureKind(new RangeError("Maximum call stack size exceeded"))).toBe("drawFailed");
  });

  it("says the same for something that is not an error at all", () => {
    expect(graphFailureKind("nope")).toBe("drawFailed");
    expect(graphFailureKind(undefined)).toBe("drawFailed");
  });
});
