import { describe, expect, it } from "vitest";
import {
  CHAT_SESSION_VERSION,
  SAVED_REASONING_LIMIT,
  cappedForSaving,
  chatTitleFrom,
  loadChatSession,
  summariseSession,
} from "./chatSession";

/// A saved conversation, as it sits on disk.
///
/// The awkward part is not the shape but what it REFERENCES. A chat lives in the app-data directory
/// and names a workspace and a file it does not own, so by the time it is opened again the file may
/// have been renamed, moved or deleted, and the workspace may not be open at all. Every one of those
/// has to open and say so rather than fail.

const session = {
  schemaVersion: CHAT_SESSION_VERSION,
  id: "3f1a1a2e-0000-4000-8000-000000000000",
  title: "About the plan",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:05:00.000Z",
  workspaceRoot: "D:/Notes",
  filePath: "plan.md",
  profileId: "local",
  turns: [
    { role: "user" as const, content: "Summarise this" },
    { role: "assistant" as const, content: "It is a plan." },
  ],
};

describe("loadChatSession", () => {
  it("reads a saved conversation", () => {
    const loaded = loadChatSession(session);
    expect(loaded?.title).toBe("About the plan");
    expect(loaded?.turns).toHaveLength(2);
  });

  // Unlike settings, a chat is the user's own words. There is no sensible default to fall back to,
  // so a file that cannot be read is reported as missing rather than replaced with an empty one -
  // which would look exactly like a conversation that had been lost.
  it("refuses a file it cannot read, rather than inventing an empty chat", () => {
    expect(loadChatSession({ nonsense: true })).toBeNull();
    expect(loadChatSession(null)).toBeNull();
    expect(loadChatSession("not an object")).toBeNull();
  });

  it("refuses a file from a newer version rather than guessing at it", () => {
    expect(loadChatSession({ ...session, schemaVersion: 99 })).toBeNull();
  });

  it("refuses a file with no version at all", () => {
    const unversioned: Record<string, unknown> = { ...session };
    delete unversioned.schemaVersion;
    expect(loadChatSession(unversioned)).toBeNull();
  });

  // The reference is to a workspace this chat does not own. None of these stop it opening.
  it("opens a chat whose file reference is empty", () => {
    expect(loadChatSession({ ...session, filePath: null, workspaceRoot: null })?.turns).toHaveLength(
      2,
    );
  });

  it("opens a chat whose model is no longer configured", () => {
    expect(loadChatSession({ ...session, profileId: "deleted" })?.profileId).toBe("deleted");
  });

  it("refuses a chat with no turns, which is not a conversation", () => {
    expect(loadChatSession({ ...session, turns: [] })).toBeNull();
  });

  // The wire format has three roles; a saved file must not be able to smuggle in a fourth.
  it("refuses a turn with a role nobody recognises", () => {
    expect(loadChatSession({ ...session, turns: [{ role: "system-admin", content: "x" }] })).toBeNull();
  });
});

describe("summariseSession", () => {
  it("carries what the list needs and nothing else", () => {
    expect(summariseSession(loadChatSession(session)!)).toEqual({
      id: session.id,
      title: "About the plan",
      updatedAt: session.updatedAt,
      filePath: "plan.md",
    });
  });

  // The list is shown before anything is opened, so it must not carry the conversation with it: a
  // hundred saved chats would mean reading every word of every one to draw a menu.
  it("leaves the turns out", () => {
    const summary: Record<string, unknown> = { ...summariseSession(loadChatSession(session)!) };
    expect("turns" in summary).toBe(false);
  });
});

describe("chatTitleFrom", () => {
  it("names a chat after the question that started it", () => {
    expect(chatTitleFrom([{ role: "user", content: "Summarise this document" }])).toBe(
      "Summarise this document",
    );
  });

  it("shortens a long question rather than filling the list with one entry", () => {
    const title = chatTitleFrom([{ role: "user", content: "word ".repeat(40) }]);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("...")).toBe(true);
  });

  it("collapses a question written over several lines", () => {
    expect(chatTitleFrom([{ role: "user", content: "Summarise\n\nthis  document" }])).toBe(
      "Summarise this document",
    );
  });

  it("skips a leading turn that is not the user's", () => {
    const title = chatTitleFrom([
      { role: "system", content: "You are an assistant." },
      { role: "user", content: "The real question" },
    ]);
    expect(title).toBe("The real question");
  });

  it("has a name for a conversation with nothing in it yet", () => {
    expect(chatTitleFrom([]).length).toBeGreaterThan(0);
  });

  it("has a name for a question that is only whitespace", () => {
    expect(chatTitleFrom([{ role: "user", content: "   " }]).length).toBeGreaterThan(0);
  });
});

