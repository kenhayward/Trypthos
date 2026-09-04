import { describe, expect, it } from "vitest";
import { EDITOR_MODES, MODE_HINT_KEYS, MODE_LABEL_KEYS } from "./editorMode";

describe("editor mode labels", () => {
  // The mapping is here so the set of modes and the set of labels cannot drift; adding a mode without
  // a label would otherwise render its raw key in the switcher.
  it("has a label key and a hint key for every mode the domain offers", () => {
    for (const mode of EDITOR_MODES) {
      expect(MODE_LABEL_KEYS[mode]).toMatch(/^editor[.]mode[.]/);
      expect(MODE_HINT_KEYS[mode]).toMatch(/^editor[.]modeHint[.]/);
    }
  });

  // Every key, not just the ones a mode names: an orphan is the residue of a deleted mode.
  it("maps no mode the domain does not offer", () => {
    expect(Object.keys(MODE_LABEL_KEYS).sort()).toEqual([...EDITOR_MODES].sort());
    expect(Object.keys(MODE_HINT_KEYS).sort()).toEqual([...EDITOR_MODES].sort());
  });
});
