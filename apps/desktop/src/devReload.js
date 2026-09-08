"use strict";

/// Retry schedule for loading the dev server.
///
/// In development the shell and the Vite server start together, so the shell routinely wins the race
/// and gets ECONNREFUSED. Retrying here rather than making the launcher wait for a port keeps the
/// launcher trivial and also covers the dev server being restarted while the shell stays open.
///
/// Returns null when it is time to stop, so the caller never has to know the schedule.
function nextRetryDelayMs(attempt, options) {
  const settings = options || {};
  const maxAttempts = settings.maxAttempts === undefined ? 40 : settings.maxAttempts;
  const baseMs = settings.baseMs === undefined ? 250 : settings.baseMs;
  const maxMs = settings.maxMs === undefined ? 2000 : settings.maxMs;

  if (attempt >= maxAttempts) return null;
  return Math.min(baseMs * Math.pow(2, Math.floor(attempt / 4)), maxMs);
}

/// Whether a failed load should reload the window.
///
/// The retry above exists for exactly one situation: in development the shell and the Vite server
/// start together, and the shell routinely wins the race. It used to be armed for the life of the
/// window, so ANY later `did-fail-load` reloaded a running app - throwing away the renderer's entire
/// state: the open tabs, **any unsaved documents**, and whatever dialog the user was in the middle
/// of. From the user's side that is a window that blanks for a moment and comes back with everything
/// reset and nothing to say about why.
///
///  - **Main frame only.** `did-fail-load` fires for subframes too, and a subframe that failed is
///    not a reason to reload the document around it.
///  - **A packaged app that has already loaded never reloads itself.** Whatever the failure was, it
///    is not worth discarding the user's unsaved work to retry it - and there is no dev server here
///    whose restart it could be tracking.
///  - **In development it still does**, because a restarted dev server is a reload the developer
///    wants, and nothing is lost that the restart would not have lost anyway.
function shouldRetryLoad({ isMainFrame, hasLoaded, isDev }) {
  if (!isMainFrame) return false;
  if (!hasLoaded) return true;
  return isDev === true;
}

module.exports = { nextRetryDelayMs, shouldRetryLoad };
