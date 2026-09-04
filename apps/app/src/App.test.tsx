import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@trypthos/domain";
import App from "./App";
import { APP_VERSION } from "./lib/appInfo";
import { browserClient } from "./lib/workspaceClient";

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  contextWindow: null,
  supportsImages: false,
  supportsTools: false,
  isDefault: true,
};

/// A shell that answers for settings and nothing else.
///
/// Every other half of the bridge asks for a method of its own before it will build, so this leaves
/// chat, keys and history exactly as the browser preview has them - which is all these need. The
/// workspace calls come from the browser client, which answers "not-desktop" rather than throwing.
function shellWithSettings(settings: Settings): void {
  window.trypthos = {
    ...browserClient,
    readSettings: async () => ({ ok: true as const, settings }),
    writeSettings: async () => {},
  } as unknown as typeof window.trypthos;
}

afterEach(() => {
  delete window.trypthos;
});

describe("App", () => {
  // The chat panel is not among them until a model is configured: with none, it could only tell the
  // user to go and configure one, and the way to do that is Settings.
  it("renders the workspace and the editor", () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Editor" })).toBeDefined();
  });

  it("leaves the chat panel out until a model is configured", () => {
    render(<App />);
    expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull();
    // Not collapsed either. A rail is a panel someone hid, and this one was never there.
    expect(screen.queryByRole("button", { name: "Show the chat panel" })).toBeNull();
  });

  it("renders all three panels once a model is configured", async () => {
    shellWithSettings({
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE] },
    });
    render(<App />);

    expect(await screen.findByRole("complementary", { name: "Chat" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Editor" })).toBeDefined();
  });

  // An explicit no wins over a configured model: somebody who wants a plain editor means it.
  it("leaves the chat panel out when it has been switched off", async () => {
    shellWithSettings({
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, profiles: [PROFILE], showPanel: false },
    });
    render(<App />);

    expect(await screen.findByRole("main", { name: "Editor" })).toBeDefined();
    expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull();
  });

  it("shows the build version, which comes from /version.json", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: `About ${APP_VERSION}` })).toBeDefined();
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // About is a page of the settings dialog rather than a modal of its own, so the title bar opens
  // settings there. One About surface, and nothing that can drift from it.
  it("opens settings on About, and closes it", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();

    // Resolve the element first, then act on it. Awaiting a query inside an act scope is what
    // provokes React's "not configured to support act" warning, which test-setup turns into a failure.
    await user.click(screen.getByRole("button", { name: `About ${APP_VERSION}` }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "About" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Two entry points, one dialog: the gear opens the settings themselves rather than About.
  it("opens settings on Appearance from the title bar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
  });
});
