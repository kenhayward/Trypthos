import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  EditorModeSchema,
  isEditable,
  type EditorMode,
} from "./editorMode";

describe("editor modes", () => {
  it("offers only the modes that are actually implemented", () => {
    expect(EDITOR_MODES).toEqual(["live", "source", "preview"]);
  });

  // Live is the mode most people stay in, and the one the app has always opened in. A stored
  // preference changes which mode a document opens in; it does not change which one is the default.
  it("defaults to Live", () => {
    expect(DEFAULT_EDITOR_MODE).toBe("live");
  });

  // Live and Source are the same editing surface with different decorations. Preview is not an
  // editor with editing switched off - it stopped being an editing surface.
  it("makes the editing modes editable and preview not", () => {
    expect(isEditable("live")).toBe(true);
    expect(isEditable("source")).toBe(true);
    expect(isEditable("preview")).toBe(false);
  });

  // The schema is what stops a hand-edited settings file naming a mode the editor cannot draw.
  it("accepts every mode it offers, and nothing else", () => {
    for (const mode of EDITOR_MODES) {
      expect(() => EditorModeSchema.parse(mode)).not.toThrow();
    }
    expect(() => EditorModeSchema.parse("wysiwyg")).toThrow();
  });

  it("treats every listed mode as a known mode", () => {
    const known: EditorMode[] = ["live", "source", "preview"];
    expect(EDITOR_MODES.every((mode) => known.includes(mode))).toBe(true);
  });
});
