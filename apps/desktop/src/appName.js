"use strict";

/// The product name, for the shell's own strings.
///
/// A proper noun, so it is never translated - the same reasoning that keeps it in `appInfo` on the
/// renderer side rather than in the message catalogue. Here rather than repeated across the tray,
/// the menus and the updater dialogs, because a second copy is a second thing that can disagree with
/// the About box.
const APP_NAME = "Trypthos";

module.exports = { APP_NAME };
