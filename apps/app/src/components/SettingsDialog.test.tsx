import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, type Settings } from "@trypthos/domain";
import SettingsDialog from "./SettingsDialog";
import { APP_VERSION, DISCLAIMERS } from "../lib/appInfo";

/// Opened on a page, the way the app opens it: the title bar opens Appearance, the Help menu opens
/// About, and the chat panel's Configure opens Chat models. Navigation inside the dialog is the
/// dialog's own business, so tests click the rail rather than driving a controlled prop.
function dialog(overrides: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) {
  const props = {
    openOn: "appearance" as const,
    settings: DEFAULT_SETTINGS as Settings,
    isDesktop: true,
    keyedEndpoints: [] as string[],
    onClose: vi.fn(),
    onChange: vi.fn(),
    onSaveKey: vi.fn(async () => ({ ok: true }) as const),
    onDeleteKey: vi.fn(async () => {}),
    ...overrides,
  };
  render(<SettingsDialog {...props} />);
  return props;
}

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  supportsImages: false,
  supportsTools: false,
  isDefault: true,
};

const withProfile = (settings: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] },
  ...settings,
});

const railItem = (name: string) => screen.getByRole("button", { name });

const goTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(railItem(name));
};

describe("SettingsDialog: the rail", () => {
  it("opens on the page it was asked for", () => {
    dialog({ openOn: "about" });
    expect(screen.getByRole("heading", { name: "About" })).toBeDefined();
  });

  it("switches page when a rail item is chosen", async () => {
    const user = userEvent.setup();
    dialog();

    await goTo(user, "Editor");
    expect(screen.getByRole("heading", { name: "Editor" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "System" })).toBeNull();
  });

  // Which page you are on, for a screen reader as well as for the eye - the rail is the only thing
  // that says so once the content has swapped.
  it("marks the page currently open", async () => {
    const user = userEvent.setup();
    dialog();

    expect(railItem("Appearance").getAttribute("aria-current")).toBe("page");

    await goTo(user, "Window");
    expect(railItem("Window").getAttribute("aria-current")).toBe("page");
    expect(railItem("Appearance").getAttribute("aria-current")).toBeNull();
  });

  // The browser preview has no tray to close to, so the page would be one control that does nothing.
  it("leaves Window out of the rail outside the desktop app", () => {
    dialog({ isDesktop: false });
    expect(screen.queryByRole("button", { name: "Window" })).toBeNull();
    expect(railItem("Appearance")).toBeDefined();
  });

  it("closes", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  // A near-fullscreen dialog covers the app, so the way out has to be where a hand already is.
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

/// The models listed under Chat models in the rail.
///
/// Only while that page is open: they are a way around one page, not a permanent second list.
describe("SettingsDialog: the model sub-rail", () => {
  it("lists the configured models while Chat models is open", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile() });

    expect(screen.queryByRole("button", { name: /Edit Local model/ })).toBeNull();

    await goTo(user, "Chat models");
    expect(screen.getAllByRole("button", { name: /Edit Local model/ }).length).toBeGreaterThan(0);
  });

  it("hides them again when another page is opened", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile(), openOn: "chatModels" });

    await goTo(user, "Appearance");
    expect(screen.queryByRole("button", { name: /Edit Local model/ })).toBeNull();
  });

  // Opening another page abandons a half-typed model, matching the form's own Cancel.
  it("abandons an unsaved model when the page is left", async () => {
    const user = userEvent.setup();
    const props = dialog({ openOn: "chatModels" });

    await user.click(screen.getByRole("button", { name: "Add a model" }));
    await user.type(screen.getByLabelText("Name"), "Half a model");
    await goTo(user, "Appearance");
    await goTo(user, "Chat models");

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("SettingsDialog: appearance", () => {
  it("offers the three theme choices, with the current one pressed", () => {
    dialog();
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Dark" })).toBeDefined();
  });

  // Applied immediately: each setting is one value that takes effect as soon as it is chosen, so a
  // confirm step would only add a way to lose the change you just made.
  it("applies a theme choice straight away", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(props.onChange).toHaveBeenCalledWith({ appearance: { theme: "dark" } });
  });

  it("explains what the chosen theme means", () => {
    dialog({ settings: { ...DEFAULT_SETTINGS, appearance: { theme: "light" } } });
    expect(screen.getByText(/Always light/)).toBeDefined();
  });
});

describe("SettingsDialog: window", () => {
  it("toggles close to tray", async () => {
    const user = userEvent.setup();
    const props = dialog({ openOn: "window" });

    await user.click(screen.getByRole("checkbox", { name: /Keep running/ }));
    expect(props.onChange).toHaveBeenCalledWith({ window: { closeToTray: true } });
  });
});

describe("SettingsDialog: the editor page", () => {
  it("offers the three view modes, with the configured one pressed", () => {
    dialog({ openOn: "editor" });
    expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Source" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Preview" })).toBeDefined();
  });

  it("applies a view choice straight away", async () => {
    const user = userEvent.setup();
    const props = dialog({ openOn: "editor" });

    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(props.onChange).toHaveBeenCalledWith({ editor: { defaultViewMode: "source" } });
  });

  // The same wording the editor's own status bar uses for the mode, rather than a second
  // description of the same thing that can drift from it.
  it("explains what the chosen view means", () => {
    dialog({
      openOn: "editor",
      settings: { ...DEFAULT_SETTINGS, editor: { defaultViewMode: "preview" } },
    });
    expect(screen.getByText(/Read-only rendered prose/)).toBeDefined();
  });
});

