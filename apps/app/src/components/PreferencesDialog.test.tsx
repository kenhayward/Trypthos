import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";
import PreferencesDialog from "./PreferencesDialog";

function dialog(overrides: Partial<React.ComponentProps<typeof PreferencesDialog>> = {}) {
  const props = {
    open: true,
    settings: DEFAULT_SETTINGS as Settings,
    isDesktop: true,
    onClose: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
  render(<PreferencesDialog {...props} />);
  return props;
}

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

    await user.click(screen.getByRole("checkbox"));
    expect(props.onChange).toHaveBeenCalledWith({ window: { closeToTray: true } });
  });

  // The browser preview has no tray to close to, and nothing that would remember the preference.
  it("hides the window section outside the desktop app", () => {
    dialog({ isDesktop: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "System" })).toBeDefined();
  });

  it("closes on Done", async () => {
    const user = userEvent.setup();
    const props = dialog();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
