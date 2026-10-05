import { describe, expect, it } from "vitest";
import { isPasteMarkdownShortcut } from "./pasteShortcut";

/// The shortcut's identity: Ctrl and Shift with V - Cmd instead of Ctrl on macOS. Everything else
/// is a different request, and answering it would paste into somebody's document unasked.
describe("isPasteMarkdownShortcut", () => {
  const press = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key: "v",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it("is Ctrl and Shift with V on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      // Shift makes the character arrive capitalised, so both spellings are the same request.
      expect(isPasteMarkdownShortcut(press({ ctrlKey: true, shiftKey: true }), platform)).toBe(true);
      expect(isPasteMarkdownShortcut(press({ ctrlKey: true, shiftKey: true, key: "V" }), platform)).toBe(true);
    }
  });

  it("is Cmd and Shift with V on macOS", () => {
    expect(isPasteMarkdownShortcut(press({ metaKey: true, shiftKey: true }), "darwin")).toBe(true);
    expect(isPasteMarkdownShortcut(press({ metaKey: true, shiftKey: true, key: "V" }), "darwin")).toBe(true);
  });

  it("is not the plain paste, which has no Shift", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      const mod = platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
      expect(isPasteMarkdownShortcut(press(mod), platform)).toBe(false);
    }
  });

  it("is not V with Shift alone - no modifier is no shortcut", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      expect(isPasteMarkdownShortcut(press({ shiftKey: true }), platform)).toBe(false);
    }
  });

  // The modifier is the platform's own, and only it - the zoom keys' rule. A Ctrl that also worked
  // on macOS would collide with the shell there, where Ctrl is a right click rather than a modifier.
  it("refuses the other platform's modifier", () => {
    expect(isPasteMarkdownShortcut(press({ ctrlKey: true, shiftKey: true }), "darwin")).toBe(false);
    expect(isPasteMarkdownShortcut(press({ metaKey: true, shiftKey: true }), "win32")).toBe(false);
  });

  // Ctrl+Alt is AltGr on a European layout, so without this clause somebody typing a character with
  // AltGr would paste into their document doing it.
  it("refuses any press that also holds Alt", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      const mod = platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
      expect(isPasteMarkdownShortcut(press({ ...mod, shiftKey: true, altKey: true }), platform)).toBe(false);
    }
  });

  it("refuses a different letter with the same modifiers", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      const mod = platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
      expect(isPasteMarkdownShortcut(press({ ...mod, shiftKey: true, key: "b" }), platform)).toBe(false);
    }
  });
});
