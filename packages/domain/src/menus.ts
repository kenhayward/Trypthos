import { z } from "zod";

/// The menu bar, described once so both processes agree.
///
/// **Why the window has no ordinary menu bar.** Trypthos is frameless on both platforms, and a
/// frameless window on Windows has nowhere for Electron to draw one - the menu bar belongs to the
/// frame that is not there. So the menus are real native menus, opened from labels the renderer
/// draws in its own title bar: `Menu.popup()` gives native rendering, native accelerator text and
/// the native edit roles, in a window that draws its own chrome.
///
/// macOS is different and simpler: the application menu lives in the system menu bar at the top of
/// the screen whether or not the window has a frame, so there it is set once and the title bar draws
/// nothing. `titleBarLayout` carries that difference, beside the same decision about window
/// controls.

export const MENU_NAMES = ["file", "edit", "tools", "help"] as const;

export type MenuName = (typeof MENU_NAMES)[number];

/// Menu items the RENDERER carries out.
///
/// Everything here already exists as something the user can do another way - a shortcut, a button in
/// the title bar - and the menu item drives that same path rather than a second copy of it. Items
/// the main process handles itself (quit, close, check for updates) are not actions: they never
/// reach the renderer.
export const MENU_ACTIONS = ["open-folder", "save", "preferences", "about"] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

/// Pushed from the main process when a menu item is chosen. Main to renderer, like `window:state`.
export const MENU_ACTION_CHANNEL = "menu:action";

export const MenuActionMessage = z.object({ action: z.enum(MENU_ACTIONS) }).strict();

/// Asking for a menu to open, at a point the renderer measured.
///
/// The coordinates are where the label sits, so the menu opens under it. They are the only numbers
/// the renderer supplies, and the main process clamps nothing: a popup at a silly coordinate is a
/// menu in the wrong place, not a way out of the sandbox.
export const PopupMenuRequest = z
  .object({
    menu: z.enum(MENU_NAMES),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export type PopupMenuRequest = z.infer<typeof PopupMenuRequest>;
