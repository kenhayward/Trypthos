import { describe, expect, it } from "vitest";
import { EDIT_FENCE_TAG, formatEditBlock, splitReply } from "./editBlocks";
import type { ProposedEdit } from "./documentEdit";

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
/// Shapes taken from what a model actually sent, rather than from what the format says.
///
/// Every test above was written with well-formed blocks, which is a fixture bias: it proved the
/// parser accepts the format I documented, and said nothing about what models emit. These come from
/// the raw stream of a local model answering the request this feature exists for.
describe("output a real model produced", () => {
  // The one that broke it. A model routinely closes a block by appending the backticks to the last
  // line of content rather than giving them a line of their own.
  it("accepts a closing fence appended to the last line", () => {
    const reply = [
      '```' + EDIT_FENCE_TAG + ' insert-before heading="Objectives"',
      "## Summary",
      "",
      "The brief outlines a task, and notes a risk.```",
    ].join("\n");

    const parts = splitReply(reply);
    expect(parts).toEqual([
      {
        kind: "edit",
        edit: {
          op: "insert-before",
          heading: "Objectives",
          content: "## Summary\n\nThe brief outlines a task, and notes a risk.",
        },
      },
    ]);
  });

  it("keeps the trailing fence out of the content", () => {
    const reply = ["```" + EDIT_FENCE_TAG + " append", "Just one line.```"].join("\n");
    const parts = splitReply(reply);
    expect(parts[0]).toMatchObject({ edit: { content: "Just one line." } });
  });

  // A proper close is still preferred where both could match, so nothing above regresses.
  it("prefers a fence on its own line when there is one", () => {
    const reply = [
      "```" + EDIT_FENCE_TAG + " append",
      "Text with a stray ``` inside it.",
      "```",
      "",
      "Prose after the block.",
    ].join("\n");

    const parts = splitReply(reply);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ edit: { content: "Text with a stray ``` inside it." } });
    expect(parts[1]).toMatchObject({ kind: "text", text: "Prose after the block." });
  });

  // The lenient close must not swallow an inner code fence: an inner ``` is shorter than the outer
  // ````, so it can never end the outer block.
  it("does not let an inner code fence close a longer outer one", () => {
    const reply = [
      "````" + EDIT_FENCE_TAG + " append",
      "## Example",
      "",
      "```bash",
      "npm test```",
      "````",
    ].join("\n");

    const parts = splitReply(reply);
    expect(parts[0]).toMatchObject({
      edit: { content: "## Example\n\n```bash\nnpm test```" },
    });
  });
});

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

  // While a reply is still arriving, an unterminated block IS a cut-off reply, and must not become
  // an applicable card carrying half a sentence.
  it("keeps an unterminated block while the reply is still arriving", () => {
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

/// Once a turn has finished, an unterminated block is not a cut-off reply - it is a model that
/// forgot the closing fence, which they do often. Observed from a real local model: opening fence,
/// content, and then the turn simply ended.
describe("a block left unclosed by a finished reply", () => {
  const unclosed = [
    "```" + EDIT_FENCE_TAG + ' insert-before heading="Objectives"',
    "## Summary",
    "",
    "The brief outlines a task and notes a risk.",
  ].join("\n");

  it("is accepted once the reply is complete", () => {
    const parts = splitReply(unclosed, { complete: true });
    expect(parts).toEqual([
      {
        kind: "edit",
        edit: {
          op: "insert-before",
          heading: "Objectives",
          content: "## Summary\n\nThe brief outlines a task and notes a risk.",
        },
      },
    ]);
  });

  it("is still text while the reply is arriving", () => {
    const parts = splitReply(unclosed);
    expect(parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("keeps the prose that came before it", () => {
    const parts = splitReply(`Here is a summary.\n\n${unclosed}`, { complete: true });
    expect(parts.map((part) => part.kind)).toEqual(["text", "edit"]);
  });

  // Completeness relaxes how a block ENDS, never what it means. An operation nobody recognises is
  // still not an edit.
  it("does not accept a block it could not understand anyway", () => {
    const parts = splitReply("```" + EDIT_FENCE_TAG + " nonsense\n## Summary", { complete: true });
    expect(parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("does not accept an unclosed block with no content", () => {
    const parts = splitReply("```" + EDIT_FENCE_TAG + " append\n   ", { complete: true });
    expect(parts.every((part) => part.kind === "text")).toBe(true);
  });
});

/// Writing an edit back out as a block.
///
/// The join between the two transports. A tool call arrives as structured arguments and is turned
/// into exactly the block the fenced transport would have produced, so everything downstream - the
/// card, resolving the anchor, applying it - has one representation to deal with rather than two.
describe("formatEditBlock", () => {
  const roundTrip = (edit: ProposedEdit) => {
    const parts = splitReply(formatEditBlock(edit), { complete: true });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "edit" });
    const first = parts[0]!;
    return first.kind === "edit" ? first.edit : null;
  };

  it("round-trips an edit anchored to a heading", () => {
    const edit: ProposedEdit = {
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    };
    expect(roundTrip(edit)).toEqual(edit);
  });

  it("round-trips every operation", () => {
    for (const op of ["insert-before", "insert-after", "replace-section"] as const) {
      const edit: ProposedEdit = { op, heading: "Objectives", content: "Text." };
      expect(roundTrip(edit)).toEqual(edit);
    }
    for (const op of ["replace-selection", "append"] as const) {
      const edit: ProposedEdit = { op, heading: null, content: "Text." };
      expect(roundTrip(edit)).toEqual(edit);
    }
  });

  // A heading with a quote in it would close the attribute early and the block would parse as
  // heading-less, which is refused - so the whole proposal would be lost.
  it("round-trips a heading containing a quote", () => {
    const edit: ProposedEdit = {
      op: "insert-before",
      heading: `The "Objectives" section`,
      content: "Text.",
    };
    expect(roundTrip(edit)).toEqual(edit);
  });

  // The fence has to be longer than anything inside, or the content ends the block early and the
  // rest of it reads as conversation.
  it("round-trips content containing its own code fence", () => {
    const edit: ProposedEdit = {
      op: "append",
      heading: null,
      content: "## Example\n\n```bash\nnpm test\n```",
    };
    expect(roundTrip(edit)).toEqual(edit);
  });

  it("round-trips content containing a longer fence still", () => {
    const edit: ProposedEdit = {
      op: "append",
      heading: null,
      content: "````\nnested\n````",
    };
    expect(roundTrip(edit)).toEqual(edit);
  });
});
