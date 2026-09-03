import { describe, expect, it } from "vitest";
import { titleBarLayout, windowTitle } from "./windowChrome";

describe("titleBarLayout", () => {
  // The same reasoning as the window controls: both processes read this, and if they disagreed the
  // window would have two menu bars or none.
  it("draws its own menu bar on Windows, where a frameless window has no frame to hold one", () => {
    expect(titleBarLayout("win32").drawsMenuBar).toBe(true);
    expect(titleBarLayout("linux").drawsMenuBar).toBe(true);
  });

  it("leaves the menu to the system menu bar on macOS", () => {
    expect(titleBarLayout("darwin").drawsMenuBar).toBe(false);
  });

  it("draws its own controls on Windows and Linux", () => {
    expect(titleBarLayout("win32").drawsWindowControls).toBe(true);
    expect(titleBarLayout("linux").drawsWindowControls).toBe(true);
  });

  it("leaves the controls to macOS, which draws traffic lights over the window", () => {
    expect(titleBarLayout("darwin").drawsWindowControls).toBe(false);
  });

  // Without the inset the app icon and file name render underneath the traffic lights - unreadable,
  // and only on macOS, so it is invisible to anyone developing on Windows.
  it("reserves room for the traffic lights on macOS only", () => {
    expect(titleBarLayout("darwin").leadingInset).toBeGreaterThan(0);
    expect(titleBarLayout("win32").leadingInset).toBe(0);
    expect(titleBarLayout("linux").leadingInset).toBe(0);
  });

  // Exactly one set of controls must exist on every platform. Neither is survivable: two is wrong,
  // and none leaves a frameless window that cannot be closed from inside the app.
  it("never leaves a platform with both sets or neither", () => {
    const platforms = ["win32", "darwin", "linux"] as const;
    for (const platform of platforms) {
      const layout = titleBarLayout(platform);
      const osDraws = layout.leadingInset > 0;
      expect(layout.drawsWindowControls).toBe(!osDraws);
    }
  });
});

describe("windowTitle", () => {
  it("is the app name alone when no file is open", () => {
    expect(windowTitle("Trypthos", null)).toBe("Trypthos");
  });

  it("names the open file", () => {
    expect(windowTitle("Trypthos", "README.md")).toBe("Trypthos - README.md");
  });

  // The design specifies an em dash here. The project bans them in user-facing text, and the guard
  // test fails the build on one - so the separator is a plain hyphen, deliberately.
  it("separates with a plain hyphen, never an em or en dash", () => {
    const title = windowTitle("Trypthos", "README.md");
    expect(title).not.toContain(String.fromCharCode(0x2014));
    expect(title).not.toContain(String.fromCharCode(0x2013));
  });
});
