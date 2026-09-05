import { describe, expect, it } from "vitest";
import { ChatTurnSchema } from "@trypthos/domain";
import {
  appendToken,
  noteRead,
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
describe("noteRead", () => {
  const replying = [
    { role: "user" as const, content: "What is in main.js?" },
    { role: "assistant" as const, content: "" },
  ];

  it("records a file against the reply in progress", () => {
    expect(noteRead(replying, "src/main.js").at(-1)?.reads).toEqual(["src/main.js"]);
  });

  it("keeps them in the order they were asked for", () => {
    const after = noteRead(noteRead(replying, "a.js"), "b.js");
    expect(after.at(-1)?.reads).toEqual(["a.js", "b.js"]);
  });

  // A model that asks for the same file twice read it twice, but the line says what it looked at -
  // and naming one file twice reads as a mistake in the panel rather than a fact about the turn.
  it("names a file once however often it was asked for", () => {
    const after = noteRead(noteRead(replying, "a.js"), "a.js");
    expect(after.at(-1)?.reads).toEqual(["a.js"]);
  });

  // The same rule the token appender follows: a late event from a stream nobody is listening to
  // must not attach itself to somebody's own message.
  it("drops a read when the last turn is not a reply", () => {
    const user = [{ role: "user" as const, content: "Hello" }];
    expect(noteRead(user, "a.js")).toEqual(user);
  });

  it("leaves the reply's text alone", () => {
    const withText = [{ role: "assistant" as const, content: "Half an answer" }];
    expect(noteRead(withText, "a.js").at(-1)?.content).toBe("Half an answer");
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
    const turns = [{ role: "assistant" as const, content: "Hi", reads: ["a.js", "b.js"] }];
    expect(wireTurns(turns)).toEqual([{ role: "assistant", content: "Hi" }]);
  });

  it("passes what it produces through the wire schema", () => {
    const turns = [{ role: "assistant" as const, content: "Hi", reads: ["a.js"] }];
    for (const turn of wireTurns(turns)) {
      expect(() => ChatTurnSchema.parse(turn)).not.toThrow();
    }
  });
});
