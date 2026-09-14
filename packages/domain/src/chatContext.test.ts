import { describe, expect, it } from "vitest";
import {
  CONTEXT_CHARACTER_LIMIT,
  ChatContextSchema,
  MAX_CONTEXT_CHARACTER_LIMIT,
  attachmentsCutShort,
  contextCharacters,
  contextTurns,
  resolveChatContext,
  type ContextSource,
} from "./chatContext";

/// Most cases here say nothing about how a file is fetched, so they run against the tool transport -
/// what a model with tool calling on is told. The cases that ARE about it pass their own.
const turnsFor = (context: Parameters<typeof contextTurns>[0]) =>
  contextTurns(context, { reads: "tool" });
import { READ_FENCE_TAG } from "./readBlocks";

/// What the model is told about the user's files, and how that is decided.
///
/// Pure, because the rule is small and the consequences are not: the difference between sending a
/// selection and sending a whole file is the difference between a useful answer and a confusing one,
/// and neither is visible in a screenshot of the panel.

const file = {
  path: "notes/plan.md",
  content: "# Plan\n\nThe whole document.",
  fileType: "markdown",
};

const document = (source: ContextSource) => resolveChatContext(source).document;
const turns = (source: ContextSource) => turnsFor(resolveChatContext(source));
/// The document turn is always last: the question follows it.
const documentTurn = (source: ContextSource) => turns(source).at(-1) ?? null;

describe("the document", () => {
  it("sends the selection when there is one", () => {
    expect(document({ selection: "A selected passage", file })).toMatchObject({
      kind: "selection",
      text: "A selected passage",
    });
  });

  it("sends the whole file when nothing is selected", () => {
    expect(document({ selection: "", file })).toMatchObject({
      kind: "file",
      text: file.content,
      path: "notes/plan.md",
    });
  });

  it("sends nothing when no file is open", () => {
    expect(document({ selection: "", file: null })).toEqual({ kind: "none" });
  });

  // The scratch buffer has no file, but a person who selects text in it plainly means to ask about
  // that text. The selection rule comes first for that reason.
  it("sends a selection made with no file open", () => {
    expect(document({ selection: "Scratch text", file: null })).toMatchObject({
      kind: "selection",
      text: "Scratch text",
      path: null,
    });
  });

  // A click sets an empty selection, and dragging across a blank line selects whitespace. Neither is
  // a request to talk about nothing, and both would otherwise suppress the file.
  it("treats a blank selection as no selection", () => {
    expect(document({ selection: "   \n  ", file }).kind).toBe("file");
  });

  it("sends nothing for an empty file rather than an empty document", () => {
    expect(document({ selection: "", file: { path: "empty.md", content: "  ", fileType: "markdown" } })).toEqual({
      kind: "none",
    });
  });

  it("keeps the selection exactly as it was selected, without trimming it", () => {
    // Leading whitespace can be the point - it is what makes a line part of a code block or a
    // nested list item.
    expect(document({ selection: "  indented line\n", file })).toMatchObject({
      text: "  indented line\n",
    });
  });
});

