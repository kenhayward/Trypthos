import { tags } from "@lezer/highlight";
import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";
import { obsidianTags } from "./obsidianTags";

/// Obsidian's marks, as extensions to the editor's markdown parser.
///
/// The Preview renderer has its own implementation of the same syntax (`markdownExtensions.ts`),
/// because marked and Lezer share nothing. The rules are kept the same on purpose - the same
/// wiki link, the same no-space-inside rule for `==` and `$`, the same letter a tag needs - and each
/// side's tests hold the same GFM cases that must not trip it.
///
/// Loaded only with the markdown language, and only for an Obsidian document: `languageLoaders`
/// imports this dynamically.

const TAG_BODY = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u;
const WIKI = /^\[\[([^[\]\n]+)\]\]/;
const EMBED = /^!\[\[([^[\]\n]+)\]\]/;
const COMMENT = /^%%(?!%)[\s\S]+?%%/;
const MATH = /^\$(?=[^\s$])(?:\\.|[^$\\\n])*?[^\s\\]\$(?!\d)/;
const BLOCK_ID = /^\^[A-Za-z0-9-]+(?=[ \t]*(?:\n|$))/;
const CALLOUT = /^\[![^\]\s]+\][+-]?/;

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === -1;

const Highlight = { resolve: "Highlight", mark: "HighlightMark" };

/// The parts of a wiki link: its brackets, the target, and - with an alias - the bar and the alias.
/// An aliased target is its own node, because it is what Live hides.
function wikiParts(cx: InlineContext, from: number, open: string, inner: string, mark: string) {
  const start = from + open.length;
  const end = start + inner.length;
  const bar = inner.indexOf("|");
  const middle =
    bar === -1
      ? [cx.elt("WikiLinkTarget", start, end)]
      : [
          cx.elt("WikiLinkAliasedTarget", start, start + bar),
          cx.elt("WikiLinkBar", start + bar, start + bar + 1),
          cx.elt("WikiLinkAlias", start + bar + 1, end),
        ];
  return [cx.elt(mark, from, start), ...middle, cx.elt(mark, end, end + 2)];
}

/// A block that runs from a line opening with `fence` to the line ending with it - `$$` math, `%%`
/// comments. Written on one line (`$$x^2$$`) when the opening line closes itself.
function fencedBlock(name: string, fence: string, alone: boolean) {
  return {
    name,
    parse(cx: BlockContext, line: Line) {
      const text = line.text.slice(line.pos);
      if (!text.startsWith(fence)) return false;
      const rest = text.slice(fence.length);
      if (alone && rest.trim() !== "") return false;

      const start = cx.lineStart + line.pos;
      let end = cx.lineStart + line.text.length;
      const closesItself = !alone && rest.trimEnd().endsWith(fence) && rest.trim().length > fence.length;

      if (!closesItself) {
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (line.text.trimEnd().endsWith(fence)) break;
        }
      }
      cx.nextLine();
      cx.addElement(cx.elt(name, start, end));
      return true;
    },
  };
}

export const OBSIDIAN_MARKDOWN: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
    { name: "WikiLinkTarget", style: tags.link },
    { name: "WikiLinkAliasedTarget", style: tags.url },
    { name: "WikiLinkBar", style: tags.processingInstruction },
    { name: "WikiLinkAlias", style: tags.link },
    { name: "Embed", style: tags.link },
    { name: "EmbedMark", style: tags.processingInstruction },
    { name: "Highlight", style: obsidianTags.highlight },
    { name: "HighlightMark", style: tags.processingInstruction },
    { name: "Comment", style: tags.comment },
    { name: "CommentMark", style: tags.processingInstruction },
    { name: "BlockComment", block: true, style: tags.comment },
    { name: "Tag", style: obsidianTags.tag },
    { name: "InlineMath", style: obsidianTags.math },
    { name: "InlineMathMark", style: tags.processingInstruction },
    { name: "BlockMath", block: true, style: obsidianTags.math },
    { name: "BlockId", style: tags.meta },
    { name: "CalloutMark", style: obsidianTags.callout },
  ],
  parseBlock: [fencedBlock("BlockMath", "$$", false), fencedBlock("BlockComment", "%%", true)],
  parseInline: [
    {
      name: "Embed",
      before: "Image",
      parse(cx, next, pos) {
        if (next !== 33 || cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1;
        const match = EMBED.exec(cx.slice(pos, cx.end));
        if (match === null) return -1;
        const end = pos + match[0].length;
        return cx.addElement(cx.elt("Embed", pos, end, wikiParts(cx, pos, "![[", match[1]!, "EmbedMark")));
      },
    },
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        const match = WIKI.exec(cx.slice(pos, cx.end));
        if (match === null) return -1;
        const end = pos + match[0].length;
        return cx.addElement(cx.elt("WikiLink", pos, end, wikiParts(cx, pos, "[[", match[1]!, "WikiLinkMark")));
      },
    },
    {
      name: "CalloutMark",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 33 || pos !== cx.offset) return -1;
        const match = CALLOUT.exec(cx.slice(pos, cx.end));
        return match === null ? -1 : cx.addElement(cx.elt("CalloutMark", pos, pos + match[0].length));
      },
    },
    {
      name: "Comment",
      parse(cx, next, pos) {
        if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
        const match = COMMENT.exec(cx.slice(pos, cx.end));
        if (match === null) return -1;
        const end = pos + match[0].length;
        return cx.addElement(
          cx.elt("Comment", pos, end, [cx.elt("CommentMark", pos, pos + 2), cx.elt("CommentMark", end - 2, end)]),
        );
      },
    },
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        const match = MATH.exec(cx.slice(pos, cx.end));
        if (match === null) return -1;
        const end = pos + match[0].length;
        return cx.addElement(
          cx.elt("InlineMath", pos, end, [cx.elt("InlineMathMark", pos, pos + 1), cx.elt("InlineMathMark", end - 1, end)]),
        );
      },
    },
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61 || cx.char(pos - 1) === 61) return -1;
        const before = cx.char(pos - 1);
        const after = cx.char(pos + 2);
        return cx.addDelimiter(Highlight, pos, pos + 2, !isSpace(after), !isSpace(before));
      },
    },
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== 35) return -1;
        const before = cx.char(pos - 1);
        if (pos !== cx.offset && !isSpace(before) && before !== 40) return -1;
        const match = TAG_BODY.exec(cx.slice(pos, cx.end));
        return match === null ? -1 : cx.addElement(cx.elt("Tag", pos, pos + match[0].length));
      },
    },
    {
      name: "BlockId",
      parse(cx, next, pos) {
        if (next !== 94) return -1;
        if (pos !== cx.offset && !isSpace(cx.char(pos - 1))) return -1;
        const match = BLOCK_ID.exec(cx.slice(pos, cx.end));
        return match === null ? -1 : cx.addElement(cx.elt("BlockId", pos, pos + match[0].length));
      },
    },
  ],
};
