import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  SETTINGS_MIGRATIONS,
  SettingsSchema,
  chatPanelVisible,
  loadSettings,
} from "./settings";
import { DEFAULT_SYSTEM_PROMPT, PREVIOUS_SYSTEM_PROMPTS } from "./systemPrompt";
import { DEFAULT_FILE_TYPES } from "./fileTypes";

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

describe("migrating from version 5", () => {
  const v5 = {
    schemaVersion: 5,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: {
      systemPrompt: null,
      profiles: [
        {
          id: "one",
          label: "Local model",
          endpoint: "http://localhost:11434/v1",
          model: "qwen2.5-coder",
          supportsImages: false,
          isDefault: true,
        },
      ],
    },
  };

  // Off, not detected: there is no reliable way to ask an endpoint whether it supports tools, and
  // turning it on for an existing profile could break a chat that was working.
  it("leaves tool calling off for a profile configured before it existed", () => {
    expect(loadSettings(v5).chat.profiles[0]?.supportsTools).toBe(false);
  });

  it("keeps the profile otherwise intact", () => {
    const migrated = loadSettings(v5).chat.profiles[0];
    expect(migrated?.label).toBe("Local model");
    expect(migrated?.isDefault).toBe(true);
  });

  it("keeps the rest of the settings", () => {
    expect(loadSettings(v5).window.closeToTray).toBe(true);
    expect(loadSettings(v5).chat.systemPrompt).toBeNull();
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

describe("migrating from version 7", () => {
  const v7 = {
    schemaVersion: 7,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: {
      systemPrompt: null,
      folderFileLimit: 40,
      profiles: [
        {
          id: "one",
          label: "Local model",
          endpoint: "http://localhost:11434/v1",
          model: "qwen2.5-coder",
          supportsImages: false,
          supportsTools: false,
          thinking: false,
          reasoningEffort: "medium" as const,
          isDefault: true,
        },
      ],
    },
  };

  // Automatic, not "on". An existing user with a model configured has been looking at the panel all
  // along and keeps it; one who never configured a model was looking at a panel that could not
  // answer, and stops.
  it("leaves the choice automatic", () => {
    expect(loadSettings(v7).chat.showPanel).toBeNull();
  });

  it("keeps everything version 7 stored", () => {
    const migrated = loadSettings(v7);
    expect(migrated.chat.folderFileLimit).toBe(40);
    expect(migrated.chat.profiles[0]?.label).toBe("Local model");
    expect(migrated.window.closeToTray).toBe(true);
    expect(migrated.panels.workspaceWidth).toBe(326);
  });

  it("arrives at the current version", () => {
    expect(loadSettings(v7).schemaVersion).toBe(SETTINGS_VERSION);
  });
});

describe("chatPanelVisible", () => {
  const profile = {
    id: "local",
    label: "Local model",
    endpoint: "http://localhost:11434/v1",
    model: "qwen2.5-coder",
    contextWindow: null,
    supportsImages: false,
    supportsTools: false,
    thinking: false,
    reasoningEffort: "medium" as const,
    isDefault: true,
  };
  const chat = DEFAULT_SETTINGS.chat;

  // Null means "decide from what is configured", and is not the same as false - a stored false would
  // keep the panel hidden through the moment the user's first model made it useful.
  it("ships unset, so the answer is derived", () => {
    expect(DEFAULT_SETTINGS.chat.showPanel).toBeNull();
  });

  it("hides the panel while no model is configured", () => {
    expect(chatPanelVisible(chat)).toBe(false);
  });

  it("shows the panel as soon as a model is configured", () => {
    expect(chatPanelVisible({ ...chat, profiles: [profile] })).toBe(true);
  });

  it("obeys an explicit choice in both directions", () => {
    expect(chatPanelVisible({ ...chat, showPanel: true })).toBe(true);
    expect(chatPanelVisible({ ...chat, profiles: [profile], showPanel: false })).toBe(false);
  });
});

describe("migrating from version 8", () => {
  const v8 = {
    schemaVersion: 8,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: {
      systemPrompt: null,
      folderFileLimit: 40,
      showPanel: null,
      profiles: [],
    },
  };

  // Live, which is the mode the app has always opened in. A migration that picked anything else
  // would change what every existing installation opens in, which is not what adding a setting means.
  it("opens documents in the mode the app already used", () => {
    expect(loadSettings(v8).editor.defaultViewMode).toBe("live");
  });

  it("keeps everything version 8 stored", () => {
    const migrated = loadSettings(v8);
    expect(migrated.chat.folderFileLimit).toBe(40);
    expect(migrated.chat.showPanel).toBeNull();
    expect(migrated.window.closeToTray).toBe(true);
    expect(migrated.lastWorkspace).toBe("D:/Notes");
  });

  it("arrives at the current version", () => {
    expect(loadSettings(v8).schemaVersion).toBe(SETTINGS_VERSION);
  });
});

describe("the editor section", () => {
  it("ships opening documents in Live", () => {
    expect(DEFAULT_SETTINGS.editor.defaultViewMode).toBe("live");
  });

  it("round-trips a stored view mode", () => {
    const stored = { ...DEFAULT_SETTINGS, editor: { defaultViewMode: "source" as const } };
    expect(loadSettings(stored).editor.defaultViewMode).toBe("source");
  });

  // A settings file naming a mode the editor cannot draw would leave the centre panel blank.
  it("falls back to the defaults rather than accepting a mode that does not exist", () => {
    const stored = { ...DEFAULT_SETTINGS, editor: { defaultViewMode: "wysiwyg" } };
    expect(loadSettings(stored)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("migrating from version 9", () => {
  const v9 = {
    schemaVersion: 9,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: {
      systemPrompt: null,
      folderFileLimit: 40,
      showPanel: null,
      profiles: [
        {
          id: "one",
          label: "Local model",
          endpoint: "http://localhost:11434/v1",
          model: "qwen2.5-coder",
          supportsImages: false,
          supportsTools: false,
          thinking: false,
          reasoningEffort: "medium" as const,
          isDefault: true,
        },
      ],
    },
    editor: { defaultViewMode: "live" as const },
  };

  // Unknown, not guessed. There is no way to ask an OpenAI-compatible endpoint how big its window
  // is, and a number invented here would draw a dial that is confidently wrong.
  it("leaves the context window unset for a profile configured before it existed", () => {
    expect(loadSettings(v9).chat.profiles[0]?.contextWindow).toBeNull();
  });

  it("keeps everything version 9 stored", () => {
    const migrated = loadSettings(v9);
    expect(migrated.chat.profiles[0]?.label).toBe("Local model");
    expect(migrated.editor.defaultViewMode).toBe("live");
    expect(migrated.chat.folderFileLimit).toBe(40);
  });

  it("arrives at the current version", () => {
    expect(loadSettings(v9).schemaVersion).toBe(SETTINGS_VERSION);
  });
});

describe("the file types a settings file names", () => {
  const before = {
    schemaVersion: 10,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    chat: { systemPrompt: null, folderFileLimit: 40, showPanel: null, profiles: [] },
    editor: { defaultViewMode: "live" as const },
  };

  // Adding a setting must not change what an existing installation does. Somebody who upgrades sees
  // exactly the tree they saw yesterday until they go and turn something on.
  it("seeds an upgraded file with markdown alone", () => {
    expect(loadSettings(before).fileTypes.enabled).toEqual(["markdown"]);
  });

  it("leaves everything else version 10 stored", () => {
    const migrated = loadSettings(before);
    expect(migrated.lastWorkspace).toBe("D:/Notes");
    expect(migrated.chat.folderFileLimit).toBe(40);
    expect(migrated.schemaVersion).toBe(SETTINGS_VERSION);
  });

  // A fresh installation and an upgraded one deliberately DIFFER here, which is the opposite of
  // what this test used to assert.
  //
  // A new install turns everything on: it has nobody to surprise, and a folder browser showing one
  // file type's worth of a folder is only useful to somebody who finds the settings page first. An
  // upgrade keeps what it has, because changing what somebody's browser shows without being asked
  // is the thing the original markdown-only default existed to avoid.
  it("starts a fresh installation with every type", () => {
    expect(DEFAULT_SETTINGS.fileTypes.enabled).toEqual([...DEFAULT_FILE_TYPES]);
    expect(DEFAULT_SETTINGS.fileTypes.enabled.length).toBeGreaterThan(1);
  });

  it("leaves an upgraded installation on the list it already had", () => {
    expect(loadSettings(before).fileTypes.enabled).toEqual(["markdown"]);
  });

  it("keeps a list the user has chosen", () => {
    const chosen = { ...before, schemaVersion: 11, fileTypes: { enabled: ["markdown", "text"] } };
    expect(loadSettings(chosen).fileTypes.enabled).toEqual(["markdown", "text"]);
  });

  // Strings rather than an enum, on purpose. A file written by a NEWER build names types this one
  // has never heard of; a strict enum would refuse the whole file and take the user's panel widths,
  // their open folder and every configured model down with it. The unknown id survives the round
  // trip and is ignored where it is read.
  it("loads a file naming a type it does not know", () => {
    const newer = { ...before, schemaVersion: 11, fileTypes: { enabled: ["markdown", "klingon"] } };
    expect(loadSettings(newer).fileTypes.enabled).toEqual(["markdown", "klingon"]);
    expect(loadSettings(newer).lastWorkspace).toBe("D:/Notes");
  });
});

describe("the context window on a profile", () => {
  const profile = {
    id: "local",
    label: "Local model",
    endpoint: "http://localhost:11434/v1",
    model: "qwen2.5-coder",
    supportsImages: false,
    supportsTools: false,
    thinking: false,
    reasoningEffort: "medium" as const,
    isDefault: true,
  };
  const withWindow = (contextWindow: unknown) => ({
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, profiles: [{ ...profile, contextWindow }] },
  });

  it("round-trips a configured window", () => {
    expect(loadSettings(withWindow(128_000)).chat.profiles[0]?.contextWindow).toBe(128_000);
  });

  // A window of zero would divide the dial by nothing, and a fractional one is not a token count.
  it("refuses a window that is not a positive whole number", () => {
    expect(loadSettings(withWindow(0)).chat.profiles).toEqual([]);
    expect(loadSettings(withWindow(-1)).chat.profiles).toEqual([]);
    expect(loadSettings(withWindow(1.5)).chat.profiles).toEqual([]);
  });
});

/// Reasoning effort, added at version 12.
///
/// The schema defaults both fields, so an old file would load either way. The version exists for the
/// OTHER direction, as with versions 6 and 10: `ChatProfileSchema` is strict, so a file written here
/// and read by the previous build would fail to parse and take every configured model with it.
describe("thinking on a profile", () => {
  const v11 = {
    schemaVersion: 11,
    panels: { workspaceWidth: 326, chatWidth: 348, workspaceCollapsed: false, chatCollapsed: true },
    lastWorkspace: "D:/Notes",
    appearance: { theme: "dark" as const },
    window: { closeToTray: true },
    fileTypes: { enabled: ["markdown"] },
    chat: {
      systemPrompt: null,
      folderFileLimit: 40,
      showPanel: null,
      profiles: [
        {
          id: "one",
          label: "Local model",
          endpoint: "http://localhost:11434/v1",
          model: "gpt-oss:20b",
          contextWindow: null,
          supportsImages: false,
          supportsTools: false,
          thinking: false,
          reasoningEffort: "medium" as const,
          isDefault: true,
        },
      ],
    },
    editor: { defaultViewMode: "live" as const },
  };

  // Off, because a model configured before this existed was answering perfectly well without it -
  // and `reasoning_effort` is a field a server that has never heard of it may reject outright.
  it("leaves thinking off for a model configured before it existed", () => {
    expect(loadSettings(v11).chat.profiles[0]?.thinking).toBe(false);
  });

  // A level is still stored while thinking is off, so turning it on does not ask the user to choose
  // one before they can see what it does.
  it("gives it a level to use when it is turned on", () => {
    expect(loadSettings(v11).chat.profiles[0]?.reasoningEffort).toBe("medium");
  });

  it("keeps everything version 11 stored", () => {
    const migrated = loadSettings(v11);
    expect(migrated.chat.profiles[0]?.label).toBe("Local model");
    expect(migrated.fileTypes.enabled).toEqual(["markdown"]);
    expect(migrated.schemaVersion).toBe(SETTINGS_VERSION);
  });

  it("keeps a level the user has chosen", () => {
    const chosen = {
      ...v11,
      schemaVersion: 12,
      chat: {
        ...v11.chat,
        profiles: [{ ...v11.chat.profiles[0], thinking: true, reasoningEffort: "high" }],
      },
    };
    expect(loadSettings(chosen).chat.profiles[0]?.reasoningEffort).toBe("high");
    expect(loadSettings(chosen).chat.profiles[0]?.thinking).toBe(true);
  });
});
