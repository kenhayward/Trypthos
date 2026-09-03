import { describe, expect, it } from "vitest";
import { CONTEXT_CHARACTER_LIMIT, contextTurn, resolveChatContext } from "./chatContext";

/// What the model is told about the document, and how that is decided.
///
/// Pure, because the rule is small and the consequences are not: the difference between sending a
/// selection and sending a whole file is the difference between a useful answer and a confusing one,
/// and neither is visible in a screenshot of the panel.

const file = { path: "notes/plan.md", content: "# Plan\n\nThe whole document." };

describe("resolveChatContext", () => {
  it("sends the selection when there is one", () => {
    const context = resolveChatContext({ selection: "A selected passage", file });
    expect(context).toMatchObject({ kind: "selection", text: "A selected passage" });
  });

  it("sends the whole file when nothing is selected", () => {
    const context = resolveChatContext({ selection: "", file });
    expect(context).toMatchObject({ kind: "file", text: file.content, path: "notes/plan.md" });
  });

  it("sends nothing when no file is open", () => {
    expect(resolveChatContext({ selection: "", file: null })).toEqual({ kind: "none" });
  });

  // The scratch buffer has no file, but a person who selects text in it plainly means to ask about
  // that text. The selection rule comes first for that reason.
  it("sends a selection made with no file open", () => {
    const context = resolveChatContext({ selection: "Scratch text", file: null });
    expect(context).toMatchObject({ kind: "selection", text: "Scratch text", path: null });
  });

  // A click sets an empty selection, and dragging across a blank line selects whitespace. Neither is
  // a request to talk about nothing, and both would otherwise suppress the file.
  it("treats a blank selection as no selection", () => {
    const context = resolveChatContext({ selection: "   \n  ", file });
    expect(context.kind).toBe("file");
  });

  it("sends nothing for an empty file rather than an empty document", () => {
    expect(resolveChatContext({ selection: "", file: { path: "empty.md", content: "  " } })).toEqual(
      { kind: "none" },
    );
  });

  it("keeps the selection exactly as it was selected, without trimming it", () => {
    const context = resolveChatContext({ selection: "  indented line\n", file });
    // Leading whitespace can be the point - it is what makes a line part of a code block or a
    // nested list item.
    expect(context).toMatchObject({ text: "  indented line\n" });
  });
});

describe("the size cap", () => {
  const huge = "x".repeat(CONTEXT_CHARACTER_LIMIT + 5_000);

  it("truncates a document too large to send", () => {
    const context = resolveChatContext({ selection: "", file: { path: "big.md", content: huge } });
    expect(context.kind).toBe("file");
    if (context.kind === "none") throw new Error("expected context");
    expect(context.text.length).toBe(CONTEXT_CHARACTER_LIMIT);
    expect(context.truncated).toBe(true);
  });

  it("truncates an oversized selection too", () => {
    const context = resolveChatContext({ selection: huge, file: null });
    if (context.kind === "none") throw new Error("expected context");
    expect(context.truncated).toBe(true);
  });

  it("leaves a document within the cap untouched", () => {
    const context = resolveChatContext({ selection: "", file });
    if (context.kind === "none") throw new Error("expected context");
    expect(context.truncated).toBe(false);
    expect(context.text).toBe(file.content);
  });

  it("takes the beginning, which is where a document says what it is", () => {
    const content = `START${"x".repeat(CONTEXT_CHARACTER_LIMIT)}END`;
    const context = resolveChatContext({ selection: "", file: { path: "big.md", content } });
    if (context.kind === "none") throw new Error("expected context");
    expect(context.text.startsWith("START")).toBe(true);
  });
});

describe("contextTurn", () => {
  it("has nothing to send when there is no context", () => {
    expect(contextTurn({ kind: "none" })).toBeNull();
  });

  it("names the file, so the model can refer to it", () => {
    const turn = contextTurn(resolveChatContext({ selection: "", file }));
    expect(turn?.content).toContain("notes/plan.md");
  });

  it("says when the text is a selection rather than the whole document", () => {
    const turn = contextTurn(resolveChatContext({ selection: "A passage", file }));
    expect(turn?.content).toMatch(/selected/i);
  });

  it("carries the text itself", () => {
    const turn = contextTurn(resolveChatContext({ selection: "", file }));
    expect(turn?.content).toContain("The whole document.");
  });

  it("says so when the document was cut short, rather than implying it ended there", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "big.md", content: "x".repeat(CONTEXT_CHARACTER_LIMIT + 1) },
    });
    expect(contextTurn(context)?.content).toMatch(/truncated|shortened|cut/i);
  });

  // The rule that matters most here. A document can contain text addressed at an assistant - a note
  // about prompts, a copied email, a deliberate injection - and the model has to be told which part
  // of the message is data. It is framed as the user's own message rather than a system one for the
  // same reason: a system message is where instructions live.
  it("frames the document as reference material, never as instructions", () => {
    const turn = contextTurn(resolveChatContext({ selection: "", file }));
    expect(turn?.role).toBe("user");
    expect(turn?.content).toMatch(/not instructions|never as instructions|do not follow/i);
  });

  // A document containing the delimiter would otherwise appear to close the block early, and
  // everything after it would read as though it were the conversation again.
  it("uses a fence the document cannot close by accident", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "fence.md", content: "```\nnot the end\n```\nstill the document" },
    });
    const content = contextTurn(context)?.content ?? "";

    const fence = content.match(/^(-{3,}[A-Z ]*-{3,}|`{4,}[a-z]*)$/m)?.[0] ?? "";
    expect(fence).not.toBe("");
    expect(context.kind === "none" ? "" : context.text).not.toContain(fence);
  });
});
