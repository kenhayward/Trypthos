import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  SETTINGS_MIGRATIONS,
  SettingsSchema,
  loadSettings,
} from "./settings";

describe("SettingsSchema", () => {
  it("accepts the defaults it ships with", () => {
    expect(() => SettingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("rejects an unknown field rather than dropping it", () => {
    expect(() => SettingsSchema.parse({ ...DEFAULT_SETTINGS, colour: "red" })).toThrow();
  });

  it("rejects a width that is not a number", () => {
    expect(() =>
      SettingsSchema.parse({
        ...DEFAULT_SETTINGS,
        panels: { ...DEFAULT_SETTINGS.panels, workspaceWidth: "wide" },
      }),
    ).toThrow();
  });
});

describe("loadSettings", () => {
  it("returns the defaults when there is nothing stored", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("reads a current-version file", () => {
    const stored = { ...DEFAULT_SETTINGS, lastWorkspace: "D:/Notes" };
    expect(loadSettings(stored).lastWorkspace).toBe("D:/Notes");
  });

  // Settings are a convenience, not the user's work. A corrupt or unreadable file must not stop the
  // app opening - it falls back to defaults, and the next write replaces it.
  it("falls back to the defaults rather than failing on a corrupt file", () => {
    expect(loadSettings("not an object")).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ schemaVersion: 1, panels: "wrong" })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ nothing: true })).toEqual(DEFAULT_SETTINGS);
  });

  // Written by a newer build. Guessing at a shape from the future is how settings get silently
  // truncated on the next save.
  it("falls back rather than reading a file from a newer version", () => {
    expect(loadSettings({ ...DEFAULT_SETTINGS, schemaVersion: 99 })).toEqual(DEFAULT_SETTINGS);
  });

  it("is the version the migrations chain up to", () => {
    const highest = SETTINGS_MIGRATIONS.reduce((max, m) => Math.max(max, m.to), 1);
    expect(highest).toBeLessThanOrEqual(SETTINGS_VERSION);
  });
});
