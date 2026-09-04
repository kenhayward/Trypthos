"use strict";

const { CLOSE_REQUESTED_CHANNEL } = require("@trypthos/domain");

/// Not closing the window on somebody's unsaved writing.
///
/// The split is the whole point. The **renderer** owns the document, knows whether it is dirty, and
/// is the only side that can save it. The **shell** owns the window and the `close` event, and is
/// the only side that can stop one. So the shell keeps a copy of the dirty flag for exactly one
/// purpose - to know whether a close is worth interrupting at all - and hands the decision back to
/// the renderer, which answers by closing the window itself once it has asked.
///
/// The prompt lives here rather than in the renderer because it is a native dialog, and because
/// every path that can discard the document uses this same one: two prompts would be two chances to
/// word the buttons differently, and the difference would show up as somebody losing a file.

/// What a close attempt should do, given the three policies that meet on one event.
///
/// Stated once, here, rather than as an order of `if`s inside main's listener - the order between
/// them is the difference between asking twice and losing the file:
///
///   - **Forced wins outright.** The renderer only forces a close after asking, so nothing may
///     interrupt it. Hiding the window here would be the app quietly ignoring "discard and close".
///   - **Hiding never asks.** Close-to-tray closes nothing: the window hides and the document is
///     still open behind it, so a prompt would be about work that is in no danger.
///   - **Otherwise, unsaved work is asked about**, because it is the only thing here that cannot be
///     recovered.
function closeDecision({ forced, hiding, dirty }) {
  if (forced) return "close";
  if (hiding) return "hide";
  return dirty ? "ask" : "close";
}

function createCloseGuard({ dialog, send }) {
  let dirty = false;
  /// Set when the renderer has asked and been told to go ahead. Without it the close it then
  /// performs would be intercepted again, and the window could never close at all.
  let allowed = false;

  return {
    setDirty(next) {
      dirty = next === true;
    },

    /// Asks the renderer whether the window may close. It answers by closing it, forced.
    requestClose() {
      send(CLOSE_REQUESTED_CHANNEL, {});
    },

    allow() {
      allowed = true;
    },

    forced() {
      return allowed;
    },

    isDirty() {
      return dirty;
    },

    /// The native prompt, shared by every path that would discard the document.
    async ask() {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Save", "Don't Save", "Cancel"],
        // The safe answer is the default, and Escape must mean cancel - a dialog where dismissing it
        // throws the work away is a trap.
        defaultId: 0,
        cancelId: 2,
        message: "Save changes before closing this document?",
        detail: "Your changes will be lost if you do not save them.",
      });

      // Anything unrecognised reads as cancel. A dialog dismissed in a way this build does not know
      // about must never mean "throw it away".
      return ["save", "discard", "cancel"][response] ?? "cancel";
    },
  };
}

module.exports = { closeDecision, createCloseGuard };
