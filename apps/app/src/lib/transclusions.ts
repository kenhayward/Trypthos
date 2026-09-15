import { embeddedSection, parseWikiLink } from "@trypthos/domain";
import { renderMarkdown } from "./markdown";
import { findWikiTarget } from "./markdownLinks";
import { readMarkdownImage } from "./markdownImages";
import type { ImageResult } from "./workspaceClient";

/// Another note's contents, shown where `![[Note]]`, `![[Note#Heading]]` or `![[Note#^block]]` is
/// written.
///
/// The renderer leaves a `.md-transclusion` placeholder holding a link to the note. This finds the
/// note by name, as a wiki link does, reads it, and puts what the embed names in the placeholder -
/// rendered by the same renderer, so it is sanitised like everything else, and kept under the link.
///
/// **It always ends.** A note may embed a note that embeds the first, or itself; each placeholder
/// knows the chain of notes it sits inside, and one naming a note already in that chain - or sitting
/// more than `MAX_EMBED_DEPTH` notes deep - is left as its link.

export const MAX_EMBED_DEPTH = 3;

export interface TransclusionDeps {
  /// The document on screen, qualified. The first note in every chain.
  fromPath: string | null;
  workspaceId: string | null;
  fileTypes: readonly string[];
  findByName?: (name: string, workspaceId: string) => Promise<readonly string[]>;
  /// A note's text, or null when it cannot be read.
  readDocument: (path: string) => Promise<string | null>;
  readImage?: (path: string) => Promise<ImageResult>;
}

type Outcome = "done" | "missing" | "cycle" | "too-deep";

/// How many rounds of nested embeds one pass follows - a bound on work, well beyond the depth limit.
const MAX_ROUNDS = 12;

export async function renderTransclusions(
  container: HTMLElement,
  cancelled: () => boolean,
  deps: TransclusionDeps,
): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const pending = [...container.querySelectorAll<HTMLElement>(".md-transclusion:not([data-tp-embedded])")];
    if (pending.length === 0) return;

    for (const embed of pending) {
      if (cancelled()) return;
      // Claimed before anything is awaited, so a second pass never starts the same one.
      embed.setAttribute("data-tp-embedded", "pending");
      const outcome = await fill(embed, container, cancelled, deps);
      if (cancelled()) return;
      embed.setAttribute("data-tp-embedded", outcome);
    }
  }
}

async function fill(
  embed: HTMLElement,
  container: HTMLElement,
  cancelled: () => boolean,
  deps: TransclusionDeps,
): Promise<Outcome> {
  // The note this placeholder sits in, and every note above it.
  const host = embed.parentElement?.closest<HTMLElement>("[data-embed-path]") ?? null;
  const chain = host === null
    ? (deps.fromPath === null ? [] : [deps.fromPath])
    : (host.getAttribute("data-embed-chain") ?? "").split("\n").filter((path) => path !== "");
  const hostPath = host?.getAttribute("data-embed-path") ?? deps.fromPath;

  const link = parseWikiLink(embed.getAttribute("data-embed-note") ?? "");
  const path = link.target === "" ? hostPath : await findWikiTarget(link.target, hostPath, deps);
  if (path === null) return "missing";
  if (chain.includes(path) && !(link.target === "" && (link.heading !== null || link.block !== null))) return "cycle";
  if (chain.length - 1 >= MAX_EMBED_DEPTH) return "too-deep";

  const text = await deps.readDocument(path);
  if (cancelled() || !container.contains(embed)) return "missing";
  const section = text === null ? null : embeddedSection(text, link);
  if (section === null) return "missing";

  const body = document.createElement("div");
  body.className = "md-transclusion-body";
  body.setAttribute("data-embed-path", path);
  body.setAttribute("data-embed-chain", [...chain, path].join("\n"));
  // `renderMarkdown` sanitises, as it does for every document.
  body.innerHTML = renderMarkdown(section, { flavour: "obsidian" });

  const title = embed.querySelector("a.md-embed");
  embed.replaceChildren(...(title === null ? [] : [title]), body);

  if (deps.readImage !== undefined) await drawImages(body, path, cancelled, deps);
  return "done";
}

/// Pictures in an embedded note, read relative to THAT note - its `![](local.png)` sits beside it,
/// not beside the document it is shown in.
async function drawImages(body: HTMLElement, path: string, cancelled: () => boolean, deps: TransclusionDeps) {
  for (const image of body.querySelectorAll<HTMLImageElement>("img")) {
    const source = image.getAttribute("src");
    if (source === null || source === "" || /^[a-z][a-z0-9+.-]*:/i.test(source)) continue;
    const data = await readMarkdownImage(source, path, deps.workspaceId, deps.readImage!, {
      embed: image.hasAttribute("data-embed"),
      findByName: deps.findByName,
    });
    if (cancelled()) return;
    if (data !== null) image.setAttribute("src", data);
  }
}
