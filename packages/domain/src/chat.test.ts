import { describe, expect, it } from "vitest";
import {
  ChatProfileListSchema,
  ChatProfileSchema,
  defaultChatProfile,
  parseChatProfiles,
} from "./chat";

const valid = {
  id: "local-qwen",
  label: "Qwen (local)",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  isDefault: true,
};

describe("ChatProfileSchema", () => {
  it("accepts a minimal profile and defaults the optional parameters", () => {
    const parsed = ChatProfileSchema.parse(valid);
    expect(parsed.label).toBe("Qwen (local)");
    expect(parsed.temperature).toBeUndefined();
    expect(parsed.isDefault).toBe(true);
  });

  it("accepts generation parameters when present", () => {
    const parsed = ChatProfileSchema.parse({ ...valid, temperature: 0.2, maxTokens: 4096 });
    expect(parsed.temperature).toBe(0.2);
    expect(parsed.maxTokens).toBe(4096);
  });

  // The key belongs in the OS credential store, never in a settings file. Stripping an unknown
  // `apiKey` silently would let one get written by a future bug and never be noticed; rejecting the
  // whole profile makes it loud the first time it happens.
  it("rejects a profile carrying an apiKey", () => {
    expect(() => ChatProfileSchema.parse({ ...valid, apiKey: "sk-live-1234" })).toThrow();
  });

  it("rejects any unknown field", () => {
    expect(() => ChatProfileSchema.parse({ ...valid, sneaky: true })).toThrow();
  });

  it("rejects an endpoint that is not a URL", () => {
    expect(() => ChatProfileSchema.parse({ ...valid, endpoint: "not a url" })).toThrow();
  });

  it("rejects a blank model slug", () => {
    expect(() => ChatProfileSchema.parse({ ...valid, model: "" })).toThrow();
  });
});

describe("parseChatProfiles", () => {
  it("parses a list", () => {
    expect(parseChatProfiles([valid])).toHaveLength(1);
  });

  it("rejects two profiles sharing an id", () => {
    expect(() => parseChatProfiles([valid, { ...valid, label: "Copy" }])).toThrow(/duplicate/i);
  });

  it("rejects more than one default", () => {
    expect(() =>
      parseChatProfiles([valid, { ...valid, id: "other", isDefault: true }]),
    ).toThrow(/default/i);
  });
});

// The same invariants, reachable as a schema so a settings file gets them too. Without this the
// checks would live only in `parseChatProfiles`, and a hand-edited settings file with two defaults
// would load happily - the picker then showing whichever the UI happened to find first.
describe("ChatProfileListSchema", () => {
  it("parses a valid list", () => {
    expect(ChatProfileListSchema.parse([valid])).toHaveLength(1);
  });

  it("rejects two profiles sharing an id", () => {
    expect(() => ChatProfileListSchema.parse([valid, { ...valid, label: "Copy" }])).toThrow(
      /duplicate/i,
    );
  });

  it("rejects more than one default", () => {
    expect(() =>
      ChatProfileListSchema.parse([valid, { ...valid, id: "other", isDefault: true }]),
    ).toThrow(/default/i);
  });
});

describe("defaultChatProfile", () => {
  const parse = (profiles: unknown[]) => ChatProfileListSchema.parse(profiles);

  it("has nothing to offer when nothing is configured", () => {
    expect(defaultChatProfile([])).toBeNull();
  });

  it("picks the one marked default, wherever it sits in the list", () => {
    const profiles = parse([
      { ...valid, id: "first", isDefault: false },
      { ...valid, id: "second", isDefault: true },
    ]);
    expect(defaultChatProfile(profiles)?.id).toBe("second");
  });

  // Deleting the default is one click away, and a chat panel with no model to start on would be a
  // dead panel. The first configured profile is the sensible floor.
  it("falls back to the first when none is marked", () => {
    const profiles = parse([
      { ...valid, id: "first", isDefault: false },
      { ...valid, id: "second", isDefault: false },
    ]);
    expect(defaultChatProfile(profiles)?.id).toBe("first");
  });
});
