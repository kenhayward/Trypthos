"use strict";

/// Making sure something is actually being spellchecked.
///
/// `spellcheck: true` on the window turns the machinery on, but what gets checked is a LIST OF
/// LANGUAGES, and an empty list is not an error. Nothing is underlined, no suggestion is ever
/// offered, and the right-click menu has no spelling section - which on screen is indistinguishable
/// from a document with nothing wrong in it. This is the one failure worth guarding, so it is a
/// module with tests rather than a line in `createWindow`.
///
/// It steps in ONLY when nothing is resolved. Electron derives a list from the OS locale and that is
/// usually right; overwriting it would take a German user's dictionary away because the app happens
/// to be in English.

/// The languages to check, given what the session has and what it can do.
///
/// Pure, so every fallback is testable without a session: the exact locale, another dialect of the
/// same language, English, then nothing.
function spellCheckerLanguagesFor({ current, available, locale }) {
  if (current.length > 0) return current;

  if (locale && available.includes(locale)) return [locale];

  // en-NZ is a real locale with no dictionary of its own. Checking English against en-AU beats not
  // checking at all, and is what every other editor does.
  const language = (locale ?? "").split("-")[0];
  const sameLanguage =
    language === ""
      ? undefined
      : available.find((tag) => tag === language || tag.startsWith(`${language}-`));
  if (sameLanguage) return [sameLanguage];

  const english = available.find((tag) => tag === "en" || tag.startsWith("en-"));
  return english ? [english] : [];
}

/// Applies that to a session, and answers whether anything is being checked.
///
/// Never throws: a window that cannot spellcheck must still open. The caller logs the answer, which
/// is the only place the difference is visible at all.
function enableSpellChecker(session, { platform, locale }) {
  // macOS spellchecks through the OS, which owns its own languages. Setting them here is an error
  // rather than a preference, and the OS checker is already running.
  if (platform === "darwin") return { checking: true, languages: [] };

  try {
    const current = session.getSpellCheckerLanguages() ?? [];
    const available = session.availableSpellCheckerLanguages ?? [];
    const languages = spellCheckerLanguagesFor({ current, available, locale });

    if (languages.length === 0) return { checking: false, languages: [] };
    if (languages !== current) session.setSpellCheckerLanguages(languages);
    return { checking: true, languages };
  } catch (error) {
    console.error("Could not configure the spellchecker:", error);
    return { checking: false, languages: [] };
  }
}

module.exports = { enableSpellChecker, spellCheckerLanguagesFor };
