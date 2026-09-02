import { useEffect } from "react";
import { themeAttribute, type ThemePreference } from "../lib/theme";

/// Applies the chosen theme to the document.
///
/// Stamps `data-theme` for an explicit choice and stamps NOTHING for "system" - which is what lets
/// the stylesheet's media query keep tracking the OS while the app is open. Resolving "system" to a
/// value here and stamping that would freeze the theme at whatever it was on launch, so switching the
/// OS to dark at dusk would leave Trypthos light until it was restarted.
export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    const attribute = themeAttribute(preference);
    const root = document.documentElement;

    if (attribute === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", attribute);
  }, [preference]);
}
