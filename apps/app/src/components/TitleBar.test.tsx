import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TitleBar from "./TitleBar";
import { APP_VERSION } from "../lib/appInfo";

const noop = () => {};

/// Menus the title bar asked the shell to open.
///
/// The bridge is absent in jsdom, so `windowControls()` falls back to the browser stub. This stands
/// one in, and is what lets the click be checked without a shell.
const popped: { menu: string; x: number; y: number }[] = [];

beforeEach(() => {
  popped.length = 0;
  (window as unknown as { trypthos?: unknown }).trypthos = {
    onWindowState: () => () => {},
    onMenuAction: () => () => {},
    popupMenu: async (menu: string, x: number, y: number) => {
      popped.push({ menu, x, y });
    },
  };
});

afterEach(() => {
  delete (window as unknown as { trypthos?: unknown }).trypthos;
});

describe("TitleBar", () => {
  it("shows the app name alone when no file is open", () => {
    render(<TitleBar platform="win32" fileName={null} onAbout={noop} onPreferences={noop} />);
    expect(screen.getByText("Trypthos")).toBeDefined();
  });

  it("names the open file, separated by a plain hyphen", () => {
    render(<TitleBar platform="win32" fileName="README.md" onAbout={noop} onPreferences={noop} />);
    const title = screen.getByText(/README\.md/).textContent ?? "";

    expect(title).toBe("Trypthos - README.md");
    // The design uses an em dash here; the project bans them in user-facing text.
    expect(title).not.toContain(String.fromCharCode(0x2014));
  });

  it("carries About, since there is no in-app header any more", async () => {
    const onAbout = vi.fn();
    const user = userEvent.setup();
    render(<TitleBar platform="win32" fileName={null} onAbout={onAbout} onPreferences={noop} />);

    await user.click(screen.getByRole("button", { name: `About ${APP_VERSION}` }));
    expect(onAbout).toHaveBeenCalledOnce();
  });

  // Distinct from the About dialog's "Close": two buttons with the same accessible name in one
  // window are indistinguishable to a screen reader, and one of these quits the app.
  it("carries Preferences too", async () => {
    const onPreferences = vi.fn();
    const user = userEvent.setup();
    render(<TitleBar platform="win32" fileName={null} onAbout={noop} onPreferences={onPreferences} />);

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    expect(onPreferences).toHaveBeenCalledOnce();
  });

  // Distinct from the About dialog's "Close": two buttons with the same accessible name in one
  // window are indistinguishable to a screen reader, and one of these quits the app.
  it("draws window controls on Windows", () => {
    render(<TitleBar platform="win32" fileName={null} onAbout={noop} onPreferences={noop} />);
    expect(screen.getByRole("button", { name: "Minimise window" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Maximise window" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Close window" })).toBeDefined();
  });

  // macOS draws its own traffic lights over the window. A second set beside them would be wrong, and
  // this is the assertion that stops somebody "simplifying" the platform branch away.
  it("draws no window controls on macOS", () => {
    render(<TitleBar platform="darwin" fileName={null} onAbout={noop} onPreferences={noop} />);
    expect(screen.queryByRole("button", { name: "Close window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimise window" })).toBeNull();
  });

  it("reserves room for the traffic lights on macOS, and none elsewhere", () => {
    const { container: mac } = render(<TitleBar platform="darwin" fileName={null} onAbout={noop} onPreferences={noop} />);
    expect((mac.querySelector("header") as HTMLElement).style.paddingLeft).toBe("80px");

    const { container: win } = render(<TitleBar platform="win32" fileName={null} onAbout={noop} onPreferences={noop} />);
    expect((win.querySelector("header") as HTMLElement).style.paddingLeft).toBe("0px");
  });

  // A frameless window that cannot be dragged cannot be moved at all - there is no OS chrome left to
  // grab. The controls must opt back out, or they cannot be clicked.
  //
  // Asserted on the classes rather than the computed property: jsdom drops -webkit-app-region
  // silently, so a style assertion would pass whether or not it was ever applied.
  it("makes the bar draggable and its controls clickable", () => {
    const { container } = render(<TitleBar platform="win32" fileName={null} onAbout={noop} onPreferences={noop} />);

    const header = container.querySelector("header") as HTMLElement;
    expect(header.classList.contains("app-drag")).toBe(true);

    const controls = container.querySelector("header > div") as HTMLElement;
    expect(controls.classList.contains("app-no-drag")).toBe(true);
  });
});

/// The menu bar.
///
/// The window is frameless, so there is nowhere for Electron to draw a menu bar on Windows. These
/// labels are drawn here instead, and clicking one asks the shell to open a real native menu under
/// it - which is why nothing below asserts on menu CONTENTS. What is on each menu is decided in the
/// main process, and tested there.
describe("TitleBar: the menu bar", () => {
  const bar = (platform: "win32" | "darwin" | "linux") =>
    render(<TitleBar platform={platform} fileName={null} onAbout={noop} onPreferences={noop} />);

  it("draws the four menus on Windows", () => {
    bar("win32");
    for (const label of ["File", "Edit", "Tools", "Help"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  // macOS puts the application menu in the system menu bar at the top of the screen. A second one
  // inside the window would be wrong on that platform in a way no user would forgive.
  it("draws no menus on macOS, where the system menu bar has them", () => {
    bar("darwin");
    expect(screen.queryByRole("button", { name: "File" })).toBeNull();
  });

  it("asks the shell to open the menu that was clicked", async () => {
    const user = userEvent.setup();
    bar("win32");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(popped.at(-1)?.menu).toBe("edit");
  });

  // Under the label, not at the pointer: a menu bar's menus hang off the label whether it was
  // clicked at its left edge or its right.
  it("opens the menu under the label rather than at the pointer", async () => {
    const user = userEvent.setup();
    bar("win32");

    await user.click(screen.getByRole("button", { name: "File" }));
    const opened = popped.at(-1)!;
    expect(typeof opened.x).toBe("number");
    expect(typeof opened.y).toBe("number");
    expect(Number.isInteger(opened.x)).toBe(true);
    expect(Number.isInteger(opened.y)).toBe(true);
  });
});