/// The chat model page.
///
/// Profiles are edited in a form with a Save, unlike every other setting here, because a profile is
/// several fields that are only valid together - and because saving settings sweeps API keys for
/// endpoints no profile references, so applying each keystroke would delete the user's key partway
/// through typing an endpoint.
describe("SettingsDialog: chat models", () => {
  const models = (overrides: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) =>
    dialog({ openOn: "chatModels", ...overrides });

  it("says what to do when nothing is configured yet", () => {
    models();
    expect(screen.getByText(/No models configured/)).toBeDefined();
  });

  // The label is what the user reads and the slug is what the endpoint receives. Showing only one
  // makes the other unknowable, and conflating them is the bug the two fields exist to prevent.
  it("lists a configured model by its label and its slug", () => {
    models({ settings: withProfile() });
    expect(screen.getAllByText("Local model").length).toBeGreaterThan(0);
    expect(screen.getByText("qwen2.5-coder")).toBeDefined();
  });

  it("marks which model new chats start on", () => {
    models({ settings: withProfile() });
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
  });

  it("adds a model, and saves it only once it is complete", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    models({ onChange });

    await user.click(screen.getByRole("button", { name: "Add a model" }));
    await user.type(screen.getByLabelText("Name"), "Local model");
    await user.type(screen.getByLabelText("Endpoint"), "http://localhost:11434/v1");
    await user.type(screen.getByLabelText("Model"), "qwen2.5-coder");
    await user.click(screen.getByRole("button", { name: "Save model" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0]![0] as Partial<Settings>;
    expect(saved.chat?.profiles[0]).toMatchObject({
      label: "Local model",
      endpoint: "http://localhost:11434/v1",
      model: "qwen2.5-coder",
    });
  });

  // The first model configured is the one every chat would otherwise have to be pointed at by hand.
  it("makes the first model the default without being asked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    models({ onChange });

    await user.click(screen.getByRole("button", { name: "Add a model" }));
    await user.type(screen.getByLabelText("Name"), "Local model");
    await user.type(screen.getByLabelText("Endpoint"), "http://localhost:11434/v1");
    await user.type(screen.getByLabelText("Model"), "qwen2.5-coder");
    await user.click(screen.getByRole("button", { name: "Save model" }));

    const saved = onChange.mock.calls[0]![0] as Partial<Settings>;
    expect(saved.chat?.profiles[0]?.isDefault).toBe(true);
  });

  it("refuses to save an incomplete model, and says which fields are wrong", async () => {
    const user = userEvent.setup();
    const props = models();

    await user.click(screen.getByRole("button", { name: "Add a model" }));
    await user.type(screen.getByLabelText("Name"), "Half a model");
    await user.click(screen.getByRole("button", { name: "Save model" }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Endpoint").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Model").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("false");
  });

  it("abandons an edit on cancel", async () => {
    const user = userEvent.setup();
    const props = models({ settings: withProfile() });

    await user.click(screen.getAllByRole("button", { name: /Edit Local model/ })[0]!);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getAllByText("Local model").length).toBeGreaterThan(0);
  });

  it("removes a model", async () => {
    const user = userEvent.setup();
    const props = models({ settings: withProfile() });

    await user.click(screen.getAllByRole("button", { name: /Edit Local model/ })[0]!);
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(props.onChange).toHaveBeenCalledWith({
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [] },
    });
  });
});

