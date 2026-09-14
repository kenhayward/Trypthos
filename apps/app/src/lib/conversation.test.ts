import { describe, expect, it } from "vitest";
import { ChatTurnSchema } from "@trypthos/domain";
import {
  appendToken,
  noteTool,
  noteToolCut,
  noteReasoning,
  wireTurns,
  askedBy,
  beginReply,
  historyWithoutReply,
  setReply,
  type Turn,
} from "./conversation";

const user = (content: string): Turn => ({ role: "user", content });
const assistant = (content: string): Turn => ({ role: "assistant", content });

describe("beginReply", () => {
  it("adds the empty assistant turn that tokens will fill", () => {
    expect(beginReply([user("Hello")])).toEqual([user("Hello"), assistant("")]);
  });
});

describe("appendToken", () => {
  it("grows the reply in place", () => {
    const turns = appendToken(appendToken(beginReply([user("Hi")]), "Hel"), "lo");
    expect(turns.at(-1)).toEqual(assistant("Hello"));
  });

  it("leaves the question alone", () => {
    const turns = appendToken(beginReply([user("Hi")]), "Reply");
    expect(turns[0]).toEqual(user("Hi"));
  });

  // A late token from a stream the panel has stopped listening to. Appending it to a user's own
  // message would put words in their mouth, which is worse than dropping it.
  it("ignores a token when the last turn is not a reply", () => {
    expect(appendToken([user("Hi")], "stray")).toEqual([user("Hi")]);
  });

  it("ignores a token when there is nothing at all", () => {
    expect(appendToken([], "stray")).toEqual([]);
  });

  // React re-renders on identity, so a mutated array would leave the thread showing the previous
  // token until something else happened to change.
  it("returns a new array rather than mutating the old one", () => {
    const before = beginReply([user("Hi")]);
    const after = appendToken(before, "x");

    expect(after).not.toBe(before);
    expect(before.at(-1)?.content).toBe("");
  });
});

describe("setReply", () => {
  it("replaces the reply wholesale, for an error message", () => {
    const turns = setReply(appendToken(beginReply([user("Hi")]), "Half"), "[Something failed]");
    expect(turns.at(-1)).toEqual(assistant("[Something failed]"));
  });

  it("does nothing when the last turn is not a reply", () => {
    expect(setReply([user("Hi")], "x")).toEqual([user("Hi")]);
  });
});

describe("historyWithoutReply", () => {
  // What retry sends. The failed or unwanted reply is dropped; the question is asked again.
  it("drops a trailing reply", () => {
    expect(historyWithoutReply([user("Hi"), assistant("Bad answer")])).toEqual([user("Hi")]);
  });

  it("leaves a history already ending in a question", () => {
    expect(historyWithoutReply([user("Hi")])).toEqual([user("Hi")]);
  });

  it("is empty for an empty thread", () => {
    expect(historyWithoutReply([])).toEqual([]);
  });
});

describe("askedBy", () => {
  it("finds the question a retry would repeat", () => {
    expect(askedBy([user("First"), assistant("A"), user("Second"), assistant("B")])).toBe("Second");
  });

  it("has nothing to repeat in an empty thread", () => {
    expect(askedBy([])).toBeNull();
  });

  it("has nothing to repeat when nobody has asked anything", () => {
    expect(askedBy([assistant("Unprompted")])).toBeNull();
  });
});

/// What the model did on the user's behalf while producing a reply.
///
/// Recorded ON the turn rather than beside it, so scrolling back to an answer shows what it read to
/// get there. That means the panel's turn is no longer the wire turn - see `wireTurns`.
describe("noteTool", () => {
  const replying = [
    { role: "user" as const, content: "What is in main.js?" },
    { role: "assistant" as const, content: "" },
  ];
  const read = (detail: string) => ({ name: "get_file_contents", detail });

  it("records a call against the reply in progress", () => {
    expect(noteTool(replying, read("src/main.js")).at(-1)?.tools).toEqual([read("src/main.js")]);
  });

  it("keeps them in the order they were made", () => {
    const listed = { name: "list_directory", detail: "src" };
    const after = noteTool(noteTool(replying, listed), read("src/b.js"));
    expect(after.at(-1)?.tools).toEqual([listed, read("src/b.js")]);
  });

  // The list is a record of what the model did, not a set of what it looked at. A model that read
  // the same file twice made two calls, and a list that hid one would be hiding the model's work.
  it("records a repeated call each time it was made", () => {
    const after = noteTool(noteTool(replying, read("a.js")), read("a.js"));
    expect(after.at(-1)?.tools).toEqual([read("a.js"), read("a.js")]);
  });

  // The same rule the token appender follows: a late event from a stream nobody is listening to
  // must not attach itself to somebody's own message.
  it("drops a call when the last turn is not a reply", () => {
    const user = [{ role: "user" as const, content: "Hello" }];
    expect(noteTool(user, read("a.js"))).toEqual(user);
  });

  it("leaves the reply's text alone", () => {
    const withText = [{ role: "assistant" as const, content: "Half an answer" }];
    expect(noteTool(withText, read("a.js")).at(-1)?.content).toBe("Half an answer");
  });
});

