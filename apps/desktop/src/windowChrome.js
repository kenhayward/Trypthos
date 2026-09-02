"use strict";

const { titleBarLayout } = require("@trypthos/domain");

/// BrowserWindow options for a frameless window, per platform.
///
/// The two platforms get there differently, and the difference matters:
///
///   - Windows and Linux: `frame: false` removes the OS chrome entirely, and the renderer draws
///     minimise, maximise and close itself.
///   - macOS: `titleBarStyle: "hiddenInset"` keeps the traffic lights and hides everything else. Using
///     `frame: false` there would remove the traffic lights too, leaving a window with no close
///     button that cannot be closed from inside the app.
///
/// Whether the renderer draws controls comes from the SAME shared function the renderer calls, so the
/// two cannot disagree about who is responsible for them.
function chromeOptionsFor(platform) {
  const layout = titleBarLayout(platform);

  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      // Vertically centres the lights against a 32px bar.
      trafficLightPosition: { x: 12, y: 9 },
    };
  }

  return { frame: layout.drawsWindowControls ? false : true };
}

module.exports = { chromeOptionsFor };