describe("the size cap", () => {
  const huge = "x".repeat(CONTEXT_CHARACTER_LIMIT + 5_000);

  it("truncates a document too large to send", () => {
    const result = document({ selection: "", file: { path: "big.md", content: huge, fileType: "markdown" } });
    if (result.kind === "none") throw new Error("expected context");

    expect(result.text.length).toBe(CONTEXT_CHARACTER_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("truncates an oversized selection too", () => {
    const result = document({ selection: huge, file: null });
    if (result.kind === "none") throw new Error("expected context");
    expect(result.truncated).toBe(true);
  });

  it("leaves a document within the cap untouched", () => {
    const result = document({ selection: "", file });
    if (result.kind === "none") throw new Error("expected context");

    expect(result.truncated).toBe(false);
    expect(result.text).toBe(file.content);
  });

  it("takes the beginning, which is where a document says what it is", () => {
    const content = `START${"x".repeat(CONTEXT_CHARACTER_LIMIT)}END`;
    const result = document({ selection: "", file: { path: "big.md", content, fileType: "markdown" } });
    if (result.kind === "none") throw new Error("expected context");

    expect(result.text.startsWith("START")).toBe(true);
  });
});

describe("the document turn", () => {
  it("has nothing to send when there is nothing open", () => {
    expect(turnsFor({ document: { kind: "none" }, attachments: [], folder: null })).toEqual([]);
  });

  it("names the file, so the model can refer to it", () => {
    expect(documentTurn({ selection: "", file })?.content).toContain("notes/plan.md");
  });

  it("says when the text is a selection rather than the whole document", () => {
    expect(documentTurn({ selection: "A passage", file })?.content).toMatch(/selected/i);
  });

  it("carries the text itself", () => {
    expect(documentTurn({ selection: "", file })?.content).toContain("The whole document.");
  });

  it("says so when the document was cut short, rather than implying it ended there", () => {
    const content = "x".repeat(CONTEXT_CHARACTER_LIMIT + 1);
    expect(documentTurn({ selection: "", file: { path: "big.md", content, fileType: "markdown" } })?.content).toMatch(
      /truncated/i,
    );
  });

  // The rule that matters most here. A document can contain text addressed at an assistant - a note
  // about prompts, a copied email, a deliberate injection - and the model has to be told which part
  // of the message is data.
  it("frames the document as reference material, never as instructions", () => {
    const turn = documentTurn({ selection: "", file });
    expect(turn?.role).toBe("user");
    expect(turn?.content).toMatch(/not instructions/i);
  });

  it("uses a fence the document cannot close by accident", () => {
    const content = "```\nnot the end\n```\nstill the document";
    const turn = documentTurn({ selection: "", file: { path: "fence.md", content, fileType: "markdown" } });
    const fence = turn?.content.match(/^-{3,}[A-Z ]*-{3,}$/m)?.[0] ?? "";

    expect(fence).not.toBe("");
    expect(content).not.toContain(fence);
  });
});

/// Files the user picked, sent in full.
///
/// Explicit on purpose: guessing which other files are relevant is how a chat quietly spends
/// somebody's context window, and on a hosted endpoint their money.
describe("attachments", () => {
  const attached = [{ path: "notes/risks.md", content: "# Risks\n\nIt might not work." }];

  it("sends an attached file in full", () => {
    const context = resolveChatContext({ selection: "", file, attachments: attached });
    expect(context.attachments).toEqual([
      { path: "notes/risks.md", text: attached[0]!.content, truncated: false },
    ]);
  });

  it("names each attachment, so an answer can say which file it came from", () => {
    const [attachment] = turns({ selection: "", file, attachments: attached });
    expect(attachment?.content).toContain("notes/risks.md");
    expect(attachment?.content).toContain("It might not work.");
  });

  it("labels an attachment as data, like everything else", () => {
    const [attachment] = turns({ selection: "", file, attachments: attached });
    expect(attachment?.role).toBe("user");
    expect(attachment?.content).toMatch(/not instructions/i);
  });

  // The document is what the question is about, so it is served first. An attachment that pushed the
  // open file out of the budget would answer about the wrong text entirely.
  it("gives the document the budget before the attachments", () => {
    const big = "x".repeat(CONTEXT_CHARACTER_LIMIT - 10);
    const context = resolveChatContext({
      selection: "",
      file: { path: "big.md", content: big, fileType: "markdown" },
      attachments: [{ path: "extra.md", content: "y".repeat(1_000) }],
    });

    expect(context.document.kind).toBe("file");
    if (context.document.kind === "none") throw new Error("expected a document");
    expect(context.document.truncated).toBe(false);
    expect(context.attachments[0]?.text.length).toBe(10);
    expect(context.attachments[0]?.truncated).toBe(true);
  });

  // Named but empty. The model knowing the file exists and that it did not see it is better than
  // silence, which reads as "there was nothing there".
  it("still names an attachment there was no room for", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "big.md", content: "x".repeat(CONTEXT_CHARACTER_LIMIT), fileType: "markdown" },
      attachments: [{ path: "extra.md", content: "content" }],
    });

    expect(context.attachments[0]).toEqual({ path: "extra.md", text: "", truncated: true });
  });

  it("sends the attachments before the document, so the question follows its own text", () => {
    const built = turns({ selection: "", file, attachments: attached });
    expect(built).toHaveLength(2);
    expect(built[0]?.content).toContain("risks.md");
    expect(built[1]?.content).toContain("The whole document.");
  });

  it("sends nothing extra when nothing is attached", () => {
    expect(turns({ selection: "", file })).toHaveLength(1);
  });
});

