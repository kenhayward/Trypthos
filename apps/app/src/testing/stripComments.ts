/// Removes line and block comments from source text.
///
/// Every guard test that greps source has to do this first, or it fails on its own documentation -
/// a comment explaining the rule reads exactly like a violation of it. String contents are kept,
/// because that is usually what the rule is actually about.
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];

    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}
