import { LanguageDescription } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import type { Tree } from "@lezer/common";
import { codeHighlighter } from "./editorTheme";
import { fenceLanguages } from "./fenceLanguages";

/// Colouring fenced code blocks in rendered markdown - Preview, and the chat panel's replies.
///
/// **A second pass over the DOM, rather than part of the renderer.** `renderMarkdown` is
/// synchronous and serves Preview, chat replies and the About box alike, while a grammar arrives
/// through a dynamic import. Making the renderer async would ripple through all three surfaces to
/// solve a problem only one of them has; colouring only with grammars that happened to be loaded
/// would mean a block is coloured if you visited Source first and not otherwise, which is worse
/// than not colouring it. So the markup is rendered and sanitised exactly as before, and this walks
/// what came out.
///
/// The colours come from the same table the editor's `HighlightStyle` is built from, so a document
/// cannot be one thing in Source and another in Preview.

const LANGUAGE_CLASS = /^language-(.+)$/;

/// The fence tag a rendered block carries, from the class marked puts on it.
function tagOf(code: Element): string | null {
  for (const name of code.classList) {
    const match = LANGUAGE_CLASS.exec(name);
    if (match !== null) return match[1]!;
  }
  return null;
}

/// The code, as text nodes and classed spans.
///
/// **Every piece is written with `textContent`, never as markup.** The text is the user's document
/// or a model's reply, it arrives from the renderer already escaped, and rebuilding a block by hand
/// is precisely where somebody would unescape it - a `<script>` inside a code block is text, and
/// has to stay text.
function spansFor(text: string, tree: Tree): Node[] {
  const out: Node[] = [];
  let at = 0;

  const put = (from: number, to: number, classes: string | null) => {
    if (to <= from) return;
    const slice = text.slice(from, to);
    if (classes === null) {
      out.push(document.createTextNode(slice));
      return;
    }
    const span = document.createElement("span");
    span.className = classes;
    span.textContent = slice;
    out.push(span);
  };

  highlightTree(tree, codeHighlighter, (from, to, classes) => {
    // The gap since the last token: whitespace and punctuation no rule claims. Without this the
    // code would come back with pieces missing.
    put(at, from, null);
    put(from, to, classes);
    at = to;
  });
  put(at, text.length, null);

  return out;
}

/// Colours every fenced block in `container` whose language is one the user has turned on.
///
/// Blocks are marked once done, so a re-render costs a query and nothing else - which matters for a
/// streaming reply, where this runs on every token that arrives. A block that was NOT coloured is
/// left unmarked deliberately: a half-typed fence during streaming becomes a real one a moment
/// later, and turning a file type on has to reach the blocks it was previously off for.
///
/// `cancelled` is checked after every await. The document can be replaced while a grammar is still
/// loading - a tab switch, the next token of a reply - and writing into it then would paint one
/// document's colouring onto another's text.
export async function highlightCodeBlocks(
  container: HTMLElement,
  fileTypes: readonly string[],
  cancelled: () => boolean,
): Promise<void> {
  const blocks = [...container.querySelectorAll("pre > code")].filter(
    (code) => !(code instanceof HTMLElement) || code.dataset.tpHighlighted === undefined,
  );
  if (blocks.length === 0) return;

  const languages = fenceLanguages(fileTypes);

  for (const code of blocks) {
    const tag = tagOf(code);
    if (tag === null) continue;

    const description = LanguageDescription.matchLanguageName(languages, tag, true);
    if (description === null) continue;

    let support;
    try {
      support = await description.load();
    } catch {
      // A chunk that will not load leaves the block as it was. Uncoloured code is still code.
      continue;
    }

    if (cancelled() || !container.contains(code)) continue;

    const text = code.textContent ?? "";
    code.replaceChildren(...spansFor(text, support.language.parser.parse(text)));
    if (code instanceof HTMLElement) code.dataset.tpHighlighted = tag;
  }
}
