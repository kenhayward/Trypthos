import { describe, expect, it } from "vitest";
import { trimLeading, trimTrailing, withoutClosingHashes } from "./trimRun";

describe("trimTrailing and trimLeading", () => {
  it("remove a run of the given characters from one end only", () => {
    expect(trimTrailing("a//b//", "/")).toBe("a//b");
    expect(trimLeading("--a-b--", "-")).toBe("a-b--");
  });

  it("treat each character of the set as a member, not the set as a sequence", () => {
    expect(trimTrailing("x \t \t", " \t")).toBe("x");
  });

  it("leave a string with nothing to remove as it was, and empty one that is all run", () => {
    expect(trimTrailing("abc", "/")).toBe("abc");
    expect(trimLeading("\n\n\n", "\n")).toBe("");
  });
});

describe("withoutClosingHashes", () => {
  it("removes a closing sequence and the space around it", () => {
    expect(withoutClosingHashes("Plan ##  ")).toBe("Plan");
    expect(withoutClosingHashes("  Plan")).toBe("Plan");
  });

  it("keeps a title that has no closing sequence", () => {
    expect(withoutClosingHashes("Plan for Q3")).toBe("Plan for Q3");
  });
});
