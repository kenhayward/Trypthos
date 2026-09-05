import { describe, expect, it } from "vitest";
import { SECTION_LABEL_KEYS, SETTINGS_SECTIONS, type SettingsSection } from "./settingsSections";

describe("settings sections", () => {
  it("lists the sections in the order the rail draws them", () => {
    expect(SETTINGS_SECTIONS).toEqual([
      "appearance",
      "window",
      "chatModels",
      "ai",
      "editor",
      "fileTypes",
      "about",
    ]);
  });

  // About is set apart from the working settings above it, which is what the rail's separator
  // draws. Anywhere else in the list and the separator would sit in the middle of the settings.
  it("keeps About last", () => {
    expect(SETTINGS_SECTIONS.at(-1)).toBe("about");
  });

  // A missing key renders as the key itself, so a section added without one puts
  // `settings.section.editor` in the rail where a label should be.
  it("has a label key for every section, and no key for anything else", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SECTION_LABEL_KEYS[section]).toMatch(/^settings[.]section[.]/);
    }
    const keyed = Object.keys(SECTION_LABEL_KEYS) as SettingsSection[];
    expect(keyed.sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });
});
