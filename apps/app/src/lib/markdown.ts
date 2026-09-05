import DOMPurify from "dompurify";
import { marked } from "marked";
import { isUnsupportedScheme } from "@trypthos/domain";

/// Markdown to sanitised HTML.
///
/// One renderer for the whole app: Preview mode, the chat panel's replies, and the About box. All
/// three display text the app did not write - a file from the user's workspace, or a model's output -
/// so all three are untrusted input and none gets its own bespoke pipeline.
///
/// Sanitising is not optional here. The renderer runs inside the app's own origin, so an unsanitised
/// `<script>` in somebody's notes would execute with whatever the page can reach.

marked.setOptions({
  // No syntax highlighting yet: highlighting the preview would be a second, divergent definition of
  // what a token is, and the editor already has one.
  gfm: true,
  breaks: false,
});

/// Escapes text for an HTML attribute value.
///
/// The href and title below are written into markup by hand, so they are escaped by hand. DOMPurify
/// runs afterwards and would catch an injected tag, but relying on that would make this function
/// correct only for as long as the sanitiser's configuration stays as it is.
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.use({
  renderer: {
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
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      // The mark goes on EVERY link, including the ones nothing will happen for. It is what makes
      // the click handler run, and a link the handler never sees is a link the window navigates to.
      const attributes = [`href="${escapeAttribute(href)}"`];

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
      if (hover !== null) attributes.push(`title="${escapeAttribute(hover)}"`);

      return `<a ${attributes.join(" ")} data-md-link="">${label}</a>`;
    },
  },
});

export function renderMarkdown(source: string): string {
  if (source.trim() === "") return "";

  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
