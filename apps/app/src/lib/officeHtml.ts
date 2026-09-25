/// Clipboard HTML from word processors, rewritten as the plain HTML it means.
///
/// Word writes its clipboard HTML for Word to read back. The structure is there, but in Word's own
/// vocabulary: a list is a run of paragraphs styled `mso-list:l0 level2 lfo1` with the bullet as a
/// literal character in a span marked `mso-list:Ignore`, a title is `p.MsoTitle`, a table's header is
/// just its first row. Word for the web writes each list item as a one-item list tagged with its
/// level, and headings as paragraphs with `role="heading"`. Google Docs puts emphasis in span styles
/// and wraps the whole selection in a `<b>` that turns bold off again.
///
/// This pass turns each of those into the elements the markdown converter already understands -
/// `ul`/`ol`, `h1`-`h6`, `blockquote`, `pre`, `strong`/`em`/`del`/`code`, a table with a header row -
/// and removes what markdown has no way to say: fonts, colours, sizes, underline, spacing, and Word's
/// own bookkeeping (namespaced elements, conditional comments, bookmarks). Best effort, by design:
/// anything it does not recognise is left for the converter, which renders it as its text.
///
/// DOM in, DOM out, over an inert document from DOMParser: nothing here is ever attached to the page,
/// so nothing in the pasted HTML runs or loads.

const MONOSPACE = new Set([
  "consolas",
  "courier new",
  "courier",
  "monospace",
  "menlo",
  "monaco",
  "lucida console",
  "source code pro",
  "cascadia code",
  "cascadia mono",
  "fira code",
  "jetbrains mono",
  "sfmono-regular",
]);

/// The pasted HTML as a parsed body, rewritten. The caller converts the element, not a string, so
/// the HTML is parsed once.
export function normaliseClipboardHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  // Word, Word for the web (its `TextRun`/`OutlineElement` classes) and Google Docs (its guid). HTML
  // from anywhere else is left as it was on the few points that are only safe for these.
  const office = /urn:schemas-microsoft-com:office|content="?Microsoft Word|class="?Mso|mso-|class="[^"]*\b(TextRun|OutlineElement)\b|docs-internal-guid/i.test(
    html,
  );

  removeComments(body);
  // Before anything else reads the markup: a Word list's marker sits in a span whose font may be
  // Courier New, which the inline pass would otherwise turn into code.
  rebuildWordLists(body);
  removeAll(body, '[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
  rebuildLevelledLists(body);
  removeWordOnly(body);
  dropLocalImages(body);
  unwrapAnchors(body);
  renameByClassAndRole(body);
  collectCodeParagraphs(body);
  applyInlineStyles(body);
  if (office) spaceNonBreaking(body);
  dropEmptyParagraphs(body);
  shapeTables(body);
  return body;
}

// --- Word's bookkeeping -------------------------------------------------------------------------

/// Comments, including the conditional ones Word wraps its settings in and the `<![if ...]>` markers
/// that parse as comments.
function removeComments(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
}

function removeAll(root: HTMLElement, selector: string): void {
  for (const element of [...root.querySelectorAll(selector)]) element.remove();
}

/// Elements that are never content: Word's namespaced ones (`o:p`, `v:shape`, `w:...`), and a
/// page break drawn as a `<br>`.
function removeWordOnly(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll("*")]) {
    if (element.tagName.includes(":")) element.remove();
  }
  removeAll(root, "style, script, meta, link, title, xml");
  for (const br of [...root.querySelectorAll("br")]) {
    if (/page-break|mso-special-character/i.test(br.getAttribute("style") ?? "")) br.remove();
  }
}

