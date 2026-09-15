import { imageSource, pickWikiTarget, splitQualified } from "@trypthos/domain";
import type { ResolvedImages } from "../hooks/useMarkdownImages";
import type { ImageResult } from "./workspaceClient";

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

/// Reads one picture in rendered markdown, as a data URL, or null when it cannot be read.
///
/// The boundary is the domain's and is asked BEFORE the shell: a source that climbs out of the
/// workspace, or names something that is not a picture, is never requested. An Obsidian embed names a
/// picture rather than placing it, so one not beside its note is searched for by name - and only an
/// embed is. Shared by the document's own pictures and those inside an embedded note, which are read
/// relative to that note.
export async function readMarkdownImage(
  source: string,
  fromPath: string | null,
  workspaceId: string | null,
  readImage: (path: string) => Promise<ImageResult>,
  { embed = false, findByName }: {
    embed?: boolean;
    findByName?: (name: string, workspaceId: string) => Promise<readonly string[]>;
  } = {},
): Promise<string | null> {
  const target = imageSource(source, fromPath, workspaceId);
  if (target.kind !== "image") return null;

  let read = await readImage(target.path);
  const workspace = splitQualified(target.path)?.workspaceId;
  if (!read.ok && embed && findByName !== undefined && workspace !== undefined) {
    const name = source.slice(source.lastIndexOf("/") + 1);
    const found = pickWikiTarget(await findByName(name, workspace), source, fromPath);
    if (found !== null) read = await readImage(found);
  }
  return read.ok ? read.dataUrl : null;
}

/// The sources of Obsidian embeds, `![[diagram.png]]` - pictures named rather than placed, which may
/// need finding by name. The renderer marks each one `data-embed`.
export function embedSourcesIn(html: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const image of parse(html).querySelectorAll("img[data-embed]")) {
    const source = image.getAttribute("src");
    if (source !== null && source !== "") found.add(source);
  }
  return found;
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
