"use strict";

/// How long a new document window has to claim the text it was opened with.
///
/// Generous: a cold renderer on a slow machine can take several seconds to load. What it bounds is
/// a window that will never ask - one whose page failed in a way nothing reported - so the tab that
/// sent the text is not left waiting forever. The tab stays open on a timeout, so the worst outcome
/// of a window that asks just too late is the same text in two places, never in none.
const CLAIM_TIMEOUT_MS = 30_000;

/// Unsaved text on its way from a tab into a document window of its own.
///
/// Held here, in the main process, rather than put in the new window's address: a document's text
/// does not belong in a URL. Keyed by the new window's `webContents.id`, which is what its IPC calls
/// arrive carrying - so only the window a draft was meant for can take it.
///
/// `hold` answers only once the new window has TAKEN the draft. That answer is what lets the old
/// window close the tab, and it is the reason this exists rather than a plain map: closing on
/// dispatch would be closing on the hope that the other window got the text.
function createDocumentHandoff({ timers = globalThis, timeoutMs = CLAIM_TIMEOUT_MS } = {}) {
  const held = new Map();

  function settle(windowId, result) {
    const entry = held.get(windowId);
    if (entry === undefined) return null;
    held.delete(windowId);
    timers.clearTimeout(entry.timer);
    entry.resolve(result);
    return entry.draft;
  }

  return {
    hold(windowId, draft) {
      return new Promise((resolve) => {
        const timer = timers.setTimeout(
          () => settle(windowId, { ok: false, reason: "window-failed" }),
          timeoutMs,
        );
        held.set(windowId, { draft, resolve, timer });
      });
    },

    /// The draft for this window, once. Null for a window that was opened without one, one that
    /// already took it, or one whose draft was abandoned.
    take(windowId) {
      return settle(windowId, { ok: true });
    },

    /// The window went - closed, crashed or failed to load - before it asked.
    abandon(windowId) {
      settle(windowId, { ok: false, reason: "window-failed" });
    },
  };
}

module.exports = { createDocumentHandoff, CLAIM_TIMEOUT_MS };
