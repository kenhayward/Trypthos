import { describe, expect, it } from "vitest";
import { EDIT_FENCE_TAG, splitReply } from "./editBlocks";
import {
  DEFAULT_SYSTEM_PROMPT,
  PREVIOUS_SYSTEM_PROMPTS,
  effectiveSystemPrompt,
} from "./systemPrompt";

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

describe("effectiveSystemPrompt", () => {
  it("uses the built-in default when nothing is set", () => {
    expect(effectiveSystemPrompt(null)).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("uses the user's own prompt when they have written one", () => {
    expect(effectiveSystemPrompt("Answer only in haiku.")).toBe("Answer only in haiku.");
  });

  // Cleared on purpose is not the same as unset, and must not be quietly refilled.
  it("sends nothing when the prompt has been cleared", () => {
    expect(effectiveSystemPrompt("")).toBe("");
  });
});

describe("PREVIOUS_SYSTEM_PROMPTS", () => {
  // If a previous entry equalled the current default, the migration would be a no-op and the bug
  // it exists to fix would still be live.
  it("holds only prompts that are no longer the default", () => {
    expect(PREVIOUS_SYSTEM_PROMPTS).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it("holds the prompt that shipped without the edit format", () => {
    expect(PREVIOUS_SYSTEM_PROMPTS.length).toBeGreaterThan(0);
    for (const previous of PREVIOUS_SYSTEM_PROMPTS) {
      expect(previous).not.toContain("trypthos-edit");
    }
  });
});
