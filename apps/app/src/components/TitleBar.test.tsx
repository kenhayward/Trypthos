import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TitleBar from "./TitleBar";
import { APP_VERSION } from "../lib/appInfo";

const noop = () => {};

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
