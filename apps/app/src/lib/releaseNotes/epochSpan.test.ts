import { describe, expect, it } from "vitest";
import { compareVersions, epochSpan, isWithinEpoch } from "./epochSpan";
import type { Epoch, SpineEntry } from "./types";

const epoch: Epoch = { id: "e1", title: "First", from: "0.1.0", to: "0.3.2", summary: "..." };

describe("compareVersions", () => {
  it("orders by minor before build", () => {
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("isWithinEpoch", () => {
  it("treats both bounds as inclusive", () => {
    expect(isWithinEpoch("0.1.0", epoch)).toBe(true);
    expect(isWithinEpoch("0.3.2", epoch)).toBe(true);
  });

  it("excludes versions outside the bounds", () => {
    expect(isWithinEpoch("0.0.9", epoch)).toBe(false);
    expect(isWithinEpoch("0.3.3", epoch)).toBe(false);
  });
});

describe("epochSpan", () => {
  const spine: SpineEntry[] = [
    { version: "0.3.2", date: "2026-03-04" },
    { version: "0.2.0", date: "2026-02-01" },
    { version: "0.1.0", date: "2026-01-09" },
    { version: "0.4.0", date: "2026-04-01" },
  ];

  it("counts only the releases inside the epoch and spans their dates", () => {
    expect(epochSpan(epoch, spine)).toEqual({
      releaseCount: 3,
      firstDate: "2026-01-09",
      lastDate: "2026-03-04",
    });
  });

  it("reports an empty span rather than throwing when an epoch covers nothing", () => {
    const empty: Epoch = { id: "e0", title: "None", from: "9.0.0", to: "9.9.9", summary: "..." };
    expect(epochSpan(empty, spine)).toEqual({ releaseCount: 0, firstDate: null, lastDate: null });
  });
});
