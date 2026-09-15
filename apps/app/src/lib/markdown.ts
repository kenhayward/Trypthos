import DOMPurify from "dompurify";
import { Marked, type MarkedExtension } from "marked";
import { isUnsupportedScheme, splitFrontMatter, type MarkdownFlavour } from "@trypthos/domain";
import { beginRender, escapeHtml, flavourExtensions, footnotesHtml, propertiesHtml } from "./markdownExtensions";

/// Markdown to sanitised HTML.
///
/// One renderer for the whole app: Preview mode, the chat panel's replies, and the About box. All
/// three display text the app did not write - a file from the user's workspace, or a model's output -
/// so all three are untrusted input and none gets its own bespoke pipeline.
///
/// Sanitising is not optional here. The renderer runs inside the app's own origin, so an unsanitised
/// `<script>` in somebody's notes would execute with whatever the page can reach.
///
/// **Two flavours, one pipeline.** GFM - with what GitHub renders beyond the spec: footnotes, alerts,
/// front matter - and Obsidian's on top of it. See `markdownExtensions`. Which one a document is in is
/// decided by `detectFlavour` and the reader, never here; a caller that says nothing gets GFM.

/// Every link is marked and carries its target.
///
/// `data-md-link` is what the click handler matches on. Matching instead on the class of the
/// element the HTML was injected into would mean naming each surface that renders markdown, and
/// the surface added next would quietly navigate the window rather than open the target - which
/// is the bug this exists to prevent, reappearing somewhere else.
///
/// `title` is the hover readout: a link says where it goes before it is clicked, which is how a
/// file in the open folder can be told from a web address. An author's own title wins, because
/// they wrote it to say something the target does not.
const links: MarkedExtension = {
  renderer: {
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      // The mark goes on EVERY link, including the ones nothing will happen for. It is what makes
      // the click handler run, and a link the handler never sees is a link the window navigates to.
      const attributes = [`href="${escapeHtml(href)}"`];

      // A scheme the app refuses is not shown on hover. `javascript:` is the case that matters: the
      // sanitiser removes it from the href, and repeating it in a title would put it back into the
      // page - inert there, but naming a target nothing will open is worse than saying nothing.
      //
      // Only the SCHEME is judged here. Whether a relative path resolves to a file in the workspace
      // depends on which document is open and which file types are turned on, neither of which this
      // renderer knows or may guess - the same markdown is rendered in the chat panel and the About
      // box. Asking `isUnsupportedScheme` rather than `linkAction` is what keeps it out of that.
      const refused = isUnsupportedScheme(href);
      const hover = title ?? (refused ? null : href);
      if (hover !== null) attributes.push(`title="${escapeHtml(hover)}"`);

      return `<a ${attributes.join(" ")} data-md-link="">${label}</a>`;
    },
  },
};

function renderer(flavour: MarkdownFlavour): Marked {
  return new Marked(
    {
      // No syntax highlighting here: highlighting the preview would be a second, divergent definition
      // of what a token is, and the editor already has one. Code is coloured after rendering.
      gfm: true,
      // Obsidian shows a line break where the author made one, unless its "strict line breaks"
      // setting is on - and it is off by default. GFM joins the lines of a paragraph.
      breaks: flavour === "obsidian",
    },
    links,
    ...flavourExtensions(flavour),
  );
}

const RENDERERS: Record<MarkdownFlavour, Marked> = {
  gfm: renderer("gfm"),
  obsidian: renderer("obsidian"),
};

export function renderMarkdown(
  source: string,
  { flavour = "gfm" }: { flavour?: MarkdownFlavour } = {},
): string {
  if (source.trim() === "") return "";

  // Front matter is taken off before marked sees it, in both flavours: GFM would render it as a rule
  // followed by a heading made of the last property.
  const { properties, body } = splitFrontMatter(source);

  beginRender();
  const html =
    (properties === null ? "" : propertiesHtml(properties)) +
    RENDERERS[flavour].parse(body, { async: false }) +
    footnotesHtml();

  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
