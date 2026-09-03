import { describe, expect, it } from "vitest";
import { EDIT_FENCE_TAG, splitReply } from "./editBlocks";

/// Reading an edit out of the model's reply.
///
/// The parser is deliberately forgiving in one direction and strict in the other: a block it cannot
/// understand stays ORDINARY TEXT, so the user still sees the markdown and can paste it by hand.
/// Nothing is ever lost to a parse failure - which is what makes this transport safe to use with a
/// model that does not follow the format perfectly.

const edit = (content: string, info = 'insert-before heading="Objectives"') =>
  ["```" + EDIT_FENCE_TAG + " " + info, content, "```"].join("\n");

describe("splitReply", () => {
  it("returns plain prose as a single piece of text", () => {
    expect(splitReply("Just an answer.")).toEqual([{ kind: "text", text: "Just an answer." }]);
  });

  it("finds an edit block", () => {
    const parts = splitReply(edit("## Summary\n\nAn overview."));
    expect(parts).toEqual([
      {
        kind: "edit",
        edit: {
          op: "insert-before",
          heading: "Objectives",
          content: "## Summary\n\nAn overview.",
        },
      },
    ]);
  });

  it("keeps the prose around an edit, in order", () => {
    const reply = ["Here is a summary.", "", edit("## Summary\n\nText."), "", "Let me know."].join(
      "\n",
    );
    const parts = splitReply(reply);

    expect(parts.map((part) => part.kind)).toEqual(["text", "edit", "text"]);
    expect(parts[0]).toMatchObject({ text: "Here is a summary." });
    expect(parts[2]).toMatchObject({ text: "Let me know." });
  });

  it("reads every operation", () => {
    for (const op of ["insert-before", "insert-after", "replace-section"]) {
      const parts = splitReply(edit("Text.", `${op} heading="Objectives"`));
      expect(parts[0]).toMatchObject({ kind: "edit", edit: { op } });
    }
  });

  it("reads the operations that need no heading", () => {
    for (const op of ["replace-selection", "append"]) {
      const parts = splitReply(edit("Text.", op));
      expect(parts[0]).toMatchObject({ kind: "edit", edit: { op, heading: null } });
    }
  });

  it("accepts a heading given in single quotes", () => {
    const parts = splitReply(edit("Text.", "insert-before heading='Objectives'"));
    expect(parts[0]).toMatchObject({ edit: { heading: "Objectives" } });
  });

  it("accepts a heading with no quotes when it is one word", () => {
    const parts = splitReply(edit("Text.", "insert-before heading=Objectives"));
    expect(parts[0]).toMatchObject({ edit: { heading: "Objectives" } });
  });

  // The whole point of a fenced transport. Four backticks let the content carry its own code blocks.
  it("lets a longer fence contain ordinary code blocks", () => {
    const reply = [
      "````" + EDIT_FENCE_TAG + " append",
      "## Example",
      "",
      "```bash",
      "npm test",
      "```",
      "````",
    ].join("\n");

    const parts = splitReply(reply);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ edit: { content: "## Example\n\n```bash\nnpm test\n```" } });
  });

  it("finds more than one edit in a reply", () => {
    const reply = [edit("One.", "append"), "", edit("Two.", "append")].join("\n");
    expect(splitReply(reply).filter((part) => part.kind === "edit")).toHaveLength(2);
  });

  it("leaves an ordinary code block alone", () => {
    const reply = "```js\nconst a = 1;\n```";
    expect(splitReply(reply)).toEqual([{ kind: "text", text: reply }]);
  });
});

/// Every one of these keeps the block as text rather than dropping it. A model that gets the format
/// slightly wrong should cost the user a copy and paste, never the answer.
describe("blocks that cannot be understood stay as text", () => {
  const staysText = (reply: string) => {
    const parts = splitReply(reply);
    expect(parts.every((part) => part.kind === "text")).toBe(true);
    expect(parts.map((part) => (part.kind === "text" ? part.text : "")).join("")).toContain(
      EDIT_FENCE_TAG,
    );
  };

  it("keeps a block with an operation it does not recognise", () => {
    staysText(edit("Text.", 'delete-everything heading="Objectives"'));
  });

  it("keeps a block with no operation at all", () => {
    staysText(edit("Text.", ""));
  });

  // Without a heading the edit cannot be placed, and guessing a target is exactly what this design
  // refuses to do.
  it("keeps a heading-anchored block that names no heading", () => {
    staysText(edit("Text.", "insert-before"));
  });

  it("keeps a block whose content is empty", () => {
    staysText(edit("   ", "append"));
  });

  it("keeps an unterminated block, which is what a cut-off reply looks like", () => {
    staysText("```" + EDIT_FENCE_TAG + " append\n## Summary\n\nHalf an ans");
  });
});

/// While a reply is streaming the block arrives a character at a time, so every prefix of it is
/// parsed at some point. None of those may produce a half-formed edit the user could apply.
describe("parsing a reply as it streams in", () => {
  it("shows no edit until the block is complete", () => {
    const complete = edit("## Summary\n\nAn overview.");
    const applied: number[] = [];

    for (let length = 1; length < complete.length; length += 1) {
      const parts = splitReply(complete.slice(0, length));
      if (parts.some((part) => part.kind === "edit")) applied.push(length);
    }

    expect(applied).toEqual([]);
    expect(splitReply(complete).some((part) => part.kind === "edit")).toBe(true);
  });
});
