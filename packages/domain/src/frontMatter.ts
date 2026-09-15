/// YAML front matter: the block between `---` lines at the very top of a document.
///
/// Obsidian shows it as a note's properties and GitHub as a table; GFM itself renders it as a rule
/// followed by a heading, which is the one thing it must not be. So it is taken off the top in both
/// flavours and shown as what it is.
///
/// **Not a YAML parser.** A property is a key and the values written for it - a scalar, an inline
/// `[a, b]` list or a `- item` list - which covers what Obsidian's properties view edits. Anything
/// else is kept as written under no key, rather than guessed at.

export interface FrontMatterProperty {
  /// Empty for a line that could not be read as a property.
  key: string;
  values: string[];
}

export interface FrontMatterSplit {
  /// Null when the document has no front matter.
  properties: FrontMatterProperty[] | null;
  /// The document with the front matter taken off, or the whole document when there was none.
  body: string;
}

const PROPERTY = /^([^\s:#-][^:]*?):(?:\s+(.*))?\s*$/;
const LIST_ITEM = /^\s+-\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function valuesOf(written: string): string[] {
  const value = written.trim();
  if (value === "") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter((item) => item !== "");
  }
  return [unquote(value)];
}

export function splitFrontMatter(text: string): FrontMatterSplit {
  const none = { properties: null, body: text };
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return none;

  const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\r?$/.test(line));
  if (close === -1) return none;

  const properties: FrontMatterProperty[] = [];
  for (const raw of lines.slice(1, close)) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;

    const item = LIST_ITEM.exec(line);
    const last = properties.at(-1);
    if (item !== null && last !== undefined && last.key !== "") {
      const value = unquote(item[1] ?? "");
      if (value !== "") last.values.push(value);
      continue;
    }

    const property = PROPERTY.exec(line);
    if (property !== null) {
      properties.push({ key: property[1]!.trim(), values: valuesOf(property[2] ?? "") });
      continue;
    }

    properties.push({ key: "", values: [line.trim()] });
  }

  return { properties, body: lines.slice(close + 1).join("\n") };
}
