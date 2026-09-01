import DOMPurify from "dompurify";
import { marked } from "marked";

/// Markdown to sanitised HTML.
///
/// One renderer for the whole app: Preview mode and, later, the chat panel's replies. Both display
/// text the app did not write - a file from the user's workspace, or a model's output - so both are
/// untrusted input and neither gets its own bespoke pipeline.
///
/// Sanitising is not optional here. The renderer runs inside the app's own origin, so an unsanitised
/// `<script>` in somebody's notes would execute with whatever the page can reach.

marked.setOptions({
  // No syntax highlighting yet: highlighting the preview would be a second, divergent definition of
  // what a token is, and the editor already has one.
  gfm: true,
  breaks: false,
});

export function renderMarkdown(source: string): string {
  if (source.trim() === "") return "";

  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