/// A read that had to be cut to the model's budget, reported straight after the call that read it.
describe("noteToolCut", () => {
  const read = (detail: string) => ({ name: "get_file_contents", detail });

  it("marks the most recent call on the reply in progress", () => {
    const replying = [
      { role: "user" as const, content: "Summarise these" },
      { role: "assistant" as const, content: "", tools: [read("a.md"), read("big.md")] },
    ];

    expect(noteToolCut(replying, { sent: 3_600, total: 5_003 }).at(-1)?.tools).toEqual([
      read("a.md"),
      { ...read("big.md"), cut: { sent: 3_600, total: 5_003 } },
    ]);
  });

  // Nothing to attach it to. A cut with no call before it is a stray event, not a reason to invent one.
  it("changes nothing when the reply has made no call", () => {
    const replying = [{ role: "assistant" as const, content: "" }];
    expect(noteToolCut(replying, { sent: 1, total: 2 })).toEqual(replying);
  });

  it("changes nothing when the last turn is not a reply", () => {
    const user = [{ role: "user" as const, content: "Hello" }];
    expect(noteToolCut(user, { sent: 1, total: 2 })).toEqual(user);
  });
});

/// The conversation as a PROVIDER receives it.
///
/// The panel's turns carry things a provider must never see. `ChatTurnSchema` is strict, so a turn
/// that skipped this conversion is a loud parse failure at the IPC boundary rather than a silent
/// leak - but the conversion is what makes that never happen.
describe("wireTurns", () => {
  it("carries the conversation across", () => {
    const turns = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];
    expect(wireTurns(turns)).toEqual(turns);
  });

  it("strips what the panel recorded for itself", () => {
    const turns = [
      {
        role: "assistant" as const,
        content: "Hi",
        tools: [{ name: "get_file_contents", detail: "a.js" }],
      },
    ];
    expect(wireTurns(turns)).toEqual([{ role: "assistant", content: "Hi" }]);
  });

  it("passes what it produces through the wire schema", () => {
    const turns = [
      {
        role: "assistant" as const,
        content: "Hi",
        tools: [{ name: "get_file_contents", detail: "a.js" }],
      },
    ];
    for (const turn of wireTurns(turns)) {
      expect(() => ChatTurnSchema.parse(turn)).not.toThrow();
    }
  });
});

/// What the model thought, kept with the reply it thought for.
///
/// It used to be one string on the hook, cleared on the next send and shown only when a reply
/// produced no answer at all - so a reply that thought and then answered lost its thinking the
/// moment it answered.
describe("noteReasoning", () => {
  const replying = [
    { role: "user" as const, content: "Why?" },
    { role: "assistant" as const, content: "" },
  ];

  it("collects it against the reply in progress", () => {
    const after = noteReasoning(noteReasoning(replying, "Because "), "of that.");
    expect(after.at(-1)?.reasoning).toBe("Because of that.");
  });

  it("leaves the reply's text alone", () => {
    const withText = [{ role: "assistant" as const, content: "Half an answer" }];
    expect(noteReasoning(withText, "hmm").at(-1)?.content).toBe("Half an answer");
  });

  it("drops it when the last turn is not a reply", () => {
    const user = [{ role: "user" as const, content: "Hello" }];
    expect(noteReasoning(user, "hmm")).toEqual(user);
  });

  // Reasoning is the model's own working, and the wire turn is what a provider receives. gpt-oss's
  // own format says prior reasoning is dropped between turns, and resending it would spend the
  // context window on it besides.
  it("is stripped by wireTurns like everything else the panel records", () => {
    const turns = [{ role: "assistant" as const, content: "Hi", reasoning: "I thought about it" }];
    expect(wireTurns(turns)).toEqual([{ role: "assistant", content: "Hi" }]);
  });
});

/// A turn the app wrote rather than the model - the answer to a slash command.
///
/// It is in the thread because that is where the user asked, and it is saved with the chat because
/// that is what the panel showed. What it must never do is go BACK to a provider: a table of this
/// app's own commands is not part of the conversation, and paying for it in every later request
/// would be paying to confuse the model about what it can do.
describe("local turns", () => {
  const turns: Turn[] = [
    { role: "user", content: "What does this do?" },
    { role: "assistant", content: "It edits markdown." },
    { role: "user", content: "/tools", local: true },
    { role: "assistant", content: "| Tool | What it does |", local: true },
    { role: "user", content: "And now?" },
  ];

  it("keeps them out of what is sent to the provider", () => {
    expect(wireTurns(turns)).toEqual([
      { role: "user", content: "What does this do?" },
      { role: "assistant", content: "It edits markdown." },
      { role: "user", content: "And now?" },
    ]);
  });

  it("sends an ordinary conversation unchanged", () => {
    const ordinary: Turn[] = [{ role: "user", content: "Hello" }];
    expect(wireTurns(ordinary)).toEqual([{ role: "user", content: "Hello" }]);
  });
});
