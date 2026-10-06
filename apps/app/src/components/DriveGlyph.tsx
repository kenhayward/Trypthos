import Glyph from "./Glyph";

/// The places a Drive picker row can stand for.
export type DriveGlyphKind = "my-drive" | "shared-with-me" | "shared-drive" | "folder" | "shared-folder";

/// The mark for one kind of Drive place, drawn in the app's own outline style - not Google's artwork.
///
/// A `switch` over the kind, so a place added without an icon is a type error here rather than a
/// plain folder where something else was meant. `data-mark` says which was drawn, since an outline at
/// this size is not something a test can read.
export default function DriveGlyph({ kind, className }: { kind: DriveGlyphKind; className?: string }) {
  switch (kind) {
    case "my-drive":
      // A drive: a box with its opening and an indicator light.
      return (
        <Glyph className={className} mark="drive-my-drive">
          <path d="M3 14h18v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
          <path d="M3 14 6.2 5.6A1 1 0 0 1 7.1 5h9.8a1 1 0 0 1 .9.6L21 14" />
          <path d="M7 17h.01M11 17h3" />
        </Glyph>
      );
    case "shared-with-me":
      // Two people.
      return (
        <Glyph className={className} mark="drive-shared-with-me">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.4A5 5 0 0 1 21 19v1" />
        </Glyph>
      );
    case "shared-drive":
      // A drive with a person standing in front of it.
      return (
        <Glyph className={className} mark="drive-shared-drive">
          <path d="M3 12h18v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
          <path d="M3 12 6.2 5.6A1 1 0 0 1 7.1 5h9.8a1 1 0 0 1 .9.6L21 12" />
          <circle cx="12" cy="14.5" r="1.5" />
          <path d="M9.5 19v-.5a2.5 2.5 0 0 1 5 0v.5" />
        </Glyph>
      );
    case "folder":
      return (
        <Glyph className={className} mark="drive-folder">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </Glyph>
      );
    case "shared-folder":
      // A folder with a person in it.
      return (
        <Glyph className={className} mark="drive-shared-folder">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          <circle cx="12" cy="11" r="1.75" />
          <path d="M8.5 17v-.5a3.5 3.5 0 0 1 7 0v.5" />
        </Glyph>
      );
  }
}
