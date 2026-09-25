import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import { normaliseClipboardHtml } from "./officeHtml";

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
  // A line break inside a table cell. A markdown table row is one line, so the table plugin writes a
  // break as `<br>`; left to the default rule it would carry the two trailing spaces of a markdown
  // hard break in front of it.
  service.addRule("cellBreak", {
    filter: (node) => node.nodeName === "BR" && node.parentElement?.closest("td, th") != null,
    replacement: () => "\n",
  });
  // Not content. A rendered code block usually carries a Copy button, and each of these would
  // otherwise arrive in the document as stray words.
  service.remove(["button", "script", "style", "noscript", "template"]);
  return service;
}

let shared: TurndownService | null = null;

export function htmlToMarkdown(html: string): string {
  shared ??= converter();
  // Normalised first, so Word's, Word for the web's and Google Docs' own ways of writing a heading,
  // a list or emphasis arrive as the plain elements the converter reads.
  return shared.turndown(normaliseClipboardHtml(html)).trim();
}

/// The markdown a paste should insert, or null when the clipboard has nothing to give.
export function clipboardMarkdown(content: ClipboardContent): string | null {
  if (content.html) {
    const converted = htmlToMarkdown(content.html);
    if (converted !== "") return converted;
  }

  if (!content.text) return null;
  const table = tabSeparatedTable(content.text);
  if (table !== null) return table;
  // U+2028 and U+2029 are Unicode's own line and paragraph separators. CodeMirror does not break
  // lines on them, so without this they arrive as one long line.
  return content.text.replace(/\u2029/g, "\n\n").replace(/\u2028/g, "\n");
}

/// Tab-separated text - a spreadsheet range, from a program that offers nothing richer - as a
/// markdown table, or null when the text is not one.
///
/// It is a table when there are at least two rows, every row has the same number of cells, there
/// are at least two, and no row starts with a tab: code indented with tabs has tabs on every line
/// as well, but never a cell before the first one. A cell holding a tab, a quote or a line break
/// arrives quoted, the way Excel writes it.
export function tabSeparatedTable(text: string): string | null {
  const rows = parseTabSeparated(text.replace(/\r\n?/g, "\n").replace(/\n+$/, ""));
  if (rows === null || rows.length < 2) return null;
  const width = rows[0]!.length;
  if (width < 2 || rows.some((row) => row.length !== width)) return null;

  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`;
  return [line(rows[0]!), line(rows[0]!.map(() => "---")), ...rows.slice(1).map(line)].join("\n");
}

/// Rows of cells, or null for text that has a line starting with a tab.
function parseTabSeparated(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
    } else if (character === "\t") {
      if (row.length === 0 && cell === "") return null;
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else {
      cell += character;
      atCellStart = false;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/// Reads the system clipboard in the renderer.
///
/// The async Clipboard API rather than a paste event, because a toolbar press is not a paste: there
/// is no event carrying the data. Electron grants the renderer clipboard reads, and the press is a
/// user gesture in a focused window, which is what the API asks for.
///
/// The HTML is asked for unsanitised. The browser's sanitiser re-serialises clipboard HTML, and Word's
/// list levels and style classes do not survive the trip. That is safe here because the HTML is only
/// ever parsed into an inert document and turned into text - it never reaches the page.
export async function readSystemClipboard(): Promise<ClipboardContent> {
  const read = navigator.clipboard.read.bind(navigator.clipboard) as (options?: {
    unsanitized?: string[];
  }) => Promise<ClipboardItems>;
  let items: ClipboardItems;
  try {
    items = await read({ unsanitized: ["text/html"] });
  } catch {
    // An engine that does not know the option may refuse it rather than ignore it.
    items = await read();
  }
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