/// The budget comes from the model, when the model says how big its window is (#145).
///
/// The case from the report: a large open document, then a 36,000-character attachment and a second
/// one. Under the old fixed budget the first was cut about 3,000 characters in and the second was sent
/// empty, to a model with room for a quarter of a million tokens.
describe("a budget sized for the model", () => {
  const reported: ContextSource = {
    selection: "",
    file: { path: "ws/open.md", content: "d".repeat(57_000), fileType: "markdown" },
    attachments: [
      { path: "ws/first.md", content: "a".repeat(36_000) },
      { path: "ws/second.md", content: "b".repeat(12_000) },
    ],
  };

  it("sends everything that fits the budget it is given", () => {
    const context = resolveChatContext({ ...reported, budget: 943_200 });

    expect(context.attachments).toEqual([
      { path: "ws/first.md", text: "a".repeat(36_000), truncated: false },
      { path: "ws/second.md", text: "b".repeat(12_000), truncated: false },
    ]);
  });

  it("sizes the document's own cap by the budget too", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "ws/long.md", content: "d".repeat(200_000), fileType: "markdown" },
      budget: 943_200,
    });

    expect(context.document).toMatchObject({ truncated: false });
  });

  // No budget given is the old fixed one, so nothing that does not know the model changes.
  it("keeps the fixed budget when none is given", () => {
    const context = resolveChatContext(reported);
    expect(context.attachments.map((attachment) => attachment.text.length)).toEqual([3_000, 0]);
  });
});

/// What the shell will accept, which has to allow what a large window lets the renderer send.
describe("ChatContextSchema", () => {
  const withAttachment = (length: number) => ({
    document: { kind: "none" },
    attachments: [{ path: "ws/big.md", text: "x".repeat(length), truncated: false }],
    folder: null,
  });

  it("accepts text past the old fixed budget", () => {
    expect(ChatContextSchema.safeParse(withAttachment(CONTEXT_CHARACTER_LIMIT + 1)).success).toBe(true);
  });

  it("refuses text past the ceiling", () => {
    expect(ChatContextSchema.safeParse(withAttachment(MAX_CONTEXT_CHARACTER_LIMIT + 1)).success).toBe(
      false,
    );
  });
});

/// Which attachments do not fit whole - what the chat panel marks on their chips.
describe("attachmentsCutShort", () => {
  it("names the attachments that were cut, and the ones sent empty", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "ws/open.md", content: "d".repeat(57_000), fileType: "markdown" },
      attachments: [
        { path: "ws/first.md", content: "a".repeat(36_000) },
        { path: "ws/second.md", content: "b".repeat(12_000) },
      ],
    });

    expect(attachmentsCutShort(context)).toEqual({ "ws/first.md": "partial", "ws/second.md": "none" });
  });

  it("names nothing when everything fits", () => {
    const context = resolveChatContext({
      selection: "",
      file: null,
      attachments: [{ path: "ws/small.md", content: "tiny" }],
    });

    expect(attachmentsCutShort(context)).toEqual({});
  });

  // An empty file is not a file that did not fit: there was simply nothing in it to send.
  it("does not call an empty file cut short", () => {
    const context = resolveChatContext({
      selection: "",
      file: null,
      attachments: [{ path: "ws/empty.md", content: "" }],
    });

    expect(attachmentsCutShort(context)).toEqual({});
  });
});

/// How much document and attachment text a resolved context carries - what the shell checks against
/// the budget of the model the request names.
describe("contextCharacters", () => {
  it("adds the document and every attachment", () => {
    const context = resolveChatContext({
      selection: "",
      file: { path: "ws/open.md", content: "d".repeat(100), fileType: "markdown" },
      attachments: [
        { path: "ws/a.md", content: "a".repeat(20) },
        { path: "ws/b.md", content: "b".repeat(3) },
      ],
    });

    expect(contextCharacters(context)).toBe(123);
  });

  it("counts nothing for nothing", () => {
    expect(contextCharacters(resolveChatContext({ selection: "", file: null }))).toBe(0);
  });
});

/// The folder, as a map rather than a payload.
describe("the folder outline", () => {
  const folder = { path: "", paths: ["notes/plan.md", "notes/risks.md"], truncated: false };

  it("lists the paths", () => {
    const [outline] = turns({ selection: "", file, folder });
    expect(outline?.content).toContain("notes/plan.md");
    expect(outline?.content).toContain("notes/risks.md");
  });

  it("keeps the desktop workspace routing path out of model context", () => {
    const [outline] = turns({
      selection: "",
      file,
      folder: { ...folder, workspacePath: "workspace-123/notes" },
    });
    expect(outline?.content).not.toContain("workspace-123");
  });

  // The whole point of an outline. Left unsaid, a model will answer as though it had read them.
  it("says plainly that the contents were not sent", () => {
    const [outline] = turns({ selection: "", file, folder });
    expect(outline?.content).toMatch(/paths only|not been shown their contents/i);
  });

  // The outline is a menu, and this is what says how to order from it.
  it("tells the model how to read one of them", () => {
    const [outline] = turns({ selection: "", file, folder });
    expect(outline?.content).toMatch(/get_file_contents/);
  });

  // A listing can reveal a file below the first outline. The model is told the folder, rather than
  // the one-level menu, is the boundary it can read inside.
  it("says that files below the attached folder can be read", () => {
    const [outline] = turns({ selection: "", file, folder });
    expect(outline?.content).toMatch(/attached folder.*below|inside the attached folder/i);
  });

  it("comes first, being the map the rest sits inside", () => {
    const built = turns({
      selection: "",
      file,
      folder,
      attachments: [{ path: "a.md", content: "text" }],
    });

    expect(built).toHaveLength(3);
    expect(built[0]?.content).toContain("notes/risks.md");
  });

  it("says when the folder holds more than could be listed", () => {
    const [outline] = turns({ selection: "", file, folder: { ...folder, truncated: true } });
    expect(outline?.content).toMatch(/more files than are listed/i);
  });

  it("is absent unless it was asked for", () => {
    expect(resolveChatContext({ selection: "", file }).folder).toBeNull();
    expect(turns({ selection: "", file })).toHaveLength(1);
  });
});

