/// The keys a press carries, read off the event at the moment it lands.
export interface PasteMarkdownPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/// Whether a press asks for Paste as markdown - Ctrl and Shift with V, Cmd instead of Ctrl on macOS.
///
/// The modifier rules are the zoom keys' rules (`zoomKeyCommand`): the platform's own modifier, and
/// only it - a Ctrl that also worked on macOS would collide with the shell there, where Ctrl is a
/// right click rather than a modifier. Alt is refused for the same reason as there: Ctrl+Alt is
/// AltGr on a European layout, and typing must not paste into somebody's document doing it.
export function isPasteMarkdownShortcut(
  press: PasteMarkdownPress,
  platform: "darwin" | "win32" | "linux",
): boolean {
  if (press.altKey) return false;
  const held =
    platform === "darwin" ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!held || !press.shiftKey) return false;
  // Shift makes the character arrive capitalised, so both spellings are the same request.
  return press.key.toLowerCase() === "v";
}
