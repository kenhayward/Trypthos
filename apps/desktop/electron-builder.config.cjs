"use strict";

/// Packaging config. Builds are unsigned for now, so Windows SmartScreen warns on first install and
/// macOS needs right-click then Open. Signing is outstanding work, not an oversight - see the README.
module.exports = {
  appId: "com.trypthos.app",
  productName: "Trypthos",
  directories: { output: "release" },
  files: ["src/**/*", "package.json"],
  extraResources: [{ from: "../app/dist", to: "app" }],
  // Declared so electron-builder writes the updater feed files (latest.yml, latest-mac.yml) that an
  // in-app updater will read. It does NOT publish: the workflow packages with --publish never and a
  // single later job creates the release, because two matrix jobs publishing concurrently each
  // create their own draft.
  publish: [{ provider: "github", owner: "kenhayward", repo: "Trypthos" }],
  win: { target: "nsis" },
  mac: { target: "dmg", identity: null },
  linux: { target: "AppImage" },
};
