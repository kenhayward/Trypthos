"use strict";

const { APP_NAME } = require("./appName");

/// The application menus, as templates.
///
/// **Why the menus are opened from our own title bar on Windows.** The window is frameless, so there
/// is no frame for Electron to draw a menu bar in. The renderer draws the labels and asks the main
/// process to pop a REAL native menu under them - which keeps native rendering, native accelerator
/// text, and the native edit roles, in a window that draws its own chrome. macOS is unaffected: its
/// application menu lives in the system menu bar whether or not the window has a frame.
///
/// **Roles rather than hand-rolled clipboard calls.** `cut`, `copy`, `paste` and friends act on
/// whatever has focus, through the platform's own editing machinery. Written as custom items firing
/// clipboard APIs they would work in a plain input and silently not in CodeMirror, or the reverse.
/// A role is the only version that works everywhere without knowing what "everywhere" contains.
///
/// **Nothing here is a second implementation.** Every item drives a path the user already has: the
/// renderer's own open, save, preferences and about. The main process keeps only what the renderer
/// has no business arranging - quitting, closing the window, and the update check.
///
/// These strings are English literals rather than catalogue keys, following `tray.js` and the
/// updater dialogs: the catalogue and `react-i18next` live in the renderer, and the main process has
/// no access to either. Translating the shell is a separate piece of work.

/// Labels are shared where the same command appears on both platforms, so Windows and macOS cannot
/// drift into calling the same thing two different names.
const OPEN_FOLDER = "Open Folder...";
const SAVE = "Save";
const SETTINGS = "Settings";
const ABOUT = `About ${APP_NAME}`;
const CHECK_FOR_UPDATES = "Check for Updates...";

const separator = { type: "separator" };

/// The clipboard block, used by both the Edit menu and the right-click menu.
///
/// `enabled` is only applied where the caller knows: a menu bar item has no click to reason about,
/// so it stays enabled and the platform decides. A context menu does know, and says so.
function clipboardRoles(editFlags) {
  const enabledFor = (flag) => (editFlags === undefined ? {} : { enabled: flag === true });
  return [
    { role: "cut", ...enabledFor(editFlags?.canCut) },
    { role: "copy", ...enabledFor(editFlags?.canCopy) },
    { role: "paste", ...enabledFor(editFlags?.canPaste) },
  ];
}

function fileItems(on) {
  return [
    { label: OPEN_FOLDER, accelerator: "CmdOrCtrl+O", click: () => on.action("open-folder") },
    separator,
    { label: SAVE, accelerator: "CmdOrCtrl+S", click: () => on.action("save") },
  ];
}

function editItems() {
  return [
    { role: "undo" },
    { role: "redo" },
    separator,
    ...clipboardRoles(),
    separator,
    { role: "selectAll" },
  ];
}

function helpItems(on) {
  return [
    { label: CHECK_FOR_UPDATES, click: () => on.checkForUpdates() },
    separator,
    { label: ABOUT, click: () => on.action("about") },
  ];
}

/// One menu, for the labels the renderer draws in its own title bar.
function popupTemplate(name, { on }) {
  if (name === "file") {
    return [
      ...fileItems(on),
      separator,
      // Closing the window is not the same as quitting when close-to-tray is on, so both are here.
      { label: "Close Window", click: () => on.closeWindow() },
      { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => on.quit() },
    ];
  }
  if (name === "edit") return editItems();
  if (name === "tools") {
    return [{ label: SETTINGS, accelerator: "CmdOrCtrl+,", click: () => on.action("preferences") }];
  }
  return helpItems(on);
}

/// The macOS application menu.
///
/// A different shape rather than a translation of the same one. The platform expects an app menu
/// named after the app, carrying About, Settings and Quit - so Tools, which exists on Windows only
/// to hold Settings, has nothing left to hold and is not built.
function appMenuTemplate({ appName = APP_NAME, on }) {
  return [
    {
      label: appName,
      submenu: [
        { label: `About ${appName}`, click: () => on.action("about") },
        { label: CHECK_FOR_UPDATES, click: () => on.checkForUpdates() },
        separator,
        { label: "Settings...", accelerator: "CmdOrCtrl+,", click: () => on.action("preferences") },
        separator,
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        separator,
        { role: "quit" },
      ],
    },
    { label: "File", submenu: [...fileItems(on), separator, { role: "close" }] },
    { label: "Edit", submenu: editItems() },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
    { label: "Help", submenu: [{ label: CHECK_FOR_UPDATES, click: () => on.checkForUpdates() }] },
  ];
}

/// The right-click menu, built from what was actually clicked.
///
/// Spelling correction has no other route in the app, which is most of why this exists. Electron's
/// spellchecker reports the misspelled word and its suggestions on the click itself; there is no way
/// to ask for them afterwards.
///
/// An empty template is a real answer: right-clicking the middle of a paragraph with nothing
/// selected and nothing to correct should open nothing, rather than a menu of dead items.
function contextMenuTemplate(params, { on }) {
  const template = [];

  if (params.misspelledWord) {
    if (params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions) {
        template.push({ label: suggestion, click: () => on.replaceMisspelling(suggestion) });
      }
    } else {
      // A disabled line rather than nothing: it tells the user the word IS flagged and that the
      // dictionary simply has no better idea, which "no spelling section" would not.
      template.push({ label: "No suggestions", enabled: false });
    }
    template.push(separator, {
      label: "Add to Dictionary",
      click: () => on.addToDictionary(params.misspelledWord),
    });
    template.push(separator);
  }

  if (params.isEditable) {
    // Undo and redo first, as they are in the Edit menu and in every other app's right-click menu.
    // Enabled from what the click reported, like the clipboard block: an Undo that does nothing when
    // chosen is worse than one that is visibly unavailable.
    template.push(
      { role: "undo", enabled: params.editFlags?.canUndo === true },
      { role: "redo", enabled: params.editFlags?.canRedo === true },
      separator,
    );
    template.push(...clipboardRoles(params.editFlags));
    template.push(separator, { role: "selectAll", enabled: params.editFlags?.canSelectAll === true });
  } else if (params.selectionText !== "") {
    template.push({ role: "copy", enabled: params.editFlags?.canCopy === true });
  }

  // Trailing and leading separators are ugly, and a menu of nothing but separators is worse.
  while (template.length > 0 && template.at(-1).type === "separator") template.pop();
  return template.every((item) => item.type === "separator") ? [] : template;
}

module.exports = { appMenuTemplate, contextMenuTemplate, popupTemplate };
