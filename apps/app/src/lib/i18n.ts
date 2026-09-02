import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";

/// Every user-facing string goes through here.
///
/// Introduced while there were about thirty of them, deliberately: the chat panel port brings several
/// hundred, and retrofitting after that is the expensive ordering.
///
/// One catalogue with dotted keys rather than namespaces. Namespaces would mean each call site
/// declaring which one it reads, and the guard test would have to resolve that declaration to check a
/// key exists. Dotted keys give the same grouping for none of that cost, and `chat.*` is already
/// reserved for the port.

export const DEFAULT_LOCALE = "en";

export const resources = {
  en: { translation: en },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  // English is the only catalogue, so a fallback would silently mask a missing key by rendering the
  // same language it failed to find. The guard test is what catches those instead.
  fallbackLng: false,
  interpolation: {
    // React escapes for us. Leaving i18next's escaping on double-encodes anything with an ampersand,
    // which shows up as `&amp;` in a filename and nowhere else.
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
