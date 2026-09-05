import { LanguageDescription } from "@codemirror/language";
import { enabledFileTypes, type FileType } from "@trypthos/domain";
import { LANGUAGE_LOADERS } from "./languageLoaders";

/// The languages a fenced code block inside a markdown document may be written in.
///
/// Fed to `markdown({ codeLanguages })`, so a ```` ```python ```` block in somebody's notes is
/// coloured by the same rules as a standalone `.py` file - from the same catalogue, the same
/// loaders and the same palette. For the audience Trypthos actually has, this is where most of the
/// File types work pays off: markdown documents full of code are far commoner here than source
/// files opened as documents.
///
/// **A fence is coloured only if its type is turned on**, which is the point rather than a
/// limitation: the setting governs what the app takes an interest in, inside a document as much as
/// in the folder tree.

/// The fence tags one type answers to, each with the extension its loader should be asked for.
///
/// The id and the extensions come free - `python`, `py`, `ts`, `rs` are what people write - and
/// `fenceAliases` covers the written-out names an extension cannot produce.
function tagsFor(type: FileType): { tag: string; extension: string }[] {
  const canonical = type.extensions[0] ?? "";
  return [
    { tag: type.id, extension: canonical },
    ...type.extensions.map((extension) => ({ tag: extension, extension })),
    ...Object.entries(type.fenceAliases ?? {}).map(([tag, extension]) => ({ tag, extension })),
  ];
}

/// One description PER TAG, not per type.
///
/// `LanguageDescription.load()` takes no argument, so a description cannot ask which of its aliases
/// matched. One per type would therefore have to pick a single dialect for the whole row, and
/// ```` ```ts ```` would load whatever ```` ```js ```` does. One per tag closes the gap: each
/// closes over the filename its own tag implies.
///
/// A type with no loader is left out entirely. Plain text and Makefile have no grammar, so a
/// description for either would resolve to nothing after a round trip.
export function fenceLanguages(enabled: readonly string[]): LanguageDescription[] {
  const seen = new Set<string>();

  return enabledFileTypes(enabled).flatMap((type) => {
    const load = LANGUAGE_LOADERS[type.id];
    if (load === null) return [];

    return tagsFor(type).flatMap(({ tag, extension }) => {
      // The id can repeat an extension - `go`, `diff`, `dockerfile` are both - and a tag answered
      // twice would resolve to whichever description came first.
      if (seen.has(tag)) return [];
      seen.add(tag);

      return [
        LanguageDescription.of({
          name: tag,
          // A fence tag is not a filename, but the loaders take one because a row can carry several
          // grammars. This is the filename the tag implies.
          load: () => load({ name: `fence.${extension}`, fileTypes: enabled }),
        }),
      ];
    });
  });
}
