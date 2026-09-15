import { describe, expect, it } from "vitest";
import { renameTarget } from "./entryName";

describe("renameTarget", () => {
  it("accepts an ordinary name, trimmed", () => {
    expect(renameTarget("  Meeting notes.md ", { current: "a.md", siblings: ["a.md"] })).toEqual({
      ok: true,
      name: "Meeting notes.md",
    });
  });

  it("refuses an empty name", () => {
    expect(renameTarget("   ", { current: "a.md", siblings: [] })).toEqual({ ok: false, problem: "empty" });
    expect(renameTarget(".", { current: "a.md", siblings: [] })).toEqual({ ok: false, problem: "empty" });
    expect(renameTarget("..", { current: "a.md", siblings: [] })).toEqual({ ok: false, problem: "empty" });
  });

  it.each(["a/b.md", "a\\b.md", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "tab\there"])(
    "refuses %j, which Windows will not take",
    (typed) => {
      expect(renameTarget(typed, { current: "a.md", siblings: [] })).toEqual({
        ok: false,
        problem: "invalid-characters",
      });
    },
  );

  it.each(["CON", "con.md", "Prn.txt", "aux", "NUL.tar.gz", "COM1", "lpt9.md"])(
    "refuses the reserved device name %j",
    (typed) => {
      expect(renameTarget(typed, { current: "a.md", siblings: [] })).toEqual({
        ok: false,
        problem: "reserved",
      });
    },
  );

  it("does not mistake a name that merely starts like a device for one", () => {
    expect(renameTarget("console.md", { current: "a.md", siblings: [] }).ok).toBe(true);
    expect(renameTarget("COM10", { current: "a.md", siblings: [] }).ok).toBe(true);
  });

  it("refuses a name ending in a dot, which Windows silently drops", () => {
    expect(renameTarget("notes.", { current: "a.md", siblings: [] })).toEqual({
      ok: false,
      problem: "trailing-dot",
    });
  });

  it("refuses a name longer than a filesystem takes", () => {
    expect(renameTarget("a".repeat(256), { current: "a.md", siblings: [] })).toEqual({
      ok: false,
      problem: "too-long",
    });
    expect(renameTarget("a".repeat(255), { current: "a.md", siblings: [] }).ok).toBe(true);
  });

  it("refuses a name another entry in the folder already has, ignoring case", () => {
    expect(renameTarget("B.md", { current: "a.md", siblings: ["a.md", "b.md"] })).toEqual({
      ok: false,
      problem: "taken",
    });
  });

  it("allows changing only the case of the entry's own name", () => {
    expect(renameTarget("A.md", { current: "a.md", siblings: ["a.md", "b.md"] })).toEqual({
      ok: true,
      name: "A.md",
    });
  });

  it("reports the unchanged name as unchanged rather than taken", () => {
    expect(renameTarget("a.md", { current: "a.md", siblings: ["a.md"] })).toEqual({
      ok: false,
      problem: "unchanged",
    });
  });
});
