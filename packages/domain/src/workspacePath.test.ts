import { describe, expect, it } from "vitest";
import { createPathGuard } from "./workspacePath";

const guard = createPathGuard({ root: "/ws", caseInsensitive: false });

describe("createPathGuard", () => {
  it("resolves a plain relative path inside the workspace", () => {
    expect(guard.resolve("notes.md")).toEqual({ ok: true, path: "/ws/notes.md" });
  });

  it("resolves a nested relative path", () => {
    expect(guard.resolve("a/b/c.md")).toEqual({ ok: true, path: "/ws/a/b/c.md" });
  });

  it("allows traversal that stays inside the workspace", () => {
    expect(guard.resolve("a/../b.md")).toEqual({ ok: true, path: "/ws/b.md" });
  });

  it("rejects traversal that escapes the workspace", () => {
    expect(guard.resolve("../secrets.md")).toEqual({ ok: false, reason: "escapes-workspace" });
  });

  it("rejects deep traversal that lands back on a plausible path", () => {
    expect(guard.resolve("a/../../ws-other/x.md")).toEqual({ ok: false, reason: "escapes-workspace" });
  });

  it("treats backslashes as separators, so they cannot smuggle traversal", () => {
    expect(guard.resolve("..\\secrets.md")).toEqual({ ok: false, reason: "escapes-workspace" });
  });

  it("rejects an absolute path", () => {
    expect(guard.resolve("/etc/passwd")).toEqual({ ok: false, reason: "not-relative" });
  });

  it("rejects a Windows drive-absolute path", () => {
    expect(guard.resolve("C:/Windows/system.ini")).toEqual({ ok: false, reason: "not-relative" });
  });

  it("rejects a Windows drive-relative path", () => {
    expect(guard.resolve("C:notes.md")).toEqual({ ok: false, reason: "not-relative" });
  });

  it("rejects a UNC path", () => {
    expect(guard.resolve("\\\\server\\share\\x.md")).toEqual({ ok: false, reason: "not-relative" });
  });

  it("rejects a NUL byte", () => {
    expect(guard.resolve("notes\u0000.md")).toEqual({ ok: false, reason: "invalid-characters" });
  });

  it("rejects an empty path", () => {
    expect(guard.resolve("")).toEqual({ ok: false, reason: "empty" });
    expect(guard.resolve("   ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("contains", () => {
  it("accepts a path inside the workspace", () => {
    expect(guard.contains("/ws/a/b.md")).toBe(true);
  });

  it("accepts the workspace root itself", () => {
    expect(guard.contains("/ws")).toBe(true);
  });

  // The prefix bug: "/ws-other" starts with "/ws" as a string but is a different directory.
  it("rejects a sibling directory sharing the root's name prefix", () => {
    expect(guard.contains("/ws-other/x.md")).toBe(false);
    expect(guard.contains("/wsx")).toBe(false);
  });

  it("rejects a path outside the workspace", () => {
    expect(guard.contains("/etc/passwd")).toBe(false);
  });

  it("compares case-sensitively by default", () => {
    expect(guard.contains("/WS/a.md")).toBe(false);
  });

  it("compares case-insensitively when the filesystem does", () => {
    const win = createPathGuard({ root: "C:/Workspace", caseInsensitive: true });
    expect(win.contains("c:/workspace/notes.md")).toBe(true);
    expect(win.contains("c:/workspace-other/notes.md")).toBe(false);
  });
});
