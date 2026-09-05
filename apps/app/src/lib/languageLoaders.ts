import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
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

/// Wraps one of CodeMirror's legacy stream modes as a language.
///
/// A `StreamParser` is a tokeniser rather than a grammar, so it produces no syntax tree and colours
/// by token name alone. That is the accepted floor for the long tail: a tokeniser that colours
/// keywords, strings and comments correctly is most of the value, and the alternative for these
/// languages is nothing at all. Where a real Lezer grammar exists, this file uses it instead.
const legacy = (parser: StreamParser<unknown>) => new LanguageSupport(StreamLanguage.define(parser));

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

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
  // One row in Settings, three grammars. A stylesheet is a stylesheet to somebody choosing what to
  // see; which of them it is, is this function's problem rather than theirs.
  css: (name) => {
    const extension = extensionOf(name);
    if (extension === "less") return import("@codemirror/lang-less").then((m) => m.less());
    if (extension === "scss" || extension === "sass") {
      return import("@codemirror/lang-sass").then((m) => m.sass({ indented: extension === "sass" }));
    }
    return import("@codemirror/lang-css").then((m) => m.css());
  },
  javascript: (name) =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: TYPESCRIPT.test(name), jsx: JSX.test(name) }),
    ),

  toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => legacy(m.toml)),
  ini: () => import("@codemirror/legacy-modes/mode/properties").then((m) => legacy(m.properties)),

  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  shell: () => import("@codemirror/legacy-modes/mode/shell").then((m) => legacy(m.shell)),
  powershell: () =>
    import("@codemirror/legacy-modes/mode/powershell").then((m) => legacy(m.powerShell)),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  csharp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.csharp)),
  java: (name) =>
    extensionOf(name).startsWith("kt")
      ? import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.kotlin))
      : import("@codemirror/lang-java").then((m) => m.java()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  ruby: () => import("@codemirror/legacy-modes/mode/ruby").then((m) => legacy(m.ruby)),

  diff: () => import("@codemirror/legacy-modes/mode/diff").then((m) => legacy(m.diff)),
  dockerfile: () =>
    import("@codemirror/legacy-modes/mode/dockerfile").then((m) => legacy(m.dockerFile)),
  // No grammar exists for Make. The row is still worth having - see the catalogue's note.
  makefile: null,
  latex: () => import("@codemirror/legacy-modes/mode/stex").then((m) => legacy(m.stex)),
  r: () => import("@codemirror/legacy-modes/mode/r").then((m) => legacy(m.r)),
  lua: () => import("@codemirror/legacy-modes/mode/lua").then((m) => legacy(m.lua)),
  perl: () => import("@codemirror/legacy-modes/mode/perl").then((m) => legacy(m.perl)),
  swift: () => import("@codemirror/legacy-modes/mode/swift").then((m) => legacy(m.swift)),
  scala: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.scala)),
  dart: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.dart)),
};