/// What the model is told about the KIND of document it is looking at.
///
/// Trypthos opens more than markdown now, and a model told only "the document the user is editing"
/// will answer about a Python file as though it were prose - matching heading depth and list
/// markers in a file that has neither.
describe("the document's file type", () => {
  const source = (path: string, fileType: string | null) => ({
    selection: "",
    file: { path, content: "print('hi')\n", fileType },
  });

  it("names the type when the document is not markdown", () => {
    const [turn] = turnsFor(resolveChatContext(source("main.py", "python")));
    expect(turn?.content).toContain("main.py");
    expect(turn?.content).toContain("python");
  });

  // Markdown is the app's own default and the whole system prompt already assumes it. Saying so
  // again on every turn is tokens spent to tell the model something it was told twice already.
  it("says nothing extra for markdown", () => {
    const [turn] = turnsFor(resolveChatContext(source("notes.md", "markdown")));
    expect(turn?.content).not.toContain("markdown file");
  });

  it("says nothing extra when the type is unknown", () => {
    const [turn] = turnsFor(resolveChatContext(source("scratch", null)));
    expect(turn?.content).toContain("scratch");
    expect(turn?.content).not.toContain("recognises");
  });

  // A selection carries its file's type too: a passage from a Python file is Python, and the model
  // is being asked about that passage rather than about the file.
  it("names the type of the file a selection came from", () => {
    const context = resolveChatContext({
      selection: "def greet():",
      file: { path: "main.py", content: "def greet():\n    pass\n", fileType: "python" },
    });
    const [turn] = turnsFor(context);
    expect(turn?.content).toContain("python");
  });
});

/// The outline follows the File types setting, so it has not been markdown-only since 0.33.0.
/// Telling the model otherwise is telling it something false about the list it is reading.
describe("what the outline turn calls its list", () => {
  it("does not claim the files are all markdown", () => {
    const context = resolveChatContext({
      selection: "",
      file: null,
      folder: { path: "", paths: ["main.py", "notes.md"], truncated: false },
    });
    const [turn] = turnsFor(context);
    expect(turn?.content).toContain("main.py");
    expect(turn?.content).not.toContain("markdown files");
  });
});

/// What the outline turn tells the model to DO with the list.
///
/// It used to say "call get_file_contents" always, including to models that were never sent a tool -
/// so a list of paths arrived with an instruction the model could not follow, and it reported that
/// it could only see the open document. The turn now describes the mechanism that exists.
describe("how the outline says to read a file", () => {
  const folder = (reads: "tool" | "fenced") =>
    contextTurns(
      resolveChatContext({
        selection: "",
        file: null,
        folder: { path: "notes", paths: ["notes/plan.md"], truncated: false },
      }),
      { reads },
    )[0]?.content ?? "";

  it("names the tool when the model was sent one", () => {
    expect(folder("tool")).toContain("get_file_contents");
    expect(folder("tool")).not.toContain(READ_FENCE_TAG);
  });

  it("describes the fenced block when it was not", () => {
    expect(folder("fenced")).toContain(READ_FENCE_TAG);
    expect(folder("fenced")).not.toContain("get_file_contents");
  });

  // The path in the example has to be one from the list, or the first thing the model copies is a
  // path that will be refused.
  it("shows the fenced form using a path the model was actually offered", () => {
    expect(folder("fenced")).toContain("notes/plan.md");
  });

  it("says either way that files below the attached folder can be read", () => {
    for (const reads of ["tool", "fenced"] as const) {
      expect(folder(reads)).toMatch(/attached folder.*below|inside the attached folder/i);
    }
  });
});
