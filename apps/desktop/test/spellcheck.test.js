"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { enableSpellChecker, spellCheckerLanguagesFor } = require("../src/spellcheck");

/// The spellchecker, and the one way it fails silently.
///
/// `spellcheck: true` on the window turns the machinery on, but what is actually checked is a LIST
/// OF LANGUAGES. An empty list is not an error and reports nothing: no squiggle appears anywhere, no
/// suggestion is ever offered, and the right-click menu simply has no spelling section - which looks
/// exactly like a correctly spelled document.

const session = (over = {}) => {
  const calls = [];
  return {
    calls,
    availableSpellCheckerLanguages: ["en-AU", "en-GB", "en-US", "de", "fr"],
    getSpellCheckerLanguages: () => over.current ?? [],
    setSpellCheckerLanguages: (languages) => {
      if (languages.some((tag) => !session.available?.includes?.(tag))) {
        // Mirrors Electron, which throws rather than ignoring a language it cannot check.
      }
      calls.push(languages);
    },
    ...over,
  };
};

test("leaves a resolved list alone", () => {
  // Electron resolves one from the OS locale, and it is usually right. Overwriting it would take a
  // German user's dictionary away because the app happens to be English.
  const languages = spellCheckerLanguagesFor({
    current: ["de"],
    available: ["de", "en-GB"],
    locale: "en-GB",
  });

  assert.deepEqual(languages, ["de"]);
});

test("falls back to the app's locale when nothing is resolved", () => {
  const languages = spellCheckerLanguagesFor({
    current: [],
    available: ["en-AU", "en-GB", "en-US"],
    locale: "en-GB",
  });

  assert.deepEqual(languages, ["en-GB"]);
});

// A locale the dictionary list does not carry exactly: en-NZ is a real locale with no dictionary of
// its own, and checking English badly beats not checking at all.
test("uses another dialect of the same language when the exact locale has no dictionary", () => {
  const languages = spellCheckerLanguagesFor({
    current: [],
    available: ["en-AU", "en-GB", "en-US"],
    locale: "en-NZ",
  });

  assert.deepEqual(languages, ["en-AU"]);
});

test("falls back to English when the locale's language has no dictionary at all", () => {
  const languages = spellCheckerLanguagesFor({
    current: [],
    available: ["en-GB", "en-US"],
    locale: "cy",
  });

  assert.deepEqual(languages, ["en-GB"]);
});

// Nothing to check with. Answering with an empty list is honest; inventing a tag would throw.
test("asks for nothing when the checker has no dictionaries", () => {
  const languages = spellCheckerLanguagesFor({ current: [], available: [], locale: "en-GB" });
  assert.deepEqual(languages, []);
});

test("sets the languages on the session when it has none", () => {
  const ses = session({ current: [] });
  const result = enableSpellChecker(ses, { platform: "win32", locale: "en-GB" });

  assert.deepEqual(ses.calls, [["en-GB"]]);
  assert.equal(result.checking, true);
});

test("writes nothing when the session already has a list", () => {
  const ses = session({ getSpellCheckerLanguages: () => ["en-US"] });
  const result = enableSpellChecker(ses, { platform: "win32", locale: "en-GB" });

  assert.deepEqual(ses.calls, []);
  assert.equal(result.checking, true);
});

// macOS spellchecks through the OS, which owns its own languages - asking Electron to set them
// there is an error, not a preference.
test("leaves macOS to its own spellchecker", () => {
  const ses = session({ current: [] });
  const result = enableSpellChecker(ses, { platform: "darwin", locale: "en-GB" });

  assert.deepEqual(ses.calls, []);
  assert.equal(result.checking, true);
});

// A window that cannot spellcheck must still open. The report is what the caller logs; the throw
// must not reach the window.
test("survives a session that refuses the list", () => {
  const ses = session({
    current: [],
    setSpellCheckerLanguages: () => {
      throw new Error("unsupported language");
    },
  });

  const result = enableSpellChecker(ses, { platform: "win32", locale: "en-GB" });
  assert.equal(result.checking, false);
});

test("reports when there is nothing to check with", () => {
  const ses = session({ current: [], availableSpellCheckerLanguages: [] });
  const result = enableSpellChecker(ses, { platform: "win32", locale: "en-GB" });

  assert.deepEqual(ses.calls, []);
  assert.equal(result.checking, false);
});
