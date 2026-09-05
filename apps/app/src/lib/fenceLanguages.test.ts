import { LanguageDescription } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { FILE_TYPES } from "@trypthos/domain";
import { fenceLanguages } from "./fenceLanguages";

/// What `markdown({ codeLanguages })` does with a fence tag, asked the way it asks it.
const match = (tag: string, enabled: readonly string[]) =>
  LanguageDescription.matchLanguageName(fenceLanguages(enabled), tag, true);

const ALL = FILE_TYPES.map((type) => type.id);

describe("fenceLanguages", () => {
  // One description PER TAG rather than per type. `LanguageDescription.load()` takes no argument,
  // so a single description per type could not tell which of its tags matched - and ```ts would
  // load whatever ```js does.
  it("offers a description for each tag an enabled type answers to", () => {
    const names = fenceLanguages(["markdown", "python"]).map((d) => d.name);
    expect(names).toContain("python");
    expect(names).toContain("py");
    expect(names).toContain("markdown");
    expect(names).not.toContain("rust");
  });

  // Plain text and Makefile have no grammar, so a description for either would be a fence that
  // resolves to nothing after a round trip through the loader.
  it("leaves out a type with nothing to load", () => {
    const names = fenceLanguages(ALL).map((d) => d.name);
    expect(names).not.toContain("text");
    expect(names).not.toContain("makefile");
  });

  // Two descriptions answering to one tag means the fence resolves to whichever comes first in the
  // catalogue, which is a coin toss dressed up as a rule.
  it("has no tag answered by two descriptions", () => {
    const tags = fenceLanguages(ALL).flatMap((d) => [...d.alias]);
    const seen = new Set<string>();
    const twice = tags.filter((tag) => (seen.has(tag) ? true : (seen.add(tag), false)));
    expect(twice).toEqual([]);
  });

  // The whole point of feeding this from the catalogue: a fence is coloured only if the user has
  // turned that type on, so Settings governs the document's insides as well as the folder tree.
  it("offers nothing for a type that is turned off", () => {
    expect(match("python", ["markdown"])).toBeNull();
    expect(match("python", ["markdown", "python"])).not.toBeNull();
  });

  it("matches the tag people actually write", () => {
    for (const tag of ["python", "py", "js", "ts", "rs", "sh", "yml", "json"]) {
      expect(match(tag, ALL), tag).not.toBeNull();
    }
  });

  // Names nobody would guess from an extension, so they are catalogue data rather than derived.
  it("matches the written-out names too", () => {
    for (const tag of ["typescript", "c++", "c#", "kotlin", "bash"]) {
      expect(match(tag, ALL), tag).not.toBeNull();
    }
  });

  it("is not case-sensitive", () => {
    expect(match("Python", ALL)).not.toBeNull();
    expect(match("JSON", ALL)).not.toBeNull();
  });

  it("finds nothing for a tag no type claims", () => {
    expect(match("klingon", ALL)).toBeNull();
  });

  // A fence tag is not a filename, but the loaders take one - because a row can carry several
  // grammars. ```ts has to reach TypeScript and ```js JavaScript, from the same one row.
  it("loads the dialect the tag asked for, not the row's first", async () => {
    const ts = await match("ts", ALL)!.load();
    const js = await match("js", ALL)!.load();
    expect(ts.language.name).toBe("typescript");
    expect(js.language.name).toBe("javascript");
  });

  it("loads a stylesheet dialect from its tag", async () => {
    expect((await match("scss", ALL)!.load()).language.name).toBe("sass");
    expect((await match("css", ALL)!.load()).language.name).toBe("css");
  });

  // A written-out alias is not an extension, so there is no filename to build from it. It has to
  // fall back to something the loader understands rather than asking for `example.typescript`.
  it("loads a language named by a written-out alias", async () => {
    expect((await match("typescript", ALL)!.load()).language.name).toBe("typescript");
    expect((await match("kotlin", ALL)!.load()).language).toBeDefined();
  });

  it("loads every description it offers", async () => {
    for (const description of fenceLanguages(ALL)) {
      await expect(description.load(), description.name).resolves.toBeDefined();
    }
  });
});
