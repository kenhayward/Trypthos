import type { LanguageSupport } from "@codemirror/language";
import type { FileTypeId } from "@trypthos/domain";

/// Turning a file type into a CodeMirror language, on demand.
///
/// **Every import here is dynamic, and that is the whole design.** Vite code-splits an `import()`
/// into its own chunk, so a grammar reaches a user only when they open a file that needs it - which
/// is why the File types setting is about scope rather than startup cost, and why the catalogue in
/// the domain can carry a type whose language nobody has ever loaded.
///
/// A static `import { json } from "@codemirror/lang-json"` at the top of this file, or anywhere
/// else, would type-check, render correctly and pass every other test while putting the grammar on
/// every cold start. `languageLoaders.test.ts` asserts the module graph instead.
///
/// Nothing here belongs in the domain: the catalogue is data about files, and this is the renderer's
/// own business.

/// Given the file's NAME, because a type can have dialects: TypeScript and JSX are the same grammar
/// and the same package as JavaScript, configured differently. That is dialect selection within one
/// type, not a second type - see the catalogue's note on why they are one row.
export type LanguageLoader = (name: string) => Promise<LanguageSupport>;

const TYPESCRIPT = /\.[cm]?tsx?$/i;
const JSX = /x$/i;

/// `null` is a real answer, not a gap: plain text needs no highlighting, and CodeMirror's default is
/// already exactly that. Keyed by every id in the catalogue, so a type added there without a loader
/// is a type-error rather than a file that silently opens uncoloured.
export const LANGUAGE_LOADERS: Record<FileTypeId, LanguageLoader | null> = {
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  text: null,
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  javascript: (name) =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: TYPESCRIPT.test(name), jsx: JSX.test(name) }),
    ),
};