/// Whether the chat panel is in the window at all.
///
/// It lives on this page because it is the same decision as configuring a model: until there is one,
/// there is nothing for the panel to do.
describe("SettingsDialog: showing the chat panel", () => {
  it("reads as on once a model is configured", () => {
    dialog({ openOn: "chatModels", settings: withProfile() });
    const box = screen.getByRole("checkbox", { name: /Show the chat panel/ });
    expect((box as HTMLInputElement).checked).toBe(true);
  });

  it("reads as off while no model is configured", () => {
    dialog({ openOn: "chatModels" });
    const box = screen.getByRole("checkbox", { name: /Show the chat panel/ });
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  // The form is what the page is about while it is open; the switch is a property of the panel, and
  // reading it above a half-filled endpoint field is noise.
  it("stays out of the way while a model is being edited", async () => {
    const user = userEvent.setup();
    dialog({ openOn: "chatModels", settings: withProfile() });

    await user.click(screen.getAllByRole("button", { name: /Edit Local model/ })[0]!);

    expect(screen.queryByRole("checkbox", { name: /Show the chat panel/ })).toBeNull();
  });

  it("stores an explicit no when it is turned off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    dialog({ openOn: "chatModels", settings: withProfile(), onChange });

    await user.click(screen.getByRole("checkbox", { name: /Show the chat panel/ }));

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.showPanel).toBe(false);
  });

  it("stores an explicit yes when it is turned on with no model configured", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    dialog({ openOn: "chatModels", onChange });

    await user.click(screen.getByRole("checkbox", { name: /Show the chat panel/ }));

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.showPanel).toBe(true);
  });

  // Every write to the chat section carries the rest of it forward, or turning the panel off would
  // take the configured models with it.
  it("keeps the configured models when it is toggled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    dialog({ openOn: "chatModels", settings: withProfile(), onChange });

    await user.click(screen.getByRole("checkbox", { name: /Show the chat panel/ }));

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.profiles).toHaveLength(1);
  });
});

