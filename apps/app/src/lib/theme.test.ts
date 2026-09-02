import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, themeAttribute } from "./theme";

describe("resolveTheme", () => {
  it("follows the OS when no choice has been made", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  // Both directions, because only one of them is expressible in a media query. A light choice on a
  // dark OS is the case that gets missed, and the symptom is an app that ignores the setting.
  it("honours an explicit choice against the OS, in both directions", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("themeAttribute", () => {
  // Nothing is stamped for "system" so the stylesheet's media query keeps tracking the OS while the
  // app is open. Stamping a resolved value would freeze the theme at whatever it was on launch.
  it("stamps nothing when following the system", () => {
    expect(themeAttribute("system")).toBeNull();
  });

  it("stamps an explicit choice", () => {
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("light")).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("accepts the three states", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
  });

  // A stored preference is input like any other: it can be from an older build, hand-edited, or
  // absent entirely.
  it("rejects anything else, including a resolved-looking value", () => {
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});
