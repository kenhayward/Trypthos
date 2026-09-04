"use strict";

const { isExternalUrl } = require("@trypthos/domain");

/// What the window does when something tries to navigate it.
///
/// The renderer already intercepts links in rendered markdown, and that is where the behaviour the
/// user sees is decided. This is the line underneath it: whatever gets past - a form, an anchor the
/// app draws later, something in a chat reply nobody anticipated - stops here, because the window is
/// what actually navigates.
///
/// It matters more here than in a browser tab. The window is frameless: no address bar, no back
/// button. A page loaded over the app has replaced the application, with no way back to it, and has
/// been handed the app's own origin - which is the origin the preload bridge is exposed on.
///
/// Pure, so the policy is testable without launching Electron.

/// The app's own document, ignoring the query and the fragment.
///
/// Vite appends a cache-busting query when it reloads, so comparing whole URLs would refuse the app
/// its own reload. Comparing the path is what "the same document" means here.
function documentIdentity(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/// "allow" to navigate, "external" to hand to the user's browser, "deny" to do nothing at all.
function navigationDecision(currentUrl, targetUrl) {
  const here = documentIdentity(currentUrl);
  const there = documentIdentity(targetUrl);

  if (here !== null && there !== null && here === there) return "allow";
  // The same allow-list the renderer and the IPC handler use, and for the same reason: the schemes
  // that are not on it include several the operating system acts on rather than displays.
  if (isExternalUrl(targetUrl)) return "external";
  return "deny";
}

module.exports = { navigationDecision };
