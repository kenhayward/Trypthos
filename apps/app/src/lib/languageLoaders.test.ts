import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { FILE_TYPES, type FileType } from "@trypthos/domain";
import { repoPath } from "../testing/repoRoot";
import { stripComments } from "../testing/stripComments";
import { LANGUAGE_LOADERS } from "./languageLoaders";

const SRC = repoPath("apps", "app", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__screenshots__") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    // Tests are not in the bundle, and one of them has to write the offending pattern down in
    // order to prove the pattern can match anything at all.
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const toPosix = (value: string): string => value.split(sep).join("/");

/// A STATIC import of a language package: `import ... from "@codemirror/lang-x"`. A dynamic
/// `import("@codemirror/lang-x")` has no `from` and is not matched, which is the distinction the
/// whole rule turns on.
const STATIC_LANGUAGE_IMPORT = /from\s+["']@codemirror\/lang-[a-z]+["']/;

describe("the language grammars stay out of the initial bundle", () => {
  // The rule that keeps the File types setting honest, and it is invisible when broken: a static
  // `import { python } from "@codemirror/lang-python"` type-checks, renders perfectly and passes
  // every other test in the suite while putting a grammar table on every cold start.
  it("is reached only through a dynamic import", () => {
    const offenders = sourceFiles(SRC)
      // Comments stripped first: this module documents the very rule it enforces, and the
      // explanation reads exactly like a violation of it.
      .filter((file) => STATIC_LANGUAGE_IMPORT.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => toPosix(relative(SRC, file)));

    expect(offenders).toEqual([]);
  });

  // Proves the pattern above can actually match something, rather than being a regex that quietly
  // never fires - a guard nobody has seen fail is a guard nobody should trust.
  it("would catch a static import if one appeared", () => {
    expect(STATIC_LANGUAGE_IMPORT.test('import { json } from "@codemirror/lang-json";')).toBe(true);
    expect(STATIC_LANGUAGE_IMPORT.test('import("@codemirror/lang-json")')).toBe(false);
  });
});

/// How many places the parser could not make sense of. Zero means the dialect was configured the way
/// the file's name implied.
async function parseErrors(name: string, code: string): Promise<number> {
  const support = await LANGUAGE_LOADERS.javascript!(name);
  let errors = 0;
  support.language.parser.parse(code).iterate({
    enter: (node) => {
      if (node.type.isError) errors += 1;
    },
  });
  return errors;
}

describe("LANGUAGE_LOADERS", () => {
  // Keyed by FileTypeId, so this cannot drift silently - but the catalogue is the domain's and the
  // loaders are the renderer's, and only a test says the two sets are the same one.
  it("answers for every type in the catalogue", () => {
    const missing = FILE_TYPES.map((type) => type.id).filter(
      (id) => !Object.prototype.hasOwnProperty.call(LANGUAGE_LOADERS, id),
    );
    expect(missing).toEqual([]);
  });

  it("names no type the catalogue does not have", () => {
    const known = new Set<string>(FILE_TYPES.map((type) => type.id));
    expect(Object.keys(LANGUAGE_LOADERS).filter((id) => !known.has(id))).toEqual([]);
  });

  // Plain text is not an oversight. CodeMirror's default is already no highlighting, so a loader
  // would be a chunk fetched to do nothing.
  it("has nothing to load for plain text", () => {
    expect(LANGUAGE_LOADERS.text).toBeNull();
  });

  it("loads a language when asked", async () => {
    const support = await LANGUAGE_LOADERS.json!("data.json");
    expect(support.language.name).toBe("json");
  });

  // One row in Settings, four dialects underneath. The name is what picks between them, which is
  // why a loader takes one at all.
  it("reads the dialect off the file name", async () => {
    const ts = await LANGUAGE_LOADERS.javascript!("main.ts");
    const js = await LANGUAGE_LOADERS.javascript!("main.js");
    expect(ts.language.name).toBe("typescript");
    expect(js.language.name).toBe("javascript");
  });

  // Asserted by PARSING rather than by the language's name, because a JSX dialect still calls itself
  // "javascript" or "typescript" - so a name check would pass with JSX switched off, which is the
  // whole thing this is here to catch.
  it("turns on JSX for the x extensions, and not otherwise", async () => {
    const markup = 'const a = <div className="x">hi</div>;';

    expect(await parseErrors("App.tsx", markup)).toBe(0);
    expect(await parseErrors("App.jsx", markup)).toBe(0);
    expect(await parseErrors("main.ts", markup)).toBeGreaterThan(0);
  });
});

/// Every loader, actually loaded.
///
/// This is the test that earns its place. A wrong export name - `m.powershell` where the package
/// says `m.powerShell` - throws inside the loader, and `DocumentEditor` deliberately swallows a
/// failed load so a bad chunk cannot take the centre panel down. The file simply opens uncoloured,
/// which looks exactly like a type that has no grammar. Nothing else in the suite would notice.
describe("every language in the catalogue", () => {
  /// A name a file of this type could plausibly have, from the catalogue itself.
  const exampleName = (type: FileType): string =>
    type.extensions[0] !== undefined ? `example.${type.extensions[0]}` : type.filenames[0]!;

  const loadable = FILE_TYPES.filter((type) => LANGUAGE_LOADERS[type.id] !== null);

  // Awaiting IS the assertion. A wrong export name makes the module's binding `undefined`, and both
  // `StreamLanguage.define(undefined)` and a call on `undefined` throw - so the promise rejects and
  // this fails, where in the app it would be swallowed. Verified against the real failure mode:
  // `StreamLanguage.define(undefined)` throws "Cannot read properties of undefined".
  //
  // `language.name` is deliberately NOT asserted: a legacy stream mode carries no name of its own,
  // so `dockerFile` legitimately resolves to one that is empty.
  it.each(loadable.map((type) => [type.id, type] as const))("loads %s", async (_id, type) => {
    const support = await LANGUAGE_LOADERS[type.id]!(exampleName(type));

    expect(support.language).toBeDefined();
    expect(support.language.parser.parse("a\n")).toBeDefined();
  });

  // Only Makefile and Plain text. Both are deliberate, and both are listed here so that adding a
  // third by accident - a loader forgotten when a type was added - fails rather than passing.
  it("has exactly two types with nothing to load", () => {
    const bare = FILE_TYPES.filter((type) => LANGUAGE_LOADERS[type.id] === null).map((t) => t.id);
    expect(bare).toEqual(["text", "makefile"]);
  });
});

describe("the rows that carry more than one grammar", () => {
  // A stylesheet is a stylesheet to somebody choosing what to see, but SCSS, Sass and LESS are not
  // the same language - so the row is one and the grammars are three.
  it("picks the stylesheet grammar from the extension", async () => {
    expect((await LANGUAGE_LOADERS.css!("main.css")).language.name).toBe("css");
    expect((await LANGUAGE_LOADERS.css!("main.scss")).language.name).toBe("sass");
    expect((await LANGUAGE_LOADERS.css!("main.less")).language.name).toBe("less");
  });

  it("reads Kotlin off the extension, and Java otherwise", async () => {
    expect((await LANGUAGE_LOADERS.java!("Main.java")).language.name).toBe("java");
    // A stream mode has no grammar name of its own, so what is asserted is that it is a DIFFERENT
    // language from the Java one - which is the thing that would be wrong if the branch were.
    const kotlin = await LANGUAGE_LOADERS.java!("Main.kt");
    const java = await LANGUAGE_LOADERS.java!("Main.java");
    expect(kotlin.language).not.toBe(java.language);
    expect((await LANGUAGE_LOADERS.java!("build.gradle.kts")).language).not.toBe(java.language);
  });
});
