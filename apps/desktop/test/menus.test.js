"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MENU_NAMES } = require("@trypthos/domain");
const { appMenuTemplate, contextMenuTemplate, popupTemplate } = require("../src/menus");

/// The menus, as data.
///
/// Templates are plain arrays until Electron builds them, which makes the whole shape testable
/// without a window: what is on each menu, which items use a native role, and which are enabled.
///
/// The roles matter more than they look. `cut`, `copy` and `paste` as roles act on whatever has
/// focus, through the platform's own editing machinery. Written as custom items sending keystrokes
/// they would work in some fields and silently not in others.

const noop = () => {};
const handlers = () => ({
  action: noop,
  quit: noop,
  closeWindow: noop,
  checkForUpdates: noop,
  addToDictionary: noop,
  replaceMisspelling: noop,
});

const labels = (template) => template.map((item) => item.label ?? item.role ?? item.type);
const find = (template, label) => template.find((item) => item.label === label);

test("there is a template for every menu the renderer can open", () => {
  for (const name of MENU_NAMES) {
    const template = popupTemplate(name, { platform: "win32", on: handlers() });
    assert.ok(Array.isArray(template) && template.length > 0, `${name} has no items`);
  }
});

test("File carries the open and save operations", () => {
  const template = popupTemplate("file", { platform: "win32", on: handlers() });
  assert.ok(find(template, "Open Folder..."));
  assert.ok(find(template, "Save"));
});

test("File offers the ways out of the app", () => {
  const template = popupTemplate("file", { platform: "win32", on: handlers() });
  assert.ok(find(template, "Close Window"));
  assert.ok(find(template, "Quit"));
});

// Roles, not hand-rolled clipboard calls: a role acts on the focused element through the platform's
// own editing machinery, which is what makes it work in the editor, the chat box and a settings
// field alike.
test("Edit uses native roles for the clipboard", () => {
  const template = popupTemplate("edit", { platform: "win32", on: handlers() });
  const roles = template.map((item) => item.role).filter(Boolean);

  for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
    assert.ok(roles.includes(role), `Edit is missing the ${role} role`);
  }
});

test("Tools carries Settings", () => {
  const template = popupTemplate("tools", { platform: "win32", on: handlers() });
  assert.ok(find(template, "Settings"));
});

test("Help carries About, and the update check that was only on the tray", () => {
  const template = popupTemplate("help", { platform: "win32", on: handlers() });
  assert.ok(find(template, "About Trypthos"));
  assert.ok(find(template, "Check for Updates..."));
});

test("choosing an item tells the renderer what was chosen", () => {
  const chosen = [];
  const on = { ...handlers(), action: (name) => chosen.push(name) };

  find(popupTemplate("file", { platform: "win32", on }), "Open Folder...").click();
  find(popupTemplate("file", { platform: "win32", on }), "Save").click();
  find(popupTemplate("tools", { platform: "win32", on }), "Settings").click();
  find(popupTemplate("help", { platform: "win32", on }), "About Trypthos").click();

  assert.deepEqual(chosen, ["open-folder", "save", "preferences", "about"]);
});

// Handled where they belong: quitting is not something the renderer should be asked to arrange.
test("quitting and closing are handled by the main process, not sent to the renderer", () => {
  const sent = [];
  let quit = 0;
  let closed = 0;
  const on = {
    ...handlers(),
    action: (name) => sent.push(name),
    quit: () => (quit += 1),
    closeWindow: () => (closed += 1),
  };

  const template = popupTemplate("file", { platform: "win32", on });
  find(template, "Quit").click();
  find(template, "Close Window").click();

  assert.equal(quit, 1);
  assert.equal(closed, 1);
  assert.deepEqual(sent, []);
});

test("the shortcuts named on the menu are the ones the app already uses", () => {
  const file = popupTemplate("file", { platform: "win32", on: handlers() });
  assert.equal(find(file, "Save").accelerator, "CmdOrCtrl+S");
  assert.equal(find(file, "Open Folder...").accelerator, "CmdOrCtrl+O");
});

/// The macOS application menu.
///
/// A different shape, not a translation of the same one: the platform expects an app menu named
/// after the app, carrying About and Quit, and expects Settings under it rather than under a Tools
/// menu of our invention.
test("macOS gets an application menu named after the app", () => {
  const template = appMenuTemplate({ appName: "Trypthos", on: handlers() });
  assert.equal(template[0].label, "Trypthos");
});

test("macOS puts About and Settings where the platform expects them", () => {
  const template = appMenuTemplate({ appName: "Trypthos", on: handlers() });
  const appMenu = template[0].submenu.map((item) => item.label ?? item.role);

  assert.ok(appMenu.includes("About Trypthos"));
  assert.ok(appMenu.includes("Settings..."));
  assert.ok(appMenu.includes("quit"));
});

