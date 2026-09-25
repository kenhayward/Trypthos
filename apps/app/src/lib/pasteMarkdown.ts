import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

/// Paste as markdown: what was copied from a rendered page, turned back into markdown source.
///
/// A rendered chat reply or web page copies as two things. The plain text is what the page LOOKED
/// like with the formatting taken away - headings as ordinary lines, list markers gone, and, from
/// some apps, paragraphs run together on one line. The HTML beside it still has every heading,
/// list, code block and table, so that is what this reads, and the plain text is the fallback.
///
/// An explicit command rather than the behaviour of every paste, deliberately: text copied from a
/// code editor carries HTML too, and a user pasting source code wants the characters, not a guess
/// at what they meant.

/// What the clipboard holds, as far as a paste cares. Either can be missing.
export interface ClipboardContent {
  readonly html: string | null;
  readonly text: string | null;
}

/// Written the way the formatting toolbar writes the same constructs, so a pasted block sits
/// naturally beside one the user made with a button: ATX headings, fenced code, `-` bullets.
function converter(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    fence: "```",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
  });
  service.use(gfm);
  // Turndown pads a list marker to four columns (`-   item`, `1.  item`). One space is what every
  // other list in a user's document has, and continuation lines are indented to match the marker so
  // a nested list still nests. A rule rather than a pass over the output, which could not tell a
  // list line from the same characters inside a code block.
  service.addRule("listItem", {
    filter: "li",
    replacement(content, node, options) {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const paragraph = /\n$/.test(content);
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "") + (paragraph ? "\n" : "");
      return prefix + body.replace(/\n/g, `\n${" ".repeat(prefix.length)}`) + (node.nextSibling ? "\n" : "");
    },
  });
  // Not content. A rendered code block usually carries a Copy button, and each of these would
  // otherwise arrive in the document as stray words.
  service.remove(["button", "script", "style", "noscript", "template"]);
  return service;
}

let shared: TurndownService | null = null;

export function htmlToMarkdown(html: string): string {
  shared ??= converter();
  return shared.turndown(html).trim();
}

/// The markdown a paste should insert, or null when the clipboard has nothing to give.
export function clipboardMarkdown(content: ClipboardContent): string | null {
  if (content.html) {
    const converted = htmlToMarkdown(content.html);
    if (converted !== "") return converted;
  }

  if (!content.text) return null;
  // U+2028 and U+2029 are Unicode's own line and paragraph separators. CodeMirror does not break
  // lines on them, so without this they arrive as one long line.
  return content.text.replace(/\u2029/g, "\n\n").replace(/\u2028/g, "\n");
}

/// Reads the system clipboard in the renderer.
///
/// The async Clipboard API rather than a paste event, because a toolbar press is not a paste: there
/// is no event carrying the data. Electron grants the renderer clipboard reads, and the press is a
/// user gesture in a focused window, which is what the API asks for.
export async function readSystemClipboard(): Promise<ClipboardContent> {
  const items = await navigator.clipboard.read();
  let html: string | null = null;
  let text: string | null = null;

  for (const item of items) {
    if (html === null && item.types.includes("text/html")) {
      html = await (await item.getType("text/html")).text();
    }
    if (text === null && item.types.includes("text/plain")) {
      text = await (await item.getType("text/plain")).text();
    }
  }
  return { html, text };
}
