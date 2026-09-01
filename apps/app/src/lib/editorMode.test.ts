import { describe, expect, it } from "vitest";
import { EDITOR_MODES, MODE_LABELS, isEditable, type EditorMode } from "./editorMode";

describe("editor modes", () => {
  it("offers only the modes that are actually implemented", () => {
    expect(EDITOR_MODES).toEqual(["source", "preview"]);
  });

  it("labels every mode it offers", () => {
    for (const mode of EDITOR_MODES) {
      expect(MODE_LABELS[mode]).toBeTruthy();
    }
  });

  it("makes source editable and preview not", () => {
    expect(isEditable("source")).toBe(true);
    expect(isEditable("preview")).toBe(false);
  });

  it("treats every listed mode as a known mode", () => {
    const known: EditorMode[] = ["source", "preview"];
    expect(EDITOR_MODES.every((mode) => known.includes(mode))).toBe(true);
  });
});
