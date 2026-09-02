import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";
import PreferencesDialog from "./PreferencesDialog";

function dialog(overrides: Partial<React.ComponentProps<typeof PreferencesDialog>> = {}) {
  const props = {
    open: true,
    settings: DEFAULT_SETTINGS as Settings,
    isDesktop: true,
    keyedEndpoints: [] as string[],
    onClose: vi.fn(),
    onChange: vi.fn(),
    onSaveKey: vi.fn(async () => ({ ok: true }) as const),
    onDeleteKey: vi.fn(async () => {}),
    ...overrides,
  };
  render(<PreferencesDialog {...props} />);
  return props;
}

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  supportsImages: false,
  isDefault: true,
};

const withProfile = (settings: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  chat: { profiles: [PROFILE] },
  ...settings,
});

describe("PreferencesDialog", () => {
  it("renders nothing when closed", () => {
    dialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

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

  it("toggles close to tray", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.click(screen.getByRole("checkbox", { name: /Keep running/ }));
    expect(props.onChange).toHaveBeenCalledWith({ window: { closeToTray: true } });
  });

  // The browser preview has no tray to close to, and nothing that would remember the preference.
  it("hides the window section outside the desktop app", () => {
    dialog({ isDesktop: false });
    expect(screen.queryByRole("checkbox", { name: /Keep running/ })).toBeNull();
    expect(screen.getByRole("button", { name: "System" })).toBeDefined();
  });

  it("closes on Done", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

/// The chat model section.
///
/// Profiles are edited in a form with a Save, unlike every other preference here, because a profile
/// is several fields that are only valid together - and because saving settings sweeps API keys for
/// endpoints no profile references, so applying each keystroke would delete the user's key partway
/// through typing an endpoint.
describe("PreferencesDialog: chat models", () => {
  it("says what to do when nothing is configured yet", () => {
    dialog();
    expect(screen.getByText(/No models configured/)).toBeDefined();
  });

  // The label is what the user reads and the slug is what the endpoint receives. Showing only one
  // makes the other unknowable, and conflating them is the bug the two fields exist to prevent.
  it("lists a configured model by its label and its slug", () => {
    dialog({ settings: withProfile() });
    expect(screen.getByText("Local model")).toBeDefined();
    expect(screen.getByText("qwen2.5-coder")).toBeDefined();
  });

  it("marks which model new chats start on", () => {
    dialog({ settings: withProfile() });
    expect(screen.getByText("Default")).toBeDefined();
  });

  it("adds a model, and saves it only once it is complete", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    dialog({ onChange });

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
    dialog({ onChange });

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
    const props = dialog();

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
    const props = dialog({ settings: withProfile() });

    await user.click(screen.getByRole("button", { name: "Edit Local model" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Local model")).toBeDefined();
  });

  it("removes a model", async () => {
    const user = userEvent.setup();
    const props = dialog({ settings: withProfile() });

    await user.click(screen.getByRole("button", { name: "Edit Local model" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(props.onChange).toHaveBeenCalledWith({ chat: { profiles: [] } });
  });
});

/// The API key field.
///
/// The renderer never holds a key. It is told which ENDPOINTS have one, and it sends new ones one
/// way - so every test here is about what the interface can say without knowing the value.
describe("PreferencesDialog: API keys", () => {
  const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Edit Local model" }));
  };

  it("says no key is stored for an endpoint that has none", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile() });
    await openEditor(user);

    expect(screen.getByText("No key stored")).toBeDefined();
  });

  it("says a key is stored, without showing it", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile(), keyedEndpoints: ["http://localhost:11434/v1"] });
    await openEditor(user);

    expect(screen.getByText("Key stored")).toBeDefined();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  // A password input keeps the key out of a screen share and out of a screenshot, which is how most
  // people would first show someone else their settings.
  it("never renders the key as readable text", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile() });
    await openEditor(user);

    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
  });

  it("sends a pasted key to the shell for the endpoint being edited", async () => {
    const user = userEvent.setup();
    const props = dialog({ settings: withProfile() });
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
    dialog({
      settings: withProfile(),
      onSaveKey: vi.fn(async () => ({ ok: false, reason: "encryption-unavailable" }) as const),
    });
    await openEditor(user);

    await user.type(screen.getByLabelText("API key"), "sk-test-do-not-use-90210");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText(/could not be stored securely/)).toBeDefined();
  });

  it("clears the field once the key is stored, so it is not left on screen", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile() });
    await openEditor(user);

    const field = screen.getByLabelText("API key") as HTMLInputElement;
    await user.type(field, "sk-test-do-not-use-90210");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(field.value).toBe(""));
  });

  it("removes a stored key", async () => {
    const user = userEvent.setup();
    const props = dialog({
      settings: withProfile(),
      keyedEndpoints: ["http://localhost:11434/v1"],
    });
    await openEditor(user);

    await user.click(screen.getByRole("button", { name: "Remove key" }));
    expect(props.onDeleteKey).toHaveBeenCalledWith("http://localhost:11434/v1");
  });

  it("offers nothing to remove when no key is stored", async () => {
    const user = userEvent.setup();
    dialog({ settings: withProfile() });
    await openEditor(user);

    expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
  });
});
