import { describe, expect, it } from "vitest";
import { EDITOR_MODES, MODE_HINT_KEYS, MODE_LABEL_KEYS, isEditable, type EditorMode } from "./editorMode";

describe("editor modes", () => {
  it("offers only the modes that are actually implemented", () => {
    expect(EDITOR_MODES).toEqual(["live", "source", "preview"]);
  });

  // The mapping is here so the set of modes and the set of labels cannot drift; adding a mode without
  // a label would otherwise render its raw key in the switcher.
  it("has a label key and a hint key for every mode it offers", () => {
    for (const mode of EDITOR_MODES) {
      expect(MODE_LABEL_KEYS[mode]).toMatch(/^editor\.mode\./);
      expect(MODE_HINT_KEYS[mode]).toMatch(/^editor\.modeHint\./);
    }
  });

  it("makes the editing modes editable and preview not", () => {
    expect(isEditable("live")).toBe(true);
    expect(isEditable("source")).toBe(true);
    expect(isEditable("preview")).toBe(false);
  });

  it("treats every listed mode as a known mode", () => {
    const known: EditorMode[] = ["live", "source", "preview"];
    expect(EDITOR_MODES.every((mode) => known.includes(mode))).toBe(true);
  });
});
