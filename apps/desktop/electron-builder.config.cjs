"use strict";

/// Packaging config. Builds are unsigned for now, so Windows SmartScreen warns on first install and
/// macOS needs right-click then Open. Signing is outstanding work, not an oversight - see the README.
module.exports = {
  appId: "com.trypthos.app",
  productName: "Trypthos",
  directories: { output: "release" },
  files: ["src/**/*", "package.json"],
  extraResources: [{ from: "../app/dist", to: "app" }],
  win: { target: "nsis" },
  mac: { target: "dmg", identity: null },
  linux: { target: "AppImage" },
};