/// A copied picture from Word is a temporary file on the machine that copied it, and one from
/// elsewhere can be a data URL the size of the picture. Neither belongs in a markdown file; a
/// picture on the web is left for the converter.
function dropLocalImages(root: HTMLElement): void {
  for (const image of [...root.querySelectorAll("img")]) {
    if (!/^https?:\/\//i.test(image.getAttribute("src") ?? "")) image.remove();
  }
}

/// A bookmark (`<a name>`) is not a link, and a link to a heading inside the document it came from
/// points nowhere once it is pasted. Both keep their text.
function unwrapAnchors(root: HTMLElement): void {
  for (const anchor of [...root.querySelectorAll("a")]) {
    const href = anchor.getAttribute("href");
    if (href === null || href.startsWith("#")) unwrap(anchor);
  }
}

// --- Lists --------------------------------------------------------------------------------------

interface ListItem {
  level: number;
  ordered: boolean;
  start: number | null;
  content: Node[];
}

/// The level of a Word list paragraph, or null for one that is not in a list.
function wordListLevel(element: Element): number | null {
  const match = /mso-list:\s*l\d+\s+level(\d+)/i.exec(element.getAttribute("style") ?? "");
  return match === null ? null : Number(match[1]);
}

/// A marker is numbered when it reads like one: `1.`, `a)`, `(iv)`. Bullets are whatever glyph the
/// list's font draws - `·` in Symbol, `§` in Wingdings, `o` in Courier New - so anything else is one.
function markerOf(paragraph: Element): { ordered: boolean; start: number | null } {
  const marker = paragraph.querySelector('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
  const text = (marker?.textContent ?? "").replace(/[\s\u00a0]+/g, "");
  const ordered = /^\(?(\d+|[a-z]|[ivxlcdm]+)[.)]$/i.test(text);
  const number = /^\(?(\d+)/.exec(text);
  return { ordered, start: ordered && number !== null ? Number(number[1]) : null };
}

/// Word's list paragraphs, run by run, replaced with nested lists.
function rebuildWordLists(root: HTMLElement): void {
  for (const container of [root, ...root.querySelectorAll("*")]) {
    let run: Element[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const items = run.map((paragraph): ListItem => {
        const { ordered, start } = markerOf(paragraph);
        removeAll(paragraph as HTMLElement, '[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
        return { level: wordListLevel(paragraph)!, ordered, start, content: [...paragraph.childNodes] };
      });
      replaceWithLists(run, items);
      run = [];
    };
    for (const child of [...container.children]) {
      if (child.tagName === "P" && wordListLevel(child) !== null) run.push(child);
      else if (child.textContent?.trim() !== "" || child.tagName !== "P") flush();
    }
    flush();
  }
}

/// Word for the web writes every list item as a list of its own, with its depth in
/// `data-aria-level`. Adjacent ones are one list.
function rebuildLevelledLists(root: HTMLElement): void {
  for (const wrapper of [...root.querySelectorAll(".ListContainerWrapper")]) unwrap(wrapper);

  const levelled = (element: Element) =>
    (element.tagName === "UL" || element.tagName === "OL") &&
    element.children.length > 0 &&
    [...element.children].every((item) => item.tagName === "LI" && item.hasAttribute("data-aria-level"));

  for (const container of [root, ...root.querySelectorAll("*")]) {
    let run: Element[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const items = run.flatMap((list) =>
        [...list.children].map((item): ListItem => {
          // A list item's paragraph is its line, not a paragraph of its own - a `p` inside an `li`
          // makes a loose list with a blank line between every item.
          for (const paragraph of [...item.querySelectorAll(":scope > p")]) unwrap(paragraph);
          return {
            level: Number(item.getAttribute("data-aria-level")) || 1,
            ordered: list.tagName === "OL",
            start: null,
            content: [...item.childNodes],
          };
        }),
      );
      replaceWithLists(run, items);
      run = [];
    };
    for (const child of [...container.children]) {
      if (levelled(child)) run.push(child);
      else flush();
    }
    flush();
  }
}

/// Builds nested lists from items in document order and puts them where `replaced` were.
function replaceWithLists(replaced: Element[], items: ListItem[]): void {
  const doc = replaced[0]!.ownerDocument;
  const roots: HTMLElement[] = [];
  const stack: { level: number; list: HTMLElement }[] = [];

  for (const item of items) {
    while (stack.length > 0 && stack.at(-1)!.level > item.level) stack.pop();
    if (stack.length === 0 || stack.at(-1)!.level < item.level) {
      const list = doc.createElement(item.ordered ? "ol" : "ul");
      if (item.start !== null && item.start !== 1) list.setAttribute("start", String(item.start));
      const parent = stack.at(-1)?.list.lastElementChild;
      if (parent) parent.append(list);
      else roots.push(list);
      stack.push({ level: item.level, list });
    }
    const entry = doc.createElement("li");
    entry.append(...item.content);
    stack.at(-1)!.list.append(entry);
  }

  replaced[0]!.before(...roots);
  for (const element of replaced) element.remove();
}

// --- Blocks -------------------------------------------------------------------------------------

function renameByClassAndRole(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll("p, div")]) {
    const kind = element.getAttribute("class") ?? "";
    const level = Number(element.getAttribute("aria-level"));
    if (element.getAttribute("role") === "heading" && level >= 1 && level <= 6) {
      rename(element, `h${level}`);
    } else if (/\bMsoTitle\b/.test(kind)) {
      rename(element, "h1");
    } else if (/\bMso(Intense)?Quote\b/.test(kind)) {
      const quote = element.ownerDocument.createElement("blockquote");
      element.before(quote);
      quote.append(element);
    }
  }
}

/// Paragraphs whose every character is in a monospaced font are code, and a run of them is one
/// block. Word has no code style of its own, so the font is the only thing that says so.
function collectCodeParagraphs(root: HTMLElement): void {
  const isCode = (element: Element) => element.tagName === "P" && !element.closest("li, td, th") && monospacedThroughout(element);

  for (const container of [root, ...root.querySelectorAll("*")]) {
    let run: Element[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const doc = run[0]!.ownerDocument;
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = run.map((paragraph) => (paragraph.textContent ?? "").replace(/\u00a0/g, " ")).join("\n");
      pre.append(code);
      run[0]!.before(pre);
      for (const paragraph of run) paragraph.remove();
      run = [];
    };
    for (const child of [...container.children]) {
      if (isCode(child)) run.push(child);
      else flush();
    }
    flush();
  }
}

function monospacedThroughout(element: Element): boolean {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let seen = false;
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if ((text.textContent ?? "").replace(/\u00a0/g, " ").trim() === "") continue;
    seen = true;
    if (!inMonospace(text.parentElement, element)) return false;
  }
  return seen;
}

/// Whether the nearest font named on the way up to `stop` is a monospaced one.
function inMonospace(from: Element | null, stop: Element): boolean {
  for (let element = from; element !== null; element = element.parentElement) {
    const family = fontFamily(element);
    if (family !== null) return MONOSPACE.has(family);
    if (element === stop) break;
  }
  return false;
}

function fontFamily(element: Element): string | null {
  const match = /(?:^|;)\s*font-family\s*:\s*([^;,]+)/i.exec(element.getAttribute("style") ?? "");
  return match === null ? null : match[1]!.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

// --- Inline -------------------------------------------------------------------------------------

/// Emphasis written as a style rather than an element: Google Docs and Word for the web do this for
/// everything, and Word does it for code.
function applyInlineStyles(root: HTMLElement): void {
  // Google Docs' outer `<b style="font-weight:normal">` is the whole selection, not bold text.
  for (const bold of [...root.querySelectorAll("b, strong")]) {
    if (/font-weight\s*:\s*(normal|[1-4]00)\b/i.test(bold.getAttribute("style") ?? "")) unwrap(bold);
  }

  for (const span of [...root.querySelectorAll("span, font")]) {
    const style = span.getAttribute("style") ?? "";
    if (span.closest("pre, code")) continue;
    if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(style) && !span.closest("b, strong, h1, h2, h3, h4, h5, h6, th")) {
      wrap(span, "strong");
    }
    if (/font-style\s*:\s*italic/i.test(style) && !span.closest("i, em")) wrap(span, "em");
    if (/text-decoration[^;]*line-through/i.test(style) && !span.closest("s, strike, del")) wrap(span, "del");
    const family = fontFamily(span);
    if (family !== null && MONOSPACE.has(family) && (span.textContent ?? "").trim() !== "") wrap(span, "code");
  }
}

/// Word spaces with non-breaking spaces wherever two spaces would otherwise collapse. In markdown
/// they are just spaces, and left in they would be invisible characters in the user's file.
function spaceNonBreaking(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (text.parentElement?.closest("pre")) continue;
    text.textContent = (text.textContent ?? "").replace(/\u00a0/g, " ");
  }
}

