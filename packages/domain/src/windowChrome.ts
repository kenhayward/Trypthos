/// How the title bar is laid out on each platform.
///
/// Shared because both processes need it and must agree: the shell decides whether the OS draws
/// window controls, and the renderer decides whether to draw its own. If those two disagree the
/// window ends up with either two sets of controls or none, and "none" is unrecoverable - a frameless
/// window with no close button and no menu cannot be closed from inside the app at all.

export type Platform = "win32" | "darwin" | "linux";

export interface TitleBarLayout {
  /// Whether the renderer draws minimise / maximise / close itself.
  ///
  /// False on macOS: the OS draws its traffic lights over the frameless window, and a second set
  /// beside them would be both wrong and confusing.
  drawsWindowControls: boolean;
  /// Whether the renderer draws the menu bar itself.
  ///
  /// True on Windows and Linux: the window is frameless, so there is no frame for Electron to draw
  /// a menu bar in, and the labels go in our own title bar instead. Clicking one opens a real
  /// native menu.
  ///
  /// False on macOS, where the application menu belongs in the system menu bar at the top of the
  /// screen. Drawing a second one in the window would be wrong on that platform in a way no user
  /// would forgive.
  drawsMenuBar: boolean;
  /// Left padding, in pixels, reserving space for controls the OS draws.
  ///
  /// macOS places its traffic lights at the top left, over our title bar. Without this the app icon
  /// and file name render underneath them.
  leadingInset: number;
}

/// macOS traffic lights sit roughly 78px wide including their margin; 80 leaves a hair of clearance.
const TRAFFIC_LIGHT_INSET = 80;

export function titleBarLayout(platform: Platform): TitleBarLayout {
  if (platform === "darwin") {
    return { drawsWindowControls: false, drawsMenuBar: false, leadingInset: TRAFFIC_LIGHT_INSET };
  }
  return { drawsWindowControls: true, drawsMenuBar: true, leadingInset: 0 };
}

/// The window title, as shown in the bar and in the OS task switcher.
///
/// A plain hyphen, not an em dash. The design specifies "Trypthos - README.md" with U+2014; the
/// project bans em and en dashes in user-facing text, and the guard test would fail the build. The
/// separator is the only difference from the design here.
export function windowTitle(appName: string, fileName: string | null): string {
  return fileName === null ? appName : `${appName} - ${fileName}`;
}
