import { splitFrontMatter } from "./frontMatter";
import { trimLeading, trimTrailing } from "./trimRun";

/// What an Obsidian embed shows of the note it names.
///
/// `![[Note]]` is the whole note, `![[Note#Heading]]` that heading and everything under it, and
/// `![[Note#^id]]` the one block carrying that id - a paragraph, a list item with what is nested
/// under it, or, for an id on a line of its own, the block just above it.
///
/// Pure, over the note's text. Code blocks are skipped throughout: a heading or an id inside one is
/// an example of the syntax, not a use of it.

/// The level, and everything after the first space or tab. The title is cut out of that by
/// `headingOf` rather than by the pattern: `[ \t]+(.*?)[ \t]*#*[ \t]*$` described the same thing and
/// took seconds to reject a line holding a few thousand tabs.
const HEADING = /^ {0,3}(#{1,6})[ \t](.*)$/;

/// A heading line's level and title, or null for a line that is not a heading.
function headingOf(line: string): { level: number; title: string } | null {
  const match = HEADING.exec(line);
  if (match === null) return null;
  const title = trimLeading(trimTrailing(trimTrailing(match[2]!, " \t"), "#"), " \t");
  return { level: match[1]!.length, title: trimTrailing(title, " \t") };
}
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])[ \t]/;

/// Which lines are inside a fenced code block, fence lines included.
function codeLines(lines: readonly string[]): boolean[] {
  const inside: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const opening = FENCE.exec(line);
    if (fence === null && opening !== null) {
      fence = opening[1]!;
      inside.push(true);
    } else if (fence !== null) {
      inside.push(true);
      if (line.trim().startsWith(fence[0]!.repeat(fence.length))) fence = null;
    } else {
      inside.push(false);
    }
  }
  return inside;
}

const tidy = (lines: readonly string[]) => lines.join("\n").replace(/^\s*\n/, "").trimEnd();

export function embeddedSection(
  text: string,
  { heading, block }: { heading: string | null; block: string | null },
): string | null {
  const lines = splitFrontMatter(text).body.split("\n").map((line) => line.replace(/\r$/, ""));
  const code = codeLines(lines);

  if (block !== null) return blockSection(lines, code, block);
  if (heading === null) return tidy(lines);

  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line, index) => {
    const match = code[index] ? null : headingOf(line);
    return match !== null && match.title.trim().toLowerCase() === wanted;
  });
  if (start === -1) return null;

  const level = headingOf(lines[start]!)!.level;
  let end = start + 1;
  while (end < lines.length) {
    const match = code[end] ? null : headingOf(lines[end]!);
    if (match !== null && match.level <= level) break;
    end += 1;
  }
  return tidy(lines.slice(start, end));
}

function blockSection(lines: readonly string[], code: readonly boolean[], id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`(?:^|[ \\t])\\^${escaped}[ \\t]*$`);
  const at = lines.findIndex((line, index) => !code[index] && marker.test(line));
  if (at === -1) return null;

  const strip = (line: string) => line.replace(new RegExp(`[ \\t]*\\^${escaped}[ \\t]*$`), "");
  const blank = (index: number) => lines[index]!.trim() === "";

  // An id alone on its line names the block above it.
  if (lines[at]!.trim() === `^${id}`) {
    let last = at - 1;
    while (last >= 0 && blank(last)) last -= 1;
    if (last < 0) return null;
    let first = last;
    while (first > 0 && !blank(first - 1)) first -= 1;
    return tidy(lines.slice(first, last + 1));
  }

  // On a list item: that item, and what is nested under it.
  const item = LIST_ITEM.exec(lines[at]!);
  if (item !== null) {
    const indent = item[1]!.length;
    let end = at + 1;
    while (end < lines.length && !blank(end) && /^\s*/.exec(lines[end]!)![0].length > indent) end += 1;
    return tidy([strip(lines[at]!), ...lines.slice(at + 1, end)]);
  }

  // Otherwise the paragraph it ends.
  let first = at;
  while (first > 0 && !blank(first - 1)) first -= 1;
  return tidy([...lines.slice(first, at), strip(lines[at]!)]);
}
