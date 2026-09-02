/// Which set of colours the interface is painted in.
///
/// Three states, not two - and the third is the one that gets forgotten. "system" means no choice has
/// been made, and the OS answers; it is the default, so it is what most people are actually in.
export type ThemePreference = "system" | "light" | "dark";

/// The theme actually painted, once a preference has met the OS.
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/// Resolves a preference against what the OS reports.
///
/// Pure, and separated from the DOM because this is the part with the actual rule in it: an explicit
/// choice wins in BOTH directions. A light choice on a dark OS must stay light, which is the case a
/// `prefers-color-scheme` media query alone cannot express.
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/// What to stamp on the root element, or null to stamp nothing.
///
/// Nothing is stamped for "system", deliberately. The stylesheet's media query then does the work, so
/// the theme keeps tracking the OS if it changes while the app is open - without the app having to
/// listen for it. Stamping a resolved value here would freeze the theme at whatever it was on launch.
export function themeAttribute(preference: ThemePreference): ResolvedTheme | null {
  return preference === "system" ? null : preference;
}
