import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  SETTINGS_MIGRATIONS,
  SettingsSchema,
  loadSettings,
} from "./settings";
import { DEFAULT_SYSTEM_PROMPT, PREVIOUS_SYSTEM_PROMPTS } from "./systemPrompt";

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

describe("migrating from version 2", () => {
  const v2 = {
    schemaVersion: 2,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
  };

  it("keeps everything version 2 stored", () => {
    const migrated = loadSettings(v2);
    expect(migrated.appearance.theme).toBe("dark");
    expect(migrated.window.closeToTray).toBe(true);
    expect(migrated.panels.workspaceWidth).toBe(326);
  });

  // No invented endpoint. There is no provider every user has, and a profile pointing somewhere
  // that does not answer is worse than an empty list, which at least says what to do next.
  it("starts with no chat profiles rather than inventing one", () => {
    const migrated = loadSettings(v2);
    expect(migrated.chat.profiles).toEqual([]);
  });

  // The chain has to run end to end. A version 1 file skipping straight to the current version would
  // miss whatever version 2 added, which is exactly the failure migrations exist to prevent.
  it("brings a version 1 file all the way forward", () => {
    const v1 = {
      schemaVersion: 1,
      panels: { workspaceWidth: 300, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: false },
      lastWorkspace: null,
    };
    const migrated = loadSettings(v1);

    expect(migrated.schemaVersion).toBe(SETTINGS_VERSION);
    expect(migrated.panels.workspaceWidth).toBe(300);
    expect(migrated.appearance.theme).toBe("system");
    expect(migrated.chat.profiles).toEqual([]);
    // Null, not a copy: that is what lets a later change to the default reach this user.
    expect(migrated.chat.systemPrompt).toBeNull();
  });
});

describe("migrating from version 3", () => {
  const v3 = {
    schemaVersion: 3,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: { profiles: [] },
  };

  it("leaves the system prompt unset, which means the current default", () => {
    expect(loadSettings(v3).chat.systemPrompt).toBeNull();
  });

  it("keeps everything version 3 stored", () => {
    const migrated = loadSettings(v3);
    expect(migrated.window.closeToTray).toBe(true);
    expect(migrated.appearance.theme).toBe("dark");
  });

  // A prompt the user cleared on purpose must stay cleared. Only a file that predates the field is
  // seeded - which is the difference between a migration and a default.
  it("does not overwrite a prompt the user has already set", () => {
    const stored = { ...v3, schemaVersion: 4, chat: { profiles: [], systemPrompt: "" } };
    expect(loadSettings(stored).chat.systemPrompt).toBe("");
  });
});

/// The bug this fixes: a stored prompt goes stale, and every later improvement to the default is
/// invisible to anyone who already had settings.
describe("migrating from version 4", () => {
  const v4 = (systemPrompt: string) => ({
    schemaVersion: 4,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: { profiles: [], systemPrompt },
  });

  // The exact shape of the reported problem: an installation upgraded from the version that
  // introduced the prompt, still carrying that version's text.
  it("releases a prompt seeded by an earlier version", () => {
    for (const previous of PREVIOUS_SYSTEM_PROMPTS) {
      expect(loadSettings(v4(previous)).chat.systemPrompt).toBeNull();
    }
  });

  it("releases a prompt matching the current default", () => {
    expect(loadSettings(v4(DEFAULT_SYSTEM_PROMPT)).chat.systemPrompt).toBeNull();
  });

  // A prompt somebody wrote is their work, and differs from a default by at least one character.
  it("leaves a prompt somebody has written alone", () => {
    expect(loadSettings(v4("Answer only in haiku.")).chat.systemPrompt).toBe("Answer only in haiku.");
  });

  it("leaves a nearly-default prompt alone, because it was edited", () => {
    const edited = `${DEFAULT_SYSTEM_PROMPT} Also be cheerful.`;
    expect(loadSettings(v4(edited)).chat.systemPrompt).toBe(edited);
  });

  // Cleared on purpose, for an endpoint that carries its own prompt. Not the same as "unset".
  it("keeps an empty prompt empty rather than restoring the default", () => {
    expect(loadSettings(v4("")).chat.systemPrompt).toBe("");
  });

  it("keeps everything else the version 4 file stored", () => {
    const migrated = loadSettings(v4(DEFAULT_SYSTEM_PROMPT));
    expect(migrated.window.closeToTray).toBe(true);
    expect(migrated.appearance.theme).toBe("dark");
  });
});

describe("chat profiles in settings", () => {
  const profile = {
    id: "local",
    label: "Local model",
    endpoint: "http://localhost:11434/v1",
    model: "qwen2.5-coder",
    supportsImages: false,
    isDefault: true,
  };
  const stored = { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, profiles: [profile] } };

  it("round-trips a configured profile", () => {
    expect(loadSettings(stored).chat.profiles[0]?.label).toBe("Local model");
  });

  // Falling back to defaults rather than throwing is the settings contract, but the point here is
  // that the list invariants are enforced at all when the profiles arrive from a file.
  it("falls back to defaults when a stored list breaks its invariants", () => {
    const twoDefaults = {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [profile, { ...profile, id: "other" }] },
    };
    expect(loadSettings(twoDefaults).chat.profiles).toEqual([]);
  });

  // A key in a settings file is a key in a backup, a sync folder and a support bundle.
  it("refuses a settings file whose profile carries an apiKey", () => {
    const leaked = {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [{ ...profile, apiKey: "sk-live-1234" }] },
    };
    expect(loadSettings(leaked).chat.profiles).toEqual([]);
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
