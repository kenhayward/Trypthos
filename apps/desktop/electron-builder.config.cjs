"use strict";

/// Packaging config. Builds are unsigned for now, so Windows SmartScreen warns on first install and
/// macOS needs right-click then Open. Signing is outstanding work, not an oversight - see the README.
module.exports = {
  appId: "com.trypthos.app",
  productName: "Trypthos",
  directories: { output: "release" },
  files: [
    "src/**/*",
    "package.json",
    // The domain is a workspace dependency, so electron-builder copies the whole linked directory -
    // TypeScript sources and tests included. Only its build output is needed at runtime.
    "!node_modules/@trypthos/domain/src/**",
    "!node_modules/@trypthos/domain/*.json",
    "node_modules/@trypthos/domain/package.json",
  ],
  extraResources: [
    { from: "../app/dist", to: "app" },
    // Outside the asar: Electron's Tray reads its icon from disk and cannot open an archive.
    { from: "build", to: "build", filter: ["*.png"] },
  ],
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
  //
  // Set PER TARGET, not globally. Globally it also renamed the .dmg, which dropped the architecture
  // suffix: harmless with one macOS build, a filename collision the moment an Intel one is added -
  // and "Setup" is Windows wording on a disk image in any case.
  win: {
    target: "nsis",
    icon: "build/icon.ico",
    artifactName: "${productName}-Setup-${version}.${ext}",
  },
  mac: {
    target: "dmg",
    identity: null,
    icon: "build/icon.icns",
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: { target: "AppImage", icon: "build/icon.png" },
};
