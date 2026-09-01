"use strict";

const path = require("node:path");

/// Where the built renderer lives, which is not the same place in the two builds.
///
/// Running from the repo it sits in the app workspace's dist directory. Packaged, electron-builder
/// copies it into the app's resources. Getting this wrong produces a window that is blank only in the
/// packaged build - the one place it is most awkward to notice.
function builtIndexPath(context) {
  if (context.isPackaged) {
    return path.join(context.resourcesPath, "app", "index.html");
  }
  return path.join(context.shellDir, "..", "..", "app", "dist", "index.html");
}

module.exports = { builtIndexPath };
