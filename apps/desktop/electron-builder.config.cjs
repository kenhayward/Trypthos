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
  // No spaces in artifact names. electron-builder's default NSIS name is "Trypthos Setup x.y.z.exe",
  // and GitHub rewrites spaces to dots on upload - so the published asset became
  // "Trypthos.Setup.0.4.3.exe" while latest.yml pointed at "Trypthos-Setup-0.4.3.exe", and the
  // updater feed 404'd. electron-builder's own publisher used to normalise that; publishing from a
  // separate job does not, so the name has to be right at build time.
  artifactName: "${productName}-Setup-${version}.${ext}",
  win: { target: "nsis" },
  mac: { target: "dmg", identity: null },
  linux: { target: "AppImage" },
};
