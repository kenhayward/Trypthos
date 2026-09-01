"use strict";

/// Packaging config. Builds are unsigned for now, so Windows SmartScreen warns on first install and
/// macOS needs right-click then Open. Signing is outstanding work, not an oversight - see the README.
module.exports = {
  appId: "com.trypthos.app",
  productName: "Trypthos",
  directories: { output: "release" },
  files: ["src/**/*", "package.json"],
  extraResources: [{ from: "../app/dist", to: "app" }],
  // Without this, `dist` builds installers and leaves them on the runner: the workflow's uploaded
  // artifacts expire, and there is no release for the in-app updater to ever read. A tag has to
  // produce a durable, downloadable thing or it is not a release.
  publish: [{ provider: "github", owner: "kenhayward", repo: "Trypthos" }],
  win: { target: "nsis" },
  mac: { target: "dmg", identity: null },
  linux: { target: "AppImage" },
};
