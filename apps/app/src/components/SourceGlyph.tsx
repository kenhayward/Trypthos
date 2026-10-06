import type { WorkspaceMark } from "@trypthos/domain";
import Glyph from "./Glyph";

/// The colour a provider's mark takes on a workspace row.
///
/// Green is the folder colour this app has always used for a folder; a repository is not one, and
/// it takes the accent instead. A `switch` for the same reason `SourceGlyph` is one - a provider
/// added to the schema without a colour is a type error here rather than two sources that look the
/// same in the tree.
///
/// A class rather than a hex, so both themes are answered by the token the rest of the app reads.
export function sourceColour(mark: WorkspaceMark): string {
  switch (mark) {
    case "github":
      return "text-accent";
    case "local":
      return "text-leaf";
    case "obsidian":
      return "text-obsidian";
    case "google-drive":
      return "text-drive";
  }
}

/// The mark for one provider, or for a folder opened as an Obsidian vault.
///
/// A `switch` over the mark rather than a lookup with a fallback, so adding a provider to the schema
/// and forgetting its icon is a type error here rather than a folder icon on a repository.
///
/// `data-mark` says which was drawn, since an outline at this size is not something a test can read.
export default function SourceGlyph({ mark, className }: { mark: WorkspaceMark; className?: string }) {
  switch (mark) {
    case "github":
      return (
        <Glyph className={className} mark="github">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </Glyph>
      );
    case "local":
      return (
        <Glyph className={className} mark="local">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </Glyph>
      );
    case "obsidian":
      // Obsidian's crystal, as an outline with its facets, drawn in the same stroke as the other marks.
      return (
        <Glyph className={className} mark="obsidian">
          <path d="M14.5 2 6.5 8.5 5 15.5l5 6.5 8-2.5 1.5-10.5Z" />
          <path d="M14.5 2 11 12l-1 10M6.5 8.5 11 12l7 7.5M11 12l8.5-3" />
        </Glyph>
      );
    case "google-drive":
      // Drive's triangle, as an outline with its three folds.
      return (
        <Glyph className={className} mark="google-drive">
          <path d="M8 3h8l6 11-3 6H5l-3-6Z" />
          <path d="m8 3 7 11H2m14-11-7 11-4 6m17-6H9" />
        </Glyph>
      );
  }
}
