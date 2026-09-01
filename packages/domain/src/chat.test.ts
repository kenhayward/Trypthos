import { describe, expect, it } from "vitest";
import { ChatProfileSchema, parseChatProfiles } from "./chat";

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
