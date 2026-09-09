import type { ResolvedImages } from "../hooks/useMarkdownImages";

/// Finding the pictures in rendered markdown, and putting the read ones back.
///
/// **Parsed, never matched with a regular expression.** The HTML here is generated and sanitised by
/// the app, so a pattern would work for a while - and then meet an `alt` containing `src="` and
/// rewrite an author's caption as though it were a source, silently, in their document. Parsing also
/// means the data URL is written into the attribute by the DOM rather than by hand, so it is escaped
/// by the thing that knows how.
///
/// Both functions take the SANITISED html and hand back something that goes to
/// `dangerouslySetInnerHTML`, so neither may introduce markup - only rewrite an attribute on an
/// element that is already there.

/// Parses without running anything.
///
/// `DOMParser` builds an inert document: scripts do not execute and `img` elements do not fetch, so
/// nothing here loads a resource merely by being looked at.
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/// Every image source in the document, as written, each one once.
///
/// Order is the order they appear, which is the order they will be asked for - so a README's first
/// picture is the first to arrive.
export function imageSourcesIn(html: string): string[] {
  const found = new Set<string>();

  for (const image of parse(html).querySelectorAll("img")) {
    // `getAttribute`, not `.src`: the property resolves against the document's base URL and would
    // hand back an absolute address, which is not what the author wrote and not what was resolved.
    const source = image.getAttribute("src");
    if (source !== null && source !== "") found.add(source);
  }

  return [...found];
}

/// The same HTML with every picture that was read pointing at its data.
///
/// A source with nothing read for it is left exactly as the author wrote it: a broken image says
/// there should be a picture there, where a blanked source says nothing at all and takes the alt
/// text's meaning with it.
export function withResolvedImages(html: string, resolved: ResolvedImages): string {
  // The common case is a document with no pictures, or none that resolved. Checked before parsing,
  // because this runs on every render of every rendered document.
  if (Object.keys(resolved).length === 0) return html;

  const document = parse(html);
  let changed = false;

  for (const image of document.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (source === null) continue;

    const data = resolved[source];
    if (data === undefined) continue;

    image.setAttribute("src", data);
    changed = true;
  }

  // Nothing matched, so hand back what came in rather than a re-serialised copy of it.
  return changed ? document.body.innerHTML : html;
}
