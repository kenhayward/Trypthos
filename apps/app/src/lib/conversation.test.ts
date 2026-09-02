import { describe, expect, it } from "vitest";
import {
  appendToken,
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