/// The API key field.
///
/// The renderer never holds a key. It is told which ENDPOINTS have one, and it sends new ones one
/// way - so every test here is about what the interface can say without knowing the value.
describe("SettingsDialog: API keys", () => {
  const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getAllByRole("button", { name: /Edit Local model/ })[0]!);
  };

  const keys = (overrides: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) =>
    dialog({ openOn: "chatModels", settings: withProfile(), ...overrides });

  it("says no key is stored for an endpoint that has none", async () => {
    const user = userEvent.setup();
    keys();
    await openEditor(user);

    expect(screen.getByText("No key stored")).toBeDefined();
  });

  it("says a key is stored, without showing it", async () => {
    const user = userEvent.setup();
    keys({ keyedEndpoints: ["http://localhost:11434/v1"] });
    await openEditor(user);

    expect(screen.getByText("Key stored")).toBeDefined();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  // A password input keeps the key out of a screen share and out of a screenshot, which is how most
  // people would first show someone else their settings.
  it("never renders the key as readable text", async () => {
    const user = userEvent.setup();
    keys();
    await openEditor(user);

    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
  });

  it("sends a pasted key to the shell for the endpoint being edited", async () => {
    const user = userEvent.setup();
    const props = keys();
    await openEditor(user);

    await user.type(screen.getByLabelText("API key"), "sk-test-do-not-use-90210");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(props.onSaveKey).toHaveBeenCalledWith(
      "http://localhost:11434/v1",
      "sk-test-do-not-use-90210",
    );
  });

  // The store refuses rather than writing plaintext, so the user has to be told - a silent success
  // would show "Key stored" against a key no request can use.
  it("reports a key that could not be stored", async () => {
    const user = userEvent.setup();
    keys({ onSaveKey: vi.fn(async () => ({ ok: false, reason: "encryption-unavailable" }) as const) });
    await openEditor(user);

    await user.type(screen.getByLabelText("API key"), "sk-test-do-not-use-90210");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText(/could not be stored securely/)).toBeDefined();
  });

  it("clears the field once the key is stored, so it is not left on screen", async () => {
    const user = userEvent.setup();
    keys();
    await openEditor(user);

    const field = screen.getByLabelText("API key") as HTMLInputElement;
    await user.type(field, "sk-test-do-not-use-90210");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(field.value).toBe(""));
  });

  it("removes a stored key", async () => {
    const user = userEvent.setup();
    const props = keys({ keyedEndpoints: ["http://localhost:11434/v1"] });
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Remove key" }));
    expect(props.onDeleteKey).toHaveBeenCalledWith("http://localhost:11434/v1");
  });

  it("offers nothing to remove when no key is stored", async () => {
    const user = userEvent.setup();
    keys();
    await openEditor(user);

    expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
  });
});