test("macOS still has File, Edit and Help", () => {
  const template = appMenuTemplate({ appName: "Trypthos", on: handlers() });
  const menus = template.map((item) => item.label ?? item.role);

  for (const name of ["File", "Edit", "Help"]) {
    assert.ok(menus.includes(name), `the application menu is missing ${name}`);
  }
});

// Settings belongs in the app menu on macOS, so a Tools menu holding only Settings would be an
// empty menu on that platform.
test("macOS has no Tools menu, because Settings moved into the app menu", () => {
  const template = appMenuTemplate({ appName: "Trypthos", on: handlers() });
  assert.ok(!template.some((item) => item.label === "Tools"));
});

/// The right-click menu.
///
/// Built from what was actually clicked. The spelling suggestions only exist here - there is no
/// other route to them - which is the main reason this menu exists at all.
const editable = (over = {}) => ({
  isEditable: true,
  selectionText: "",
  misspelledWord: "",
  dictionarySuggestions: [],
  editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canUndo: true, canRedo: true },
  ...over,
});

test("a text field gets the clipboard operations, as roles", () => {
  const template = contextMenuTemplate(editable(), { on: handlers() });
  const roles = template.map((item) => item.role).filter(Boolean);

  for (const role of ["cut", "copy", "paste", "selectAll"]) {
    assert.ok(roles.includes(role), `the context menu is missing ${role}`);
  }
});

test("a misspelled word offers its suggestions first", () => {
  const template = contextMenuTemplate(
    editable({ misspelledWord: "documnet", dictionarySuggestions: ["document", "documents"] }),
    { on: handlers() },
  );

  assert.deepEqual(labels(template).slice(0, 2), ["document", "documents"]);
});

test("choosing a suggestion replaces the word", () => {
  const replaced = [];
  const on = { ...handlers(), replaceMisspelling: (word) => replaced.push(word) };
  const template = contextMenuTemplate(
    editable({ misspelledWord: "documnet", dictionarySuggestions: ["document"] }),
    { on },
  );

  find(template, "document").click();
  assert.deepEqual(replaced, ["document"]);
});

test("a misspelled word can be added to the dictionary", () => {
  const added = [];
  const on = { ...handlers(), addToDictionary: (word) => added.push(word) };
  const template = contextMenuTemplate(
    editable({ misspelledWord: "Trypthos", dictionarySuggestions: [] }),
    { on },
  );

  find(template, "Add to Dictionary").click();
  assert.deepEqual(added, ["Trypthos"]);
});

// A word the dictionary has no idea about offers nothing to choose, and a menu with a dead heading
// would be worse than one without.
test("a misspelled word with no suggestions says so rather than showing an empty list", () => {
  const template = contextMenuTemplate(
    editable({ misspelledWord: "Trypthos", dictionarySuggestions: [] }),
    { on: handlers() },
  );

  assert.ok(find(template, "No suggestions"));
  assert.equal(find(template, "No suggestions").enabled, false);
});

test("a correctly spelled field offers no spelling section at all", () => {
  const template = contextMenuTemplate(editable(), { on: handlers() });
  assert.ok(!find(template, "Add to Dictionary"));
  assert.ok(!find(template, "No suggestions"));
});

// What the user can actually do right now. A paste item on a field with nothing to paste into it,
// or a cut with no selection, is a menu that lies.
test("items the click cannot do are disabled", () => {
  const template = contextMenuTemplate(
    editable({ editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }),
    { on: handlers() },
  );

  const byRole = (role) => template.find((item) => item.role === role);
  assert.equal(byRole("cut").enabled, false);
  assert.equal(byRole("copy").enabled, false);
  assert.equal(byRole("paste").enabled, true);
});

test("read-only text offers copy but not cut or paste", () => {
  const template = contextMenuTemplate(
    { isEditable: false, selectionText: "some text", misspelledWord: "", dictionarySuggestions: [], editFlags: { canCopy: true } },
    { on: handlers() },
  );

  const roles = template.map((item) => item.role).filter(Boolean);
  assert.ok(roles.includes("copy"));
  assert.ok(!roles.includes("cut"));
  assert.ok(!roles.includes("paste"));
});

// Right-clicking the middle of a paragraph with nothing selected and nothing to correct. An empty
// menu is better than a menu of dead items.
test("a click with nothing to offer produces no menu", () => {
  const template = contextMenuTemplate(
    { isEditable: false, selectionText: "", misspelledWord: "", dictionarySuggestions: [], editFlags: {} },
    { on: handlers() },
  );

  assert.deepEqual(template, []);
});
