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

module.exports = { nextRetryDelayMs };
