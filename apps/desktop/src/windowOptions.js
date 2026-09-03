"use strict";

/// The renderer is untrusted, and these are the flags that make that true.
///
/// Pinned by a test rather than left to review: each one is a single word, each defaults the unsafe
/// way in older guides people copy from, and none of them changes anything visible when wrong. A
/// window with nodeIntegration on looks and behaves identically right up until a page it loads is
/// hostile.
function webPreferencesFor(preloadPath) {
  return {
    preload: preloadPath,
    // Renderer gets no Node. Everything it needs arrives through the enumerated preload bridge.
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    // Off would let a page read any local file the user can read.
    webSecurity: true,
    // On by default, pinned because the right-click menu depends on it: Electron reports the
    // misspelled word and its suggestions on the click itself, and there is no way to ask for them
    // afterwards. Turned off, the menu would simply never offer a correction and nothing would say
    // why.
    spellcheck: true,
  };
}

module.exports = { webPreferencesFor };
