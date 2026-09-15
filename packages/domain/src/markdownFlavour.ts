import { splitFrontMatter } from "./frontMatter";

/// Which markdown a document is written in: GitHub Flavored Markdown, or Obsidian's.
///
/// Files do not say - both are `.md` - so it is read from the text. Obsidian's syntax is additive:
/// every mark it adds is plain text to GFM. That makes GFM the safe answer, and Obsidian the answer
/// only once something turns up that only Obsidian writes.
///
/// **Strong signals only.** A `#tag`, `$math$` or a front matter `tags:` key are all things a GitHub
/// README contains too, so none of them decides anything on its own. What does is listed in
/// `FLAVOUR_SIGNALS`, and each is matched strictly enough that ordinary prose does not trip it - see
/// the GFM cases in the tests, which are the reason for each pattern's shape.
///
/// A mode is a view, never a transform: the flavour chooses how the document is rendered and
/// nothing else. It never writes to the file.

export type MarkdownFlavour = "gfm" | "obsidian";
export type FlavourChoice = "auto" | MarkdownFlavour;

export const FLAVOUR_SIGNALS = [
  "wikilink",
  "embed",
  "comment",
  "highlight",
  "inlineFootnote",
  "blockId",
  "callout",
  "properties",
] as const;

export type FlavourSignal = (typeof FLAVOUR_SIGNALS)[number];

export interface DetectedFlavour {
  flavour: MarkdownFlavour;
  /// How many of each Obsidian mark were found. Only the ones found are present.
  signals: Partial<Record<FlavourSignal, number>>;
  /// True when the document is in an Obsidian vault - an `.obsidian` folder at or above its
  /// workspace - which decides it whatever the text holds.
  vault: boolean;
}

/// How much of a document is read. Every mark that decides the answer is common in a note that uses
/// it at all, so a very long file is judged by its opening rather than scanned whole on each edit.
export const FLAVOUR_SCAN_LIMIT = 200_000;

/// GitHub's five alert types, which render as callouts on GitHub too - so they say nothing about
/// Obsidian. Any other callout type, a fold marker or a title on the marker's line is Obsidian's:
/// GitHub's alert is the bare marker alone on its line.
export const GITHUB_ALERT_TYPES: ReadonlySet<string> = new Set(["note", "tip", "important", "warning", "caution"]);

const PATTERNS: Record<Exclude<FlavourSignal, "properties" | "callout">, RegExp> = {
  wikilink: /(?<!!)\[\[[^[\]\n]+\]\]/g,
  embed: /!\[\[[^[\]\n]+\]\]/g,
  // Something between the markers, so SQL's `'%%'` is not a comment.
  comment: /%%(?!%)[\s\S]+?%%/g,
  // No space inside either marker, so `a == b` is a comparison and `=====` a heading underline.
  highlight: /==(?=[^\s=])[^\n]*?[^\s=]==/g,
  inlineFootnote: /\^\[[^\]\n]+\]/g,
  // At the end of a line, after whitespace - `x^2` is not a block.
  blockId: /(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm,
};

const CALLOUT = /^[ \t]{0,3}(?:>[ \t]?)+\[!([^\]\s]+)\]([+-]?)([^\n]*)$/gm;

/// The text with code and escapes blanked out. Code shows syntax rather than using it: a note ABOUT
/// wiki links is not written in them.
function withoutCode(text: string): string {
  return (
    text
      // Fenced blocks, backticks or tildes, to their closing fence or the end of the document.
      .replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\1[ \t]*$|(?![\s\S]))/gm, "")
      .replace(/(`+)[^`]*?\1/g, "")
      .replace(/\\[\s\S]/g, "  ")
  );
}

export function detectFlavour(text: string, { vault = false }: { vault?: boolean } = {}): DetectedFlavour {
  const scanned = withoutCode(text.slice(0, FLAVOUR_SCAN_LIMIT));
  const signals: Partial<Record<FlavourSignal, number>> = {};
  const note = (signal: FlavourSignal, count: number) => {
    if (count > 0) signals[signal] = (signals[signal] ?? 0) + count;
  };

  for (const [signal, pattern] of Object.entries(PATTERNS) as [FlavourSignal, RegExp][]) {
    note(signal, scanned.match(pattern)?.length ?? 0);
  }

  let callouts = 0;
  for (const match of scanned.matchAll(CALLOUT)) {
    const titled = match[3]!.trim() !== "";
    if (match[2] !== "" || titled || !GITHUB_ALERT_TYPES.has(match[1]!.toLowerCase())) callouts += 1;
  }
  note("callout", callouts);

  const keys = splitFrontMatter(text).properties?.map((property) => property.key.toLowerCase()) ?? [];
  note("properties", keys.some((key) => key === "aliases" || key === "cssclasses" || key === "cssclass") ? 1 : 0);

  const found = Object.keys(signals).length > 0;
  return { flavour: vault || found ? "obsidian" : "gfm", signals, vault };
}

/// The flavour a document is rendered in: the detected one, unless the reader chose.
export function effectiveFlavour(detected: DetectedFlavour, choice: FlavourChoice): MarkdownFlavour {
  return choice === "auto" ? detected.flavour : choice;
}