/// The AI page.
///
/// Split out of the model list because it governs what the model is told, not which model answers.
describe("SettingsDialog: AI and the system prompt", () => {
  const ai = (overrides: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) =>
    dialog({ openOn: "ai", ...overrides });

  it("shows the prompt in full, so it can be read before it is changed", () => {
    ai();
    const box = screen.getByLabelText("System prompt") as HTMLTextAreaElement;
    expect(box.value).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  // Unset means "the current default", so the box shows that text rather than nothing. An empty box
  // would read as "no prompt is being sent", which is a different setting entirely.
  it("shows the default text when no prompt has been set", () => {
    ai({
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, systemPrompt: null } },
    });
    expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe(
      DEFAULT_SYSTEM_PROMPT,
    );
  });

  // Driven through a stateful wrapper, the way App drives it. The dialog is controlled, so a test
  // holding `settings` fixed would feed every keystroke back the same stale text - and would report
  // a passing edit of one character while claiming to have typed a sentence.
  it("saves an edited prompt", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [settings, setSettings] = useState<Settings>({
        ...DEFAULT_SETTINGS,
        chat: { ...DEFAULT_SETTINGS.chat, systemPrompt: "Old" },
      });
      return (
        <SettingsDialog
          openOn="ai"
          settings={settings}
          isDesktop
          keyedEndpoints={[]}
          onClose={vi.fn()}
          onChange={(change) => setSettings((current) => ({ ...current, ...change }))}
          onSaveKey={vi.fn(async () => ({ ok: true }) as const)}
          onDeleteKey={vi.fn(async () => {})}
        />
      );
    }

    render(<Harness />);
    const box = screen.getByLabelText("System prompt") as HTMLTextAreaElement;
    await user.clear(box);
    await user.type(box, "Be terse.");

    expect(box.value).toBe("Be terse.");
  });

  // A prompt is one field, so it applies as it is typed like every other setting here. Profiles are
  // the exception, and only because they are several fields that are valid only together.
  it("keeps the configured models when the prompt changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    ai({ settings: withProfile(), onChange });

    await user.type(screen.getByLabelText("System prompt"), "!");

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.profiles).toHaveLength(1);
  });

  // Back to null, not to a copy of the current text. A copy would stop tracking the default the
  // moment the default next changed, which is the bug this behaviour exists to prevent.
  it("puts the default back by unsetting the prompt", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    ai({
      settings: {
        ...DEFAULT_SETTINGS,
        chat: { ...DEFAULT_SETTINGS.chat, systemPrompt: "Something else" },
      },
      onChange,
    });

    await user.click(screen.getByRole("button", { name: "Reset to the default" }));

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.systemPrompt).toBeNull();
  });

  it("offers no reset when the prompt is unset", () => {
    ai();
    expect(screen.queryByRole("button", { name: "Reset to the default" })).toBeNull();
  });

  // The state an upgraded installation was left in: a stored copy of an older default. It is not
  // the default any more, so the way back has to be offered.
  it("offers the reset when a stored prompt has gone stale", () => {
    ai({
      settings: {
        ...DEFAULT_SETTINGS,
        chat: { ...DEFAULT_SETTINGS.chat, systemPrompt: "An older default" },
      },
    });
    expect(screen.getByRole("button", { name: "Reset to the default" })).toBeDefined();
  });

  // Clearing it is a legitimate choice - some endpoints are already configured with their own
  // prompt - so it must be possible without the app putting one back.
  it("allows an empty prompt", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    ai({
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, systemPrompt: "Old" } },
      onChange,
    });

    await user.clear(screen.getByLabelText("System prompt"));

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.systemPrompt).toBe("");
  });

  it("sets how many folder files the model is offered", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    ai({
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, folderFileLimit: 1 } },
      onChange,
    });

    await user.type(screen.getByLabelText(/Files offered from the folder/), "2");

    const last = onChange.mock.calls.at(-1)![0] as Partial<Settings>;
    expect(last.chat?.folderFileLimit).toBe(12);
  });

  // The schema refuses a number outside the range, and a rejected write would lose the rest of the
  // change it travelled with - so a nonsense box is ignored rather than stored.
  it("ignores a folder file count outside the range", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    ai({
      settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, folderFileLimit: 25 } },
      onChange,
    });

    await user.type(screen.getByLabelText(/Files offered from the folder/), "0");

    expect(onChange).not.toHaveBeenCalled();
  });
});

/// About, which is now a page here rather than a modal of its own.
///
/// It reads `appInfo`, the same module the README's feature table is kept in step with, so there is
/// one statement of what the app does rather than two that can disagree.
describe("SettingsDialog: about", () => {
  const about = () => dialog({ openOn: "about" });

  it("names the app and its version", () => {
    about();
    expect(screen.getAllByText("Trypthos").length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(APP_VERSION))).toBeDefined();
  });

  it("lists the third-party disclaimers", () => {
    about();
    expect(screen.getByText(DISCLAIMERS[0]!)).toBeDefined();
  });

  it("renders the capability summary as a table rather than as its source", () => {
    about();

    const table = screen.getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(3);
    expect(screen.getByRole("columnheader", { name: "Feature" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeDefined();
  });

  it("shows a feature and its description in one row", () => {
    about();
    const row = screen.getByRole("cell", { name: "Markdown editor" }).closest("tr");
    expect(row?.textContent).toMatch(/Live, Source and Preview/);
  });

  // The symptom, stated directly: no pipe characters and no separator row anywhere on screen.
  it("shows none of the markdown that produced it", () => {
    about();
    const shown = screen.getByRole("dialog").textContent ?? "";

    expect(shown).not.toContain("| ---");
    expect(shown).not.toContain("| Feature |");
  });
});
