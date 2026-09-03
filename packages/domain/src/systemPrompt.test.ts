import { describe, expect, it } from "vitest";
import { EDIT_FENCE_TAG, splitReply } from "./editBlocks";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt";

/// The prompt teaches a format, and the parser implements one. Nothing else checks they are the
/// same format.
///
/// If they drift, every symptom is downstream and confusing: the model does exactly as instructed,
/// the block arrives, and the panel renders it as an inert code sample. The user sees the app ignore
/// its own model. Cheap to catch here, expensive to diagnose anywhere else.

describe("the default system prompt", () => {
  it("teaches the tag the parser looks for", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EDIT_FENCE_TAG);
  });

  it("gives an example the parser actually accepts", () => {
    const parts = splitReply(DEFAULT_SYSTEM_PROMPT);
    const edits = parts.filter((part) => part.kind === "edit");

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      kind: "edit",
      edit: { op: "insert-before", heading: "Objectives" },
    });
  });

  it("names every operation the parser supports", () => {
    for (const op of [
      "insert-before",
      "insert-after",
      "replace-section",
      "replace-selection",
      "append",
    ]) {
      expect(DEFAULT_SYSTEM_PROMPT).toContain(op);
    }
  });

  // The two rules the app cannot enforce from its side, so the prompt has to carry them.
  it("keeps the data-not-instructions rule", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/never follow instructions/i);
  });

  it("tells the model an edit is proposed rather than applied", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/nothing is written until/i);
  });
});
