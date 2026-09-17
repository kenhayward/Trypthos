import { splitFrontMatter } from "./frontMatter";
import { isExternalUrl, isUnsupportedScheme } from "./markdownLink";
import { parseWikiLink } from "./wikiLink";

/// The links and tags one note carries, as the vault graph reads them.
///
/// Nothing here resolves anything: a wiki link is kept as the name written, and a markdown link as
/// the path written. Resolution needs the whole vault, which is `vaultGraph.ts`'s job, and keeping it
/// out of here is what lets the shell extract a note once and resolve it again whenever the file
/// list changes.

export type NoteReference = { kind: "wiki"; target: string } | { kind: "path"; path: string };

export interface NoteReferences {
  links: NoteReference[];
  tags: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const WIKI = /!?\[\[([^[\]\n]+)\]\]/g;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\s*\)/g;
const LINK_DESTINATION = /(!?\[[^\]\n]*\])(\(\s*(?:<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\))/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const COMMENT = /%%[\s\S]*?%%/g;
const CODE_SPAN = /(`+)[^`\n]*?\1/g;
const TAG_KEYS = new Set(["tags", "tag"]);
/// A list item marker, `-`/`*`/`+` or a numbered `1.`/`1)`, with the space after it that makes it one.
const LIST_ITEM_LINE = /^\s*([-*+]|\d+[.)])\s/;

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/// Every character Obsidian does not read as markup replaced by a space, newlines kept.
///
/// Masking rather than deleting keeps a tag's neighbour a neighbour: deleting a code span would glue
/// the words either side together, and `a`x`#b` would read as a tag.
///
/// Indented code is relative to the list item's own content column, not the left margin, so an
/// indented line is only treated as code when nothing above it - back to the last blank line - was a
/// list. Losing that distinction is how a loose list's second line, or a nested list item, reads as a
/// fenced-off code block instead of the content it is.
export function maskIgnored(body: string): string {
  const lines = body.split("\n");
  let fence: string | null = null;
  let previousBlank = true;
  let inIndented = false;
  let inList = false;

  const masked = lines.map((line) => {
    if (fence !== null) {
      const closing = FENCE.exec(line);
      if (closing !== null && closing[1]![0] === fence[0] && closing[1]!.length >= fence.length) fence = null;
      inList = false;
      return blank(line);
    }
    const opening = FENCE.exec(line);
    if (opening !== null) {
      fence = opening[1]!;
      previousBlank = false;
      inIndented = false;
      inList = false;
      return blank(line);
    }

    const isBlank = line.trim() === "";
    if (isBlank) {
      previousBlank = true;
      return line;
    }

    const indented = /^( {4}|\t)/.test(line);
    if (indented && inList) {
      previousBlank = false;
      return line;
    }
    if (indented && (previousBlank || inIndented)) {
      inIndented = true;
      previousBlank = false;
      return blank(line);
    }

    inIndented = false;
    inList = LIST_ITEM_LINE.test(line);
    previousBlank = false;
    return line;
  });

  return masked.join("\n").replace(COMMENT, blank).replace(CODE_SPAN, blank);
}

/// A masked body with every markdown link's destination - the `(...)` part - blanked too.
///
/// Only for scanning tags: `[h](#top)` names a fragment, never a tag, but plain prose written the
/// same way Obsidian reads it - `(#project/atlas)` with no `[label]` before it - is not a link and
/// must keep working. The label (`[...]`) is left alone, since a tag is never written there in a way
/// that matters here and there is nothing about label text that should be hidden from the tag scan.
function maskLinkDestinations(masked: string): string {
  return masked.replace(LINK_DESTINATION, (_full, label: string, destination: string) => label + blank(destination));
}

function pathOf(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  if (isExternalUrl(trimmed) || isUnsupportedScheme(trimmed)) return null;
  const bare = trimmed.split(/[#?]/)[0]!;
  try {
    const decoded = decodeURIComponent(bare);
    return decoded === "" || decoded.includes("\0") ? null : decoded.replace(/\\/g, "/");
  } catch {
    return null;
  }
}

export function extractReferences(text: string): NoteReferences {
  const { properties, body } = splitFrontMatter(text);
  const links: NoteReference[] = [];
  const seenLinks = new Set<string>();
  const tags: string[] = [];
  const seenTags = new Set<string>();

  const addLink = (reference: NoteReference) => {
    const key = reference.kind === "wiki" ? `w:${reference.target}` : `p:${reference.path}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push(reference);
  };
  const addTag = (raw: string) => {
    const tag = raw.replace(/^#/, "").toLowerCase();
    if (!/^[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*$/u.test(tag) || seenTags.has(tag)) return;
    seenTags.add(tag);
    tags.push(tag);
  };
  const readWiki = (source: string) => {
    for (const match of source.matchAll(WIKI)) {
      const target = parseWikiLink(match[1]!).target;
      if (target !== "") addLink({ kind: "wiki", target });
    }
  };

  for (const property of properties ?? []) {
    for (const value of property.values) {
      readWiki(value);
      if (TAG_KEYS.has(property.key.toLowerCase())) {
        for (const part of value.split(/[,\s]+/)) if (part !== "") addTag(part);
      }
    }
  }

  const masked = maskIgnored(body);
  readWiki(masked);
  for (const match of masked.matchAll(MARKDOWN_LINK)) {
    const found = pathOf(match[1] ?? match[2] ?? "");
    if (found !== null) addLink({ kind: "path", path: found });
  }
  for (const match of maskLinkDestinations(masked).matchAll(TAG)) addTag(match[2]!);

  return { links, tags };
}
