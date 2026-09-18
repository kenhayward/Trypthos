/// What colour an Iconic assignment is drawn in.
///
/// Iconic's nine named tones resolve against the Obsidian theme the vault is using. This app cannot
/// read that theme, so each name is translated to a token of our own, answered in both themes - a
/// hex written here would be right in one theme and wrong in the other.
///
/// Anything else is a value the user chose explicitly, so it is passed through as given. That is
/// the one place in this app where a colour does not come from a token, and it is deliberate: the
/// alternative is quietly changing a colour somebody picked. `parseObsidianIcons` has already
/// refused anything that is not plainly a colour, so what arrives here is a hex value or a word.

export const ICON_TONES: Record<string, string> = {
  red: "var(--tp-tone-red)",
  orange: "var(--tp-tone-orange)",
  yellow: "var(--tp-tone-yellow)",
  green: "var(--tp-tone-green)",
  cyan: "var(--tp-tone-cyan)",
  blue: "var(--tp-tone-blue)",
  purple: "var(--tp-tone-purple)",
  pink: "var(--tp-tone-pink)",
  gray: "var(--tp-tone-gray)",
};

export function toneColour(colour: string | null): string | undefined {
  if (colour === null) return undefined;
  return ICON_TONES[colour.toLowerCase()] ?? colour;
}
