import { describe, expect, it } from "vitest";
import {
  CHARACTERS_PER_TOKEN,
  contextCharacterBudget,
  contextTokens,
  contextUsage,
  estimateTokens,
} from "./contextUsage";
import {
  CONTEXT_CHARACTER_LIMIT,
  EMPTY_CONTEXT,
  MAX_CONTEXT_CHARACTER_LIMIT,
  type ChatContext,
} from "./chatContext";
import type { ChatTurn } from "./chatCompletion";

const document = (text: string): ChatContext => ({
  ...EMPTY_CONTEXT,
  document: { kind: "file", path: "notes.md", text, truncated: false, fileType: "markdown" },
});

/// How much document and attachment text a question may carry, for the model it is going to.
///
/// It used to be one fixed number for every model - sixty thousand characters - so a model with a
/// window of a quarter of a million tokens was sent about fifteen thousand of them, and the files
/// past that were cut short or sent empty (#145).
describe("contextCharacterBudget", () => {
  // A model nobody has sized keeps the budget it always had: inventing a window would be guessing.
  it("keeps the fixed budget for a model with no context window set", () => {
    expect(contextCharacterBudget(null)).toBe(CONTEXT_CHARACTER_LIMIT);
  });

  // The system prompt, the tool definitions and the conversation are small next to the documents,
  // so the documents get nine tenths of the window, at the same rate the context dial estimates by.
  it("gives the documents nine tenths of a model's window", () => {
    expect(contextCharacterBudget(262_000)).toBe(Math.floor(262_000 * 0.9 * CHARACTERS_PER_TOKEN));
  });

  it("lets a small model have less than the old fixed budget", () => {
    expect(contextCharacterBudget(8_000)).toBe(28_800);
  });

  // The window is a number a user types. A typo of a few extra zeros must not become a request the
  // shell is obliged to accept, so there is a ceiling however large the window claims to be.
  it("never exceeds the ceiling", () => {
    expect(contextCharacterBudget(50_000_000)).toBe(MAX_CONTEXT_CHARACTER_LIMIT);
  });
});

describe("estimateTokens", () => {
  it("counts nothing for nothing", () => {
    expect(estimateTokens("")).toBe(0);
  });

  // Four characters to a token, the same rule of thumb the character limit is set from. It is an
  // estimate and every surface that shows it says so - only the provider's own tokeniser can count.
  it("counts roughly four characters to a token", () => {
    expect(estimateTokens("a".repeat(4 * CHARACTERS_PER_TOKEN))).toBe(4);
  });

  // Rounded up, so a short line is one token rather than none. Nothing that is sent costs zero.
  it("never counts a non-empty string as free", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("contextTokens", () => {
  it("counts the system prompt", () => {
    const tokens = contextTokens({
      systemPrompt: "a".repeat(400),
      context: EMPTY_CONTEXT,
      turns: [],
    });

    expect(tokens).toBe(100);
  });

  // The same `contextTurns` the sender uses, rather than a second guess at what will be sent: a
  // dial counting different text from the request is worse than no dial.
  it("counts the document, and the framing sent with it", () => {
    const bare = contextTokens({ systemPrompt: "", context: EMPTY_CONTEXT, turns: [] });
    const withDocument = contextTokens({
      systemPrompt: "",
      context: document("a".repeat(4000)),
      turns: [],
    });

    expect(withDocument).toBeGreaterThan(bare + 1000);
  });

  it("counts the conversation so far", () => {
    const conversation: ChatTurn[] = [
      { role: "user", content: "a".repeat(400) },
      { role: "assistant", content: "b".repeat(400) },
    ];
    const tokens = contextTokens({
      systemPrompt: "",
      context: EMPTY_CONTEXT,
      turns: conversation,
    });

    expect(tokens).toBe(200);
  });
});

describe("contextUsage", () => {
  it("adds what is typed but not yet sent", () => {
    const usage = contextUsage({ tokens: 100, draft: "a".repeat(400), limit: 1000 });
    expect(usage.tokens).toBe(200);
  });

  it("reports the fraction of the window in use", () => {
    const usage = contextUsage({ tokens: 250, draft: "", limit: 1000 });
    expect(usage.fraction).toBe(0.25);
    expect(usage.over).toBe(false);
  });

  // A window nobody has configured is not a window of zero, and not one of some invented size: the
  // count is still worth showing, and the proportion is simply not known.
  it("has no fraction when no window is configured", () => {
    const usage = contextUsage({ tokens: 250, draft: "", limit: null });
    expect(usage.tokens).toBe(250);
    expect(usage.fraction).toBeNull();
    expect(usage.over).toBe(false);
  });

  // Past the end, the bar stays full and says so separately. A fraction above one would draw a ring
  // that has wrapped around, which reads as nearly empty.
  it("clamps a full ring, and reports that it overflowed", () => {
    const usage = contextUsage({ tokens: 1500, draft: "", limit: 1000 });
    expect(usage.fraction).toBe(1);
    expect(usage.over).toBe(true);
  });

  // A limit that cannot mean anything is treated as no limit rather than as a division by zero.
  it("ignores a nonsense window", () => {
    expect(contextUsage({ tokens: 10, draft: "", limit: 0 }).fraction).toBeNull();
    expect(contextUsage({ tokens: 10, draft: "", limit: -100 }).fraction).toBeNull();
  });
});