/// What a saved chat keeps of the model's own working.
///
/// A chat that looked one way while it was open and another when reopened is a chat the user cannot
/// trust as a record - which is why reasoning is saved rather than dropped, and why what is dropped
/// says so.
describe("saved reasoning", () => {
  const base = {
    schemaVersion: CHAT_SESSION_VERSION,
    id: "abc",
    title: "A chat",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    workspaceRoot: null,
    filePath: null,
    profileId: null,
  };

  it("keeps the thinking and the files a reply read", () => {
    const session = {
      ...base,
      turns: [
        { role: "assistant", content: "Hi", reasoning: "I thought about it", reads: ["a.md"] },
      ],
    };
    const loaded = loadChatSession(session);

    expect(loaded).not.toBeNull();
    expect(loaded?.turns[0]?.reasoning).toBe("I thought about it");
    expect(loaded?.turns[0]?.reads).toEqual(["a.md"]);
  });

  // A version 1 file has neither, which is exactly what it had.
  it("loads a chat saved before any of this existed", () => {
    const old = {
      ...base,
      schemaVersion: 1,
      turns: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }],
    };
    const loaded = loadChatSession(old);

    expect(loaded).not.toBeNull();
    expect(loaded?.turns[1]?.reasoning).toBeUndefined();
    expect(loaded?.schemaVersion).toBe(CHAT_SESSION_VERSION);
  });
});

/// Chain of thought is frequently longer than the answer, and a chat file that is mostly discarded
/// thinking is a poor trade. Capped on the way to disk, and marked so the panel can say so.
describe("cappedForSaving", () => {
  it("leaves a short reply alone", () => {
    const turns = [{ role: "assistant" as const, content: "Hi", reasoning: "Brief." }];
    expect(cappedForSaving(turns)).toEqual(turns);
  });

  it("shortens thinking that is too long, and says it did", () => {
    const long = "x".repeat(SAVED_REASONING_LIMIT + 500);
    const [turn] = cappedForSaving([{ role: "assistant", content: "Hi", reasoning: long }]);

    expect(turn?.reasoning?.length).toBe(SAVED_REASONING_LIMIT);
    expect(turn?.reasoningTruncated).toBe(true);
  });

  // The beginning, as everywhere else in this app: reasoning says what it is about in its first
  // lines, and an arbitrary middle is worth less than an opening.
  it("keeps the beginning", () => {
    const long = "START" + "x".repeat(SAVED_REASONING_LIMIT);
    const [turn] = cappedForSaving([{ role: "assistant", content: "Hi", reasoning: long }]);

    expect(turn?.reasoning?.startsWith("START")).toBe(true);
  });

  it("never marks a reply it did not shorten", () => {
    const [turn] = cappedForSaving([{ role: "assistant", content: "Hi", reasoning: "Brief." }]);
    expect(turn?.reasoningTruncated).toBeUndefined();
  });
});

/// A chat containing the answer to a slash command.
///
/// The panel showed it, so the saved chat keeps it - a conversation that read one way while open and
/// another when reopened is one the user cannot trust as a record. The flag travels with the turn so
/// reopening the chat does not start sending this app's own command tables to a provider.
describe("a locally answered turn", () => {
  const base = {
    schemaVersion: CHAT_SESSION_VERSION,
    id: "abc",
    title: "A chat",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    workspaceRoot: null,
    filePath: null,
    profileId: null,
  };

  it("is saved and read back as local", () => {
    const loaded = loadChatSession({
      ...base,
      turns: [
        { role: "user", content: "/tools", local: true },
        { role: "assistant", content: "| Tool |", local: true },
      ],
    });

    expect(loaded?.turns[0]?.local).toBe(true);
    expect(loaded?.turns[1]?.local).toBe(true);
  });

  // Every turn in a chat saved before this existed was one the model actually saw.
  it("loads a chat saved before local turns existed", () => {
    const older = {
      ...base,
      schemaVersion: 2,
      turns: [{ role: "user", content: "Hello" }],
    };
    const loaded = loadChatSession(older);

    expect(loaded).not.toBeNull();
    expect(loaded?.turns[0]?.local).toBeUndefined();
    expect(loaded?.schemaVersion).toBe(CHAT_SESSION_VERSION);
  });
});
