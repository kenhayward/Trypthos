"use strict";

/// Where the shell loads the UI from.
///
/// In development that is the Vite dev server, so hot reload works. In a packaged build it is the
/// built bundle on disk - there is no server in this product, so there is nothing else it could be.
/// Pure, so the branch is testable without launching Electron.
function rendererTarget(env, builtIndexPath) {
  if (env.TRYPTHOS_DEV === "1") {
    return { kind: "url", value: env.TRYPTHOS_DEV_URL || "http://localhost:5173" };
  }
  return { kind: "file", value: builtIndexPath };
}

module.exports = { rendererTarget };
