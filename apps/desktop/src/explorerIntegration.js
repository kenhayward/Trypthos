"use strict";

const { execFile } = require("node:child_process");
const { APP_NAME } = require("./appName");

/// Trypthos in File Explorer's right-click menu.
///
/// Explorer verbs are registry keys and nothing more, so this needs no native module and no
/// installer scripting: it writes them when the user asks and deletes them when they change their
/// mind, which an installer-time registration could not offer without a reinstall.
///
/// **Everything is under HKCU.** Per-user keys need no administrator rights, cannot affect another
/// account, and cannot be left behind for somebody else to find. A machine-wide write from a
/// settings toggle would be a privilege prompt and somebody else's problem at once.
///
/// **Windows 11 shows third-party verbs under "Show more options"**, not on the first menu. Getting
/// onto that one needs a COM handler in a packaged, signed app - both of which are outstanding work
/// - so the entries here land on the classic menu, which is where they land on Windows 10 too.

/// The key name Trypthos claims. One word, so an entry is recognisable in a registry editor and a
/// stale one from an older version is deleted by the same roots as a current one.
const VERB = "Trypthos";

const CLASSES = "HKCU\\Software\\Classes";

/// The extensions the file verb is offered on - the same two the workspace tree lists.
const MARKDOWN = [".md", ".markdown"];

/// The labels a user reads in Explorer.
///
/// Written here rather than in the renderer's string catalogue, for the same reason the native menus
/// are: this process has no i18next, and these strings are handed to the operating system rather
/// than rendered by a component.
const FOLDER_LABEL = `Open folder in ${APP_NAME}`;
const FILE_LABEL = `Open in ${APP_NAME}`;

/// The keys deleting removes, each with everything beneath it.
///
/// Roots rather than the full list: a subkey written by an older version would otherwise survive a
/// removal that only knew about today's entries.
function explorerRoots() {
  return [
    `${CLASSES}\\Directory\\shell\\${VERB}`,
    `${CLASSES}\\Directory\\Background\\shell\\${VERB}`,
    ...MARKDOWN.map((extension) => `${CLASSES}\\SystemFileAssociations\\${extension}\\shell\\${VERB}`),
    `${CLASSES}\\Applications\\${APP_NAME}.exe`,
  ];
}

/// Every key and value the integration writes, as data.
///
/// Data rather than a sequence of writes so the whole shape can be asserted without a registry -
/// which is the only way to test this at all on the machines CI runs on.
function explorerEntries(exePath) {
  const verb = (key, label, argument) => [
    { key, values: [{ name: "", data: label }, { name: "Icon", data: exePath }] },
    { key: `${key}\\command`, values: [{ name: "", data: `"${exePath}" "${argument}"` }] },
  ];

  return [
    // The folder itself.
    ...verb(`${CLASSES}\\Directory\\shell\\${VERB}`, FOLDER_LABEL, "%V"),
    // The empty space inside a folder. `%V` rather than `%1`, which is empty for this one - and this
    // is the entry that exists precisely for the case where nothing was clicked on.
    ...verb(`${CLASSES}\\Directory\\Background\\shell\\${VERB}`, FOLDER_LABEL, "%V"),
    ...MARKDOWN.flatMap((extension) =>
      verb(`${CLASSES}\\SystemFileAssociations\\${extension}\\shell\\${VERB}`, FILE_LABEL, "%1"),
    ),
    // Registered as an application as well as a verb: this is what puts Trypthos in the "Open with"
    // list, and lets somebody make it the default for markdown from Explorer's own dialog.
    {
      key: `${CLASSES}\\Applications\\${APP_NAME}.exe`,
      values: [{ name: "FriendlyAppName", data: APP_NAME }],
    },
    {
      key: `${CLASSES}\\Applications\\${APP_NAME}.exe\\shell\\open\\command`,
      values: [{ name: "", data: `"${exePath}" "%1"` }],
    },
    {
      key: `${CLASSES}\\Applications\\${APP_NAME}.exe\\SupportedTypes`,
      values: MARKDOWN.map((extension) => ({ name: extension, data: "" })),
    },
  ];
}

/// Runs `reg.exe` with its arguments as an array - never a command line.
///
/// A path from Explorer or from `process.execPath` is somebody else's text, and a string handed to a
/// shell is a string that can carry a second command. `execFile` with no shell cannot.
function runReg(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: stdout ?? "" });
    });
  });
}

function createExplorerIntegration({ platform, packaged, exePath, run = runReg }) {
  // Windows only, and only once packaged: in development the executable is Electron's own, which
  // cannot start Trypthos from a path alone, so the entry would open an empty Electron window.
  const supported = () => platform === "win32" && packaged === true;

  /// The key looked at to answer "is it on?".
  ///
  /// One key rather than all of them: they are written and deleted together, and a half-written set
  /// is not a state this can produce.
  const canary = `${CLASSES}\\Directory\\shell\\${VERB}\\command`;

  return {
    supported,

    async isRegistered() {
      if (!supported()) return false;
      const { code } = await run("reg", ["query", canary]);
      return code === 0;
    },

    async register() {
      if (!supported()) return { ok: false, reason: "unsupported" };

      for (const entry of explorerEntries(exePath)) {
        for (const value of entry.values) {
          const name = value.name === "" ? ["/ve"] : ["/v", value.name];
          const { code } = await run("reg", [
            "add",
            entry.key,
            ...name,
            "/t",
            "REG_SZ",
            "/d",
            value.data,
            "/f",
          ]);
          if (code !== 0) return { ok: false, reason: "write-failed" };
        }
      }
      return { ok: true };
    },

    async unregister() {
      if (!supported()) return { ok: false, reason: "unsupported" };

      for (const root of explorerRoots()) {
        // `/f` so a key that is not there is not a failure: turning off something already off has to
        // succeed, or a half-removed state becomes unrecoverable from the interface.
        await run("reg", ["delete", root, "/f"]);
      }
      return { ok: true };
    },
  };
}

module.exports = { explorerEntries, explorerRoots, createExplorerIntegration };
