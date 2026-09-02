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

describe("migrating from version 1", () => {
  /// The first real migration. Version 1 knew nothing of appearance or window behaviour, so a
  /// settings file written by 0.9.0 is missing both - and must come forward rather than being
  /// discarded, or everyone who has used Trypthos loses their panel widths on upgrade.
  const v1 = {
    schemaVersion: 1,
    panels: {
      workspaceWidth: 326,
      chatWidth: 348,
      workspaceCollapsed: false,
      chatCollapsed: true,
    },
    lastWorkspace: "D:/Notes",
  };

  it("keeps everything version 1 stored", () => {
    const migrated = loadSettings(v1);
    expect(migrated.panels.workspaceWidth).toBe(326);
    expect(migrated.panels.chatCollapsed).toBe(true);
    expect(migrated.lastWorkspace).toBe("D:/Notes");
  });

  it("fills in what version 2 added", () => {
    const migrated = loadSettings(v1);
    expect(migrated.appearance.theme).toBe("system");
    expect(migrated.window.closeToTray).toBe(false);
  });

  it("arrives at the current version", () => {
    expect(loadSettings(v1).schemaVersion).toBe(SETTINGS_VERSION);
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

  it("accepts each theme, and refuses anything else", () => {
    for (const theme of ["system", "light", "dark"]) {
      expect(() =>
        SettingsSchema.parse({ ...DEFAULT_SETTINGS, appearance: { theme } }),
      ).not.toThrow();
    }
    expect(() =>
      SettingsSchema.parse({ ...DEFAULT_SETTINGS, appearance: { theme: "auto" } }),
    ).toThrow();
  });

  it("is the version the migrations chain up to", () => {
    const highest = SETTINGS_MIGRATIONS.reduce((max, m) => Math.max(max, m.to), 1);
    expect(highest).toBeLessThanOrEqual(SETTINGS_VERSION);
  });
});
