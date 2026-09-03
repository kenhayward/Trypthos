import { describe, expect, it } from "vitest";
import { findHeadings, resolveEdit, type ProposedEdit } from "./documentEdit";

/// Turning an edit the model proposed into a range in the document.
///
/// All of it pure, because this is where the damage would be done. An anchor resolved to the wrong
/// place writes into somebody's file at a plausible-looking offset, and neither the panel nor a
/// screenshot would show anything wrong.

const DOC = [
  "# Plan",
  "",
  "Some preamble.",
  "",
  "## Objectives",
  "",
  "Do the thing.",
  "",
  "## Risks",
  "",
  "It might not work.",
  "",
].join("\n");

describe("findHeadings", () => {
  it("finds every heading with its level", () => {
    expect(findHeadings(DOC).map((h) => [h.level, h.text])).toEqual([
      [1, "Plan"],
      [2, "Objectives"],
      [2, "Risks"],
    ]);
  });

  it("reports where the heading line starts and ends", () => {
    const objectives = findHeadings(DOC)[1]!;
    expect(DOC.slice(objectives.from, objectives.to)).toBe("## Objectives");
  });

  // A markdown editor's documents are full of code samples, and a shell comment is not a heading.
  // Getting this wrong inserts a section into the middle of somebody's code block.
  it("ignores hashes inside a fenced code block", () => {
    const doc = ["# Real", "", "```bash", "# not a heading", "```", "", "## Also real", ""].join(
      "\n",
    );
    expect(findHeadings(doc).map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("handles a fence opened with more backticks than it closes with", () => {
    const doc = ["````md", "```", "# inside", "```", "````", "", "# outside"].join("\n");
    expect(findHeadings(doc).map((h) => h.text)).toEqual(["outside"]);
  });

  it("ignores a hash that is not followed by a space", () => {
    expect(findHeadings("#hashtag\n\n# Real\n").map((h) => h.text)).toEqual(["Real"]);
  });

  it("strips the closing hashes of a closed ATX heading", () => {
    expect(findHeadings("## Objectives ##\n").map((h) => h.text)).toEqual(["Objectives"]);
  });
});

const at = (doc: string, edit: ProposedEdit, selection: { from: number; to: number } | null = null) =>
  resolveEdit(edit, { doc, selection });

/// Applies a resolved edit, so a test can assert on the document rather than on offsets.
function applied(
  doc: string,
  edit: ProposedEdit,
  selection: { from: number; to: number } | null = null,
): string {
  const target = at(doc, edit, selection);
  if (!target.ok) throw new Error(`expected a resolved edit, got ${target.reason}`);
  return doc.slice(0, target.from) + target.insert + doc.slice(target.to);
}

describe("insert-before", () => {
  const edit: ProposedEdit = {
    op: "insert-before",
    heading: "Objectives",
    content: "## Summary\n\nA short overview.",
  };

  it("puts the content above the named heading", () => {
    expect(applied(DOC, edit)).toContain("## Summary\n\nA short overview.\n\n## Objectives");
  });

  it("leaves what came before the heading intact", () => {
    expect(applied(DOC, edit)).toContain("Some preamble.");
  });

  // The model is asked for a heading name, and will sometimes send the markdown for it instead.
  // Refusing on that would be pedantry at the user's expense.
  it("accepts an anchor written with its hashes", () => {
    expect(applied(DOC, { ...edit, heading: "## Objectives" })).toContain("## Summary");
  });

  it("matches a heading regardless of case and surrounding space", () => {
    expect(applied(DOC, { ...edit, heading: "  objectives " })).toContain("## Summary");
  });

  it("says so when the heading is not there", () => {
    const target = at(DOC, { ...edit, heading: "Budget" });
    expect(target).toMatchObject({ ok: false, reason: "heading-not-found" });
  });

  // Guessing would insert at a plausible-looking place in the wrong section, which is the worst
  // outcome available: it looks like it worked.
  it("refuses rather than guessing when two headings share a name", () => {
    const doc = "## Objectives\n\nOne.\n\n## Objectives\n\nTwo.\n";
    expect(at(doc, edit)).toMatchObject({ ok: false, reason: "heading-ambiguous" });
  });

  it("keeps a blank line between the insert and the heading", () => {
    expect(applied(DOC, { ...edit, content: "## Summary\n\nText." })).not.toMatch(
      /Text\.\n## Objectives/,
    );
  });

  it("does not strand a blank line when inserting at the very top", () => {
    const doc = "# Plan\n\nBody.\n";
    expect(applied(doc, { ...edit, heading: "Plan", content: "Preface." })).toBe(
      "Preface.\n\n# Plan\n\nBody.\n",
    );
  });
});

describe("insert-after", () => {
  const edit: ProposedEdit = {
    op: "insert-after",
    heading: "Objectives",
    content: "An introductory line.",
  };

  it("puts the content directly under the heading, above its body", () => {
    expect(applied(DOC, edit)).toContain(
      "## Objectives\n\nAn introductory line.\n\nDo the thing.",
    );
  });

  it("works for the last heading in the document", () => {
    expect(applied(DOC, { ...edit, heading: "Risks" })).toContain(
      "## Risks\n\nAn introductory line.",
    );
  });
});

describe("replace-section", () => {
  const edit: ProposedEdit = {
    op: "replace-section",
    heading: "Objectives",
    content: "## Objectives\n\nRewritten.",
  };

  it("replaces the heading and its body", () => {
    const result = applied(DOC, edit);
    expect(result).toContain("## Objectives\n\nRewritten.");
    expect(result).not.toContain("Do the thing.");
  });

  // The section ends where the next one begins, and nowhere else. Running past it would delete a
  // section the user never mentioned.
  it("stops at the next heading of the same level", () => {
    const result = applied(DOC, edit);
    expect(result).toContain("## Risks");
    expect(result).toContain("It might not work.");
  });

  it("takes a subsection with it, because a subsection belongs to its parent", () => {
    const doc = "## A\n\nOne.\n\n### A.1\n\nDetail.\n\n## B\n\nTwo.\n";
    const result = applied(doc, { ...edit, heading: "A", content: "## A\n\nNew." });
    expect(result).not.toContain("A.1");
    expect(result).toContain("## B");
  });

  it("runs to the end of the document for the last section", () => {
    const result = applied(DOC, { ...edit, heading: "Risks", content: "## Risks\n\nNone." });
    expect(result).toContain("## Risks\n\nNone.");
    expect(result).not.toContain("It might not work.");
  });
});

describe("replace-selection", () => {
  const edit: ProposedEdit = { op: "replace-selection", heading: null, content: "Rewritten." };

  it("replaces exactly what was selected", () => {
    const from = DOC.indexOf("Do the thing.");
    expect(applied(DOC, edit, { from, to: from + "Do the thing.".length })).toContain(
      "## Objectives\n\nRewritten.",
    );
  });

  // The selection can be gone by the time Apply is pressed - the user clicked into the document to
  // read it. Writing at the caret instead would drop text at an arbitrary point.
  it("refuses when nothing is selected any more", () => {
    expect(at(DOC, edit, null)).toMatchObject({ ok: false, reason: "no-selection" });
  });

  it("refuses an empty selection", () => {
    expect(at(DOC, edit, { from: 5, to: 5 })).toMatchObject({ ok: false, reason: "no-selection" });
  });
});

describe("append", () => {
  const edit: ProposedEdit = { op: "append", heading: null, content: "## Notes\n\nAdded." };

  it("adds to the end of the document", () => {
    expect(applied(DOC, edit).endsWith("## Notes\n\nAdded.\n")).toBe(true);
  });

  it("keeps a blank line between the old ending and the new text", () => {
    expect(applied("One line.", edit)).toBe("One line.\n\n## Notes\n\nAdded.\n");
  });

  it("does not pile up blank lines on a document that already ends with them", () => {
    expect(applied("One line.\n\n\n", edit)).toBe("One line.\n\n## Notes\n\nAdded.\n");
  });

  it("appends to an empty document without a leading blank line", () => {
    expect(applied("", edit)).toBe("## Notes\n\nAdded.\n");
  });
});

describe("resolving against the live document", () => {
  // The whole reason resolution happens at apply time rather than when the model answered. Between
  // the question and the click, the user may have renamed the heading or deleted it.
  it("fails when the anchor has gone since the model saw it", () => {
    const edited = DOC.replace("## Objectives", "## Goals");
    const target = at(edited, {
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nText.",
    });

    expect(target).toMatchObject({ ok: false, reason: "heading-not-found" });
  });

  it("follows the heading when it has moved", () => {
    const moved = ["## Objectives", "", "Do the thing.", "", "# Plan", ""].join("\n");
    const target = at(moved, {
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary",
    });

    expect(target).toMatchObject({ ok: true, from: 0 });
  });
});
