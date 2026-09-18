/// Lucide's icons, which is what Iconic's ids name.
///
/// **Lazy, always.** The set is 1,848 icons and 417KB minified - far too much for the initial
/// bundle, and wanted only by a vault that has actually assigned icons. `iconBundle.test.ts` is what
/// keeps it that way, because a static import here would type-check and render perfectly while
/// putting the whole set on every page load.
///
/// The allow-lists below are not a sanitiser. The data is ours, from a pinned dependency, and these
/// seven elements and sixteen attributes are everything the whole set uses today. They are here so
/// that a future version introducing markup nobody reviewed is dropped rather than drawn.

export type IconNode = readonly [string, Readonly<Record<string, string>>];

const ELEMENTS = new Set(["path", "circle", "ellipse", "line", "polygon", "polyline", "rect"]);

const ATTRIBUTES = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "height",
  "points",
  "r",
  "rx",
  "ry",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

/// Iconic writes `lucide-<kebab-name>`. The pattern is narrow deliberately: the name becomes a key
/// in a lookup, and a name with a slash or a dot in it is a name this app has misread.
const LUCIDE_ID = /^lucide-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function lucideName(icon: string): string | null {
  return LUCIDE_ID.exec(icon)?.[1] ?? null;
}

/// Anything that is not a Lucide id is drawn as text, which is what an emoji assignment is.
export function isEmojiIcon(icon: string): boolean {
  return lucideName(icon) === null;
}

export function safeNodes(raw: unknown): IconNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: IconNode[] = [];
  for (const node of raw) {
    if (!Array.isArray(node) || node.length < 2) return [];
    const element: unknown = node[0];
    const attributes: unknown = node[1];
    if (typeof element !== "string") return [];
    if (!ELEMENTS.has(element)) continue;
    if (attributes === null || typeof attributes !== "object") continue;
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (ATTRIBUTES.has(name) && typeof value === "string") kept[name] = value;
    }
    nodes.push([element, kept]);
  }
  return nodes;
}

let loading: Promise<Record<string, unknown>> | null = null;

/// The whole set, fetched once. The promise is cached rather than the result, so two rows asking at
/// the same moment share one request instead of racing.
export function loadLucideIcons(): Promise<Record<string, unknown>> {
  loading ??= import("lucide-static/icon-nodes.json").then(
    (module) => (module.default ?? module) as Record<string, unknown>,
  );
  return loading;
}
