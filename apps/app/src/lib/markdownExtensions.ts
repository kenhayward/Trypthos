import type { MarkedExtension, Token, Tokens } from "marked";
import {
  GITHUB_ALERT_TYPES,
  isImageName,
  isUnsupportedScheme,
  parseWikiLink,
  wikiLinkFileName,
  type FrontMatterProperty,
  type MarkdownFlavour,
} from "@trypthos/domain";

/// What GFM and Obsidian add to marked, as extensions.
///
/// Two sets. **Both flavours** get what GitHub itself renders beyond the GFM spec - footnotes, the
/// five alerts, heading ids - so a README reads here as it does there. **Obsidian** adds its own marks
/// on top. Every Obsidian mark is plain text to GFM, which is why the second set can only ever add.
///
/// Everything these emit is escaped by hand and sanitised afterwards like the rest of the renderer's
/// output: a note, and a model's reply about one, are untrusted input.

/// Escapes text for HTML, content and attribute alike.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// State for one render: footnote numbering and the heading ids already handed out.
///
/// Module-level rather than threaded through marked, because marked's extensions have nowhere to
/// carry it - and safe, because a render is synchronous from start to finish: `beginRender` resets it
/// and `footnotesHtml` reads it before anything else can run.
interface RenderState {
  /// Footnote ids by the number each reference was given, in reading order.
  numbers: Map<string, number>;
  /// Every footnote id something defines.
  defined: Set<string>;
  /// Rendered notes by number.
  notes: Map<number, string>;
  /// How many times each heading slug has been used, so a repeated heading gets its own id.
  slugs: Map<string, number>;
}

let state: RenderState = fresh();

function fresh(): RenderState {
  return { numbers: new Map(), defined: new Set(), notes: new Map(), slugs: new Map() };
}

export function beginRender(): void {
  state = fresh();
}

/// A heading's anchor, the way GitHub makes one: lowercase, punctuation dropped, spaces to hyphens.
/// Obsidian's `[[#Heading]]` goes through the same function, so a link and its target agree.
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/// The notes section, in number order, or nothing when no reference was made.
export function footnotesHtml(): string {
  if (state.notes.size === 0) return "";
  const items = [...state.notes.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([number, html]) =>
        `<li id="md-fn-${number}">${html} <a href="#fnref-${number}" data-md-link="" class="footnote-backref" title="Back">&#8617;</a></li>`,
    );
  return `<section class="footnotes"><ol>${items.join("")}</ol></section>`;
}