/// Word marks the gap between paragraphs with an empty one. The converter spaces blocks itself.
function dropEmptyParagraphs(root: HTMLElement): void {
  for (const paragraph of [...root.querySelectorAll("p")]) {
    if ((paragraph.textContent ?? "").replace(/\u00a0/g, " ").trim() === "" && !paragraph.querySelector("img")) {
      paragraph.remove();
    }
  }
}

// --- Tables -------------------------------------------------------------------------------------

/// A markdown table needs a header row and one line per cell. Word writes neither: its header is its
/// first row, and a cell holds paragraphs.
function shapeTables(root: HTMLElement): void {
  for (const table of [...root.querySelectorAll("table")]) {
    for (const cell of [...table.querySelectorAll("td, th")]) {
      const blocks = [...cell.querySelectorAll(":scope > p, :scope > div")];
      blocks.forEach((block, index) => {
        if (index > 0) block.before(" ");
        unwrap(block);
      });
    }

    if (table.querySelector("th") !== null) continue;
    const first = table.querySelector("tr");
    if (first === null) continue;
    for (const cell of [...first.querySelectorAll(":scope > td")]) rename(cell, "th");
  }
}

// --- DOM helpers --------------------------------------------------------------------------------

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes);
}

function wrap(element: Element, tag: string): void {
  const wrapper = element.ownerDocument.createElement(tag);
  wrapper.append(...element.childNodes);
  element.append(wrapper);
}

function rename(element: Element, tag: string): Element {
  const replacement = element.ownerDocument.createElement(tag);
  for (const attribute of [...element.attributes]) replacement.setAttribute(attribute.name, attribute.value);
  replacement.append(...element.childNodes);
  element.replaceWith(replacement);
  return replacement;
}