/// The properties table front matter becomes.
export function propertiesHtml(properties: readonly FrontMatterProperty[]): string {
  const rows = properties.map(
    ({ key, values }) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(values.join(", "))}</td></tr>`,
  );
  return `<table class="md-properties"><tbody>${rows.join("")}</tbody></table>`;
}

/// Obsidian's callout types, by every name that selects one.
const CALLOUT_TYPES: Readonly<Record<string, string>> = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

interface CalloutToken extends Tokens.Generic {
  type: "callout";
  kind: string;
  fold: "" | "+" | "-";
  /// Empty when the callout has no title of its own and is titled by its type.
  titleTokens: Token[];
  title: string;
  tokens: Token[];
}

const QUOTE_BLOCK = /^(?: {0,3}>[^\n]*(?:\n|$))+/;
const CALLOUT_HEAD = /^ {0,3}>[ \t]?\[!([^\]\s]+)\]([+-]?)[ \t]*([^\n]*)/;

/// Callouts, in one of two dialects.
///
/// GitHub's: one of its five types, the marker alone on its line, no fold, titled by the type. Every
/// other quote is left to be a quote. Obsidian's: any type - a type it does not know is styled as a
/// note - an optional title after the marker, and `+` or `-` to fold it open or closed.
function callouts(flavour: MarkdownFlavour): MarkedExtension {
  return {
    extensions: [
      {
        name: "callout",
        level: "block",
        start: (src) => src.match(/^ {0,3}>[ \t]?\[!/m)?.index,
        tokenizer(src) {
          const block = QUOTE_BLOCK.exec(src);
          const head = block === null ? null : CALLOUT_HEAD.exec(block[0]);
          if (block === null || head === null) return undefined;

          const written = head[1]!.toLowerCase();
          const fold = head[2] as "" | "+" | "-";
          const title = head[3]!.trim();
          if (flavour === "gfm" && (!GITHUB_ALERT_TYPES.has(written) || fold !== "" || title !== "")) {
            return undefined;
          }

          // One level of quote taken off every line; what is left is the callout's own markdown,
          // which may be another callout.
          const inner = block[0]
            .split("\n")
            .slice(1)
            .map((line) => line.replace(/^ {0,3}>[ \t]?/, ""))
            .join("\n");

          const kind = flavour === "gfm" ? written : (CALLOUT_TYPES[written] ?? "note");
          const token: CalloutToken = {
            type: "callout",
            raw: block[0],
            kind,
            fold,
            title: title === "" ? capitalised(written) : title,
            titleTokens: title === "" ? [] : this.lexer.inlineTokens(title),
            tokens: this.lexer.blockTokens(inner),
          };
          return token;
        },
        renderer(generic) {
          const token = generic as CalloutToken;
          const title =
            token.titleTokens.length === 0 ? escapeHtml(token.title) : this.parser.parseInline(token.titleTokens);
          const body = this.parser.parse(token.tokens);
          const kind = escapeHtml(token.kind);
          if (token.fold === "") {
            return `<div class="callout" data-callout="${kind}"><p class="callout-title">${title}</p><div class="callout-content">${body}</div></div>\n`;
          }
          const open = token.fold === "+" ? " open" : "";
          return `<details class="callout" data-callout="${kind}"${open}><summary class="callout-title">${title}</summary><div class="callout-content">${body}</div></details>\n`;
        },
        childTokens: ["titleTokens", "tokens"],
      },
    ],
  };
}

interface FootnoteRef extends Tokens.Generic {
  type: "footnoteRef";
  id: string;
}

interface FootnoteDef extends Tokens.Generic {
  type: "footnoteDef";
  id: string;
  tokens: Token[];
}

interface InlineFootnote extends Tokens.Generic {
  type: "inlineFootnote";
  id: string;
  tokens: Token[];
}

const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n+(?: {2,}|\t)[^\n]*)*)(?:\n+|$)/;

let inlineSerial = 0;

/// Footnotes: `[^id]` with a `[^id]: note` anywhere, and in Obsidian an inline `^[note]` too.
///
/// Numbered in the order references are read, the way GitHub and Obsidian both number them, and
/// gathered into one section at the end whatever order the notes were written in.
function footnotes(flavour: MarkdownFlavour): MarkedExtension {
  const extensions: MarkedExtension["extensions"] = [
    {
      name: "footnoteDef",
      level: "block",
      start: (src) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
      tokenizer(src) {
        const match = DEFINITION.exec(src);
        if (match === null) return undefined;
        const text = match[2]!.replace(/\n(?: {2,4}|\t)/g, "\n");
        const token: FootnoteDef = {
          type: "footnoteDef",
          raw: match[0],
          id: match[1]!,
          tokens: this.lexer.blockTokens(text),
        };
        return token;
      },
      renderer(generic) {
        const token = generic as FootnoteDef;
        const number = state.numbers.get(token.id);
        // A note nothing refers to is not shown, as on GitHub.
        if (number !== undefined && !state.notes.has(number)) {
          state.notes.set(number, this.parser.parse(token.tokens).trim());
        }
        return "";
      },
    },
    {
      name: "footnoteRef",
      level: "inline",
      start: (src) => src.indexOf("[^"),
      tokenizer(src) {
        const match = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
        if (match === null) return undefined;
        const token: FootnoteRef = { type: "footnoteRef", raw: match[0], id: match[1]! };
        return token;
      },
      renderer(generic) {
        const token = generic as FootnoteRef;
        const number = state.numbers.get(token.id);
        if (number === undefined || !state.defined.has(token.id)) return escapeHtml(token.raw);
        return `<sup class="footnote-ref"><a href="#fn-${number}" id="md-fnref-${number}" data-md-link="">${number}</a></sup>`;
      },
    },
  ];

  if (flavour === "obsidian") {
    extensions.push({
      name: "inlineFootnote",
      level: "inline",
      start: (src) => src.indexOf("^["),
      tokenizer(src) {
        const match = /^\^\[([^\]\n]+)\]/.exec(src);
        if (match === null) return undefined;
        inlineSerial += 1;
        const token: InlineFootnote = {
          type: "inlineFootnote",
          raw: match[0],
          id: `inline-${inlineSerial}`,
          tokens: this.lexer.inlineTokens(match[1]!),
        };
        return token;
      },
      renderer(generic) {
        const token = generic as InlineFootnote;
        const number = state.numbers.get(token.id)!;
        state.notes.set(number, this.parser.parseInline(token.tokens));
        return `<sup class="footnote-ref"><a href="#fn-${number}" id="md-fnref-${number}" data-md-link="">${number}</a></sup>`;
      },
    });
  }

  return {
    extensions,
    walkTokens(token) {
      if (token.type === "footnoteDef") state.defined.add((token as FootnoteDef).id);
      if (token.type === "footnoteRef" || token.type === "inlineFootnote") {
        const id = (token as FootnoteRef).id;
        if (!state.numbers.has(id)) state.numbers.set(id, state.numbers.size + 1);
      }
      if (token.type === "inlineFootnote") state.defined.add((token as InlineFootnote).id);
    },
  };
}

/// Heading ids, in both flavours - what an in-page link, a footnote and `[[#Heading]]` land on.
///
/// Prefixed, because an id is also a property of `document` in a browser: a heading called "Title"
/// with a bare `id="title"` is exactly what the sanitiser's clobbering protection strips.
function headingIds(): MarkedExtension {
  return {
    renderer: {
      heading({ tokens, depth, text }) {
        const base = headingSlug(text.replace(/\[\[|\]\]|[*_`~=]/g, ""));
        const used = state.slugs.get(base) ?? 0;
        state.slugs.set(base, used + 1);
        const slug = used === 0 ? base : `${base}-${used}`;
        return `<h${depth} id="md-${escapeHtml(slug)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  };
}

interface WikiToken extends Tokens.Generic {
  type: "wikilink" | "embed";
  inner: string;
}

const SIZE = /^(\d+)(?:x(\d+))?$/;

/// What a wiki link shows: its alias, or its target the way Obsidian writes one - `Note > Heading`.
function wikiLabel(inner: string): string {
  const link = parseWikiLink(inner);
  if (link.alias !== null) return link.alias;
  const within = link.heading ?? (link.block === null ? null : `^${link.block}`);
  if (link.target === "") return within ?? "";
  return within === null ? link.target : `${link.target} > ${within}`;
}

/// Where a wiki link points, as an href: the file it names, or a heading in this document.
///
/// Only the NAME is resolved here. Obsidian finds a note anywhere in the vault, which needs a search
/// of the workspace - that happens when the link is followed, from `data-wikilink`.
function wikiHref(inner: string): string | null {
  const link = parseWikiLink(inner);
  if (link.target === "") {
    if (link.heading !== null) return `#${headingSlug(link.heading)}`;
    return link.block === null ? null : `#^${link.block}`;
  }
  // A name no file can have is not a link. That covers a scheme too: a colon cannot be in one.
  if (/[<>:"|?*]/.test(link.target)) return null;
  const file = wikiLinkFileName(link.target);
  return isUnsupportedScheme(file) ? null : file;
}

/// Obsidian's inline marks: wiki links, embeds, highlights, comments, tags and block ids.
function obsidianInline(): MarkedExtension {
  return {
    extensions: [
      {
        name: "embed",
        level: "inline",
        start: (src) => src.indexOf("![["),
        tokenizer(src) {
          const match = /^!\[\[([^[\]\n]+)\]\]/.exec(src);
          if (match === null) return undefined;
          const token: WikiToken = { type: "embed", raw: match[0], inner: match[1]! };
          return token;
        },
        renderer(generic) {
          const { inner } = generic as WikiToken;
          const link = parseWikiLink(inner);
          if (isImageName(link.target)) {
            const size = link.alias === null ? null : SIZE.exec(link.alias);
            const dimensions =
              size === null ? "" : ` width="${size[1]}"${size[2] === undefined ? "" : ` height="${size[2]}"`}`;
            const alt = size === null && link.alias !== null ? link.alias : link.target;
            return `<img src="${escapeHtml(link.target)}" alt="${escapeHtml(alt)}"${dimensions} data-embed="">`;
          }
          const href = wikiHref(inner);
          const label = escapeHtml(wikiLabel(inner));
          if (href === null) return label;
          const written = escapeHtml(inner.split("|")[0]!);
          const anchor = `<a href="${escapeHtml(href)}" title="${escapeHtml(link.target)}" data-md-link="" data-wikilink="${written}" class="md-embed">${label}</a>`;
          // A note is shown in place once it has been read - see `transclusions`. Anything else Obsidian
          // embeds that the app cannot show, a PDF or a recording, stays a link to it.
          const note = link.target === "" || wikiLinkFileName(link.target).toLowerCase().endsWith(".md");
          return note ? `<span class="md-transclusion" data-embed-note="${written}">${anchor}</span>` : anchor;
        },
      },
      {
        name: "wikilink",
        level: "inline",
        start: (src) => src.indexOf("[["),
        tokenizer(src) {
          const match = /^\[\[([^[\]\n]+)\]\]/.exec(src);
          if (match === null) return undefined;
          const token: WikiToken = { type: "wikilink", raw: match[0], inner: match[1]! };
          return token;
        },
        renderer(generic) {
          const { inner } = generic as WikiToken;
          const href = wikiHref(inner);
          const label = escapeHtml(wikiLabel(inner));
          if (href === null) return label;
          const target = inner.split("|")[0]!;
          return `<a href="${escapeHtml(href)}" title="${escapeHtml(target)}" data-md-link="" data-wikilink="${escapeHtml(target)}">${label}</a>`;
        },
      },
      {
        name: "highlight",
        level: "inline",
        start: (src) => src.indexOf("=="),
        tokenizer(src) {
          const match = /^==(?=[^\s=])([^\n]*?[^\s=])==/.exec(src);
          if (match === null) return undefined;
          return { type: "highlight", raw: match[0], tokens: this.lexer.inlineTokens(match[1]!) };
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
        },
      },
      {
        name: "comment",
        level: "inline",
        start: (src) => src.indexOf("%%"),
        tokenizer(src) {
          const match = /^%%(?!%)[\s\S]+?%%/.exec(src);
          return match === null ? undefined : { type: "comment", raw: match[0] };
        },
        renderer: () => "",
      },
      {
        name: "blockId",
        level: "inline",
        start: (src) => src.match(/(?:^|[ \t])\^[A-Za-z0-9-]+[ \t]*(?:\n|$)/)?.index,
        tokenizer(src) {
          const match = /^[ \t]*\^([A-Za-z0-9-]+)[ \t]*(?=\n|$)/.exec(src);
          return match === null ? undefined : { type: "blockId", raw: match[0], id: match[1] };
        },
        renderer: (token) => `<span id="md-^${escapeHtml(String(token.id))}"></span>`,
      },
      {
        name: "tag",
        level: "inline",
        start(src) {
          const match = /(^|[\s(])#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])/u.exec(src);
          return match === null ? undefined : match.index + match[1]!.length;
        },
        tokenizer(src) {
          const match = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
          return match === null ? undefined : { type: "tag", raw: match[0] };
        },
        renderer: (token) => `<span class="md-tag">${escapeHtml(token.raw)}</span>`,
      },
    ],
  };
}

/// Obsidian's math: `$inline$` and `$$display$$`, in LaTeX.
///
/// Marked here and typeset after rendering, by `richBlocks`, so KaTeX is loaded only for a document
/// that uses it. What is marked is the TeX as TEXT - escaped, and taken before emphasis and the rest
/// can read `a_1 * b_2` as markdown.
///
/// Inline math follows Obsidian's rule, which is what keeps prose about money from becoming an
/// equation: no space just inside either dollar, and no digit straight after the closing one.
function obsidianMath(): MarkedExtension {
  return {
    extensions: [
      {
        name: "blockMath",
        level: "block",
        start: (src) => src.match(/^ {0,3}\$\$/m)?.index,
        tokenizer(src) {
          const match = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
          return match === null ? undefined : { type: "blockMath", raw: match[0], tex: match[1]!.trim() };
        },
        renderer: (token) => `<div class="md-math" data-display="">${escapeHtml(String(token.tex))}</div>\n`,
      },
      {
        name: "inlineMath",
        level: "inline",
        start: (src) => src.indexOf("$"),
        tokenizer(src) {
          const match = /^\$(?=[^\s$])((?:\\.|[^$\\\n])*?[^\s\\])\$(?!\d)/.exec(src);
          return match === null ? undefined : { type: "inlineMath", raw: match[0], tex: match[1] };
        },
        renderer: (token) => `<span class="md-math">${escapeHtml(String(token.tex))}</span>`,
      },
    ],
  };
}

/// Obsidian's block comments: `%%` alone on a line, to the next `%%` line.
function obsidianBlocks(): MarkedExtension {
  return {
    extensions: [
      {
        name: "blockComment",
        level: "block",
        start: (src) => src.match(/^ {0,3}%%/m)?.index,
        tokenizer(src) {
          const match = /^ {0,3}%%[^\n]*\n[\s\S]*?(?:\n {0,3}[^\n]*%%[ \t]*(?:\n+|$))/.exec(src);
          if (match === null || !/^ {0,3}%%[ \t]*\n/.test(match[0])) return undefined;
          return { type: "blockComment", raw: match[0] };
        },
        renderer: () => "",
      },
    ],
    // A task whose box holds anything but a space is done - `[?]`, `[-]` - as Obsidian treats it.
    walkTokens(token) {
      if (token.type !== "list_item" || token.task) return;
      const item = token as Tokens.ListItem;
      const match = /^\[([^\]\s])\][ \t]+/.exec(item.text);
      const first = item.tokens[0] as Tokens.Text | undefined;
      if (match === null || first === undefined || first.type !== "text") return;

      item.task = true;
      item.checked = true;
      item.text = item.text.slice(match[0].length);
      first.text = first.text.slice(match[0].length);
      first.raw = first.raw.slice(match[0].length);
      const lead = first.tokens?.[0] as Tokens.Text | undefined;
      if (lead?.type === "text") {
        lead.text = lead.text.slice(match[0].length);
        lead.raw = lead.raw.slice(match[0].length);
      }
      item.tokens.unshift({ type: "checkbox", raw: match[0], checked: true } as Tokens.Checkbox);
    },
  };
}

/// Everything a flavour adds to marked, in the order it must be tried.
export function flavourExtensions(flavour: MarkdownFlavour): MarkedExtension[] {
  const shared = [headingIds(), footnotes(flavour), callouts(flavour)];
  return flavour === "obsidian" ? [...shared, obsidianMath(), obsidianBlocks(), obsidianInline()] : shared;
}
