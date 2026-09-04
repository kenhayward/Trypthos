import { describe, expect, it } from "vitest";
import {
  blankDraft,
  draftFrom,
  removeProfile,
  toProfile,
  upsertProfile,
  type ProfileDraft,
} from "./chatProfiles";

const draft: ProfileDraft = {
  id: "one",
  label: "Local model",
  endpoint: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  temperature: "",
  maxTokens: "",
  contextWindow: "",
  supportsImages: false,
  supportsTools: false,
  isDefault: false,
};

describe("the context window", () => {
  // An empty box is "I do not know", which is a real answer: the dial then shows what is being sent
  // without claiming to know how much room is left.
  it("is null when the box is empty, not zero", () => {
    const result = toProfile(draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.contextWindow).toBeNull();
  });

  it("carries a number through", () => {
    const result = toProfile({ ...draft, contextWindow: "128000" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.contextWindow).toBe(128_000);
  });

  it("reports a nonsense window as that field's problem", () => {
    const result = toProfile({ ...draft, contextWindow: "lots" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("contextWindow");
  });

  // Zero would divide the dial by nothing; a fraction is not a token count. Both are the schema's
  // rules, reported against the field the user typed in rather than as a form-wide failure.
  it("reports zero and a fraction as that field's problem", () => {
    for (const value of ["0", "1.5"]) {
      const result = toProfile({ ...draft, contextWindow: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toContain("contextWindow");
    }
  });

  it("shows a stored window in the form, and an unset one as an empty box", () => {
    const profile = {
      id: "one",
      label: "Local model",
      endpoint: "http://localhost:11434/v1",
      model: "qwen2.5-coder",
      contextWindow: 8192,
      supportsImages: false,
      supportsTools: false,
      isDefault: false,
    };

    expect(draftFrom(profile).contextWindow).toBe("8192");
    expect(draftFrom({ ...profile, contextWindow: null }).contextWindow).toBe("");
  });
});

describe("toProfile", () => {
  it("accepts a filled-in draft", () => {
    const result = toProfile(draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.model).toBe("qwen2.5-coder");
  });

  // The number fields are text inputs, so "empty" and "not set" are the same thing to the user. An
  // empty box has to mean "let the provider decide", not "send zero".
  it("leaves an empty parameter unset rather than sending a zero", () => {
    const result = toProfile(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.temperature).toBeUndefined();
      expect(result.profile.maxTokens).toBeUndefined();
    }
  });

  it("parses parameters that were filled in", () => {
    const result = toProfile({ ...draft, temperature: "0.2", maxTokens: "4096" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.temperature).toBe(0.2);
      expect(result.profile.maxTokens).toBe(4096);
    }
  });

  it("names the fields that are wrong, so the form can point at them", () => {
    const result = toProfile({ ...draft, label: "  ", endpoint: "localhost", model: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.sort()).toEqual(["endpoint", "label", "model"]);
  });

  it("rejects a temperature outside the range a provider will accept", () => {
    const result = toProfile({ ...draft, temperature: "9" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual(["temperature"]);
  });

  // "abc" parses to NaN, which would otherwise reach the settings file and be written as null.
  it("rejects a parameter that is not a number", () => {
    const result = toProfile({ ...draft, maxTokens: "lots" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual(["maxTokens"]);
  });

  it("trims surrounding whitespace, which a pasted endpoint usually carries", () => {
    const result = toProfile({ ...draft, endpoint: "  http://localhost:11434/v1  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.endpoint).toBe("http://localhost:11434/v1");
  });
});

describe("upsertProfile", () => {
  const first = { ...draft, id: "one" };
  const second = { ...draft, id: "two", label: "Second" };

  it("appends a profile that is not in the list yet", () => {
    const profiles = upsertProfile([], expectProfile(first));
    expect(profiles.map((profile) => profile.id)).toEqual(["one"]);
  });

  it("replaces an existing profile in place, keeping the order", () => {
    const list = upsertProfile(upsertProfile([], expectProfile(first)), expectProfile(second));
    const edited = upsertProfile(list, { ...expectProfile(first), label: "Renamed" });

    expect(edited.map((profile) => profile.id)).toEqual(["one", "two"]);
    expect(edited[0]?.label).toBe("Renamed");
  });

  // Two defaults is a state the settings schema rejects outright, so the UI must never be able to
  // produce it - saving a profile as default has to clear the previous one.
  it("moves the default rather than adding a second one", () => {
    const list = upsertProfile(upsertProfile([], expectProfile(first)), {
      ...expectProfile(second),
      isDefault: true,
    });
    const moved = upsertProfile(list, { ...expectProfile(first), isDefault: true });

    expect(moved.filter((profile) => profile.isDefault).map((profile) => profile.id)).toEqual([
      "one",
    ]);
  });

  it("keeps the existing default when the saved profile is not the default", () => {
    const list = upsertProfile([], { ...expectProfile(first), isDefault: true });
    const added = upsertProfile(list, expectProfile(second));

    expect(added.filter((profile) => profile.isDefault).map((profile) => profile.id)).toEqual([
      "one",
    ]);
  });
});

describe("removeProfile", () => {
  it("removes by id and leaves the rest", () => {
    const list = upsertProfile(upsertProfile([], expectProfile(draft)), {
      ...expectProfile(draft),
      id: "two",
    });

    expect(removeProfile(list, "one").map((profile) => profile.id)).toEqual(["two"]);
  });

  it("is unbothered by an id that is not there", () => {
    expect(removeProfile([], "nope")).toEqual([]);
  });
});

describe("drafts", () => {
  it("round-trips a saved profile back into an editable draft", () => {
    const profile = expectProfile({ ...draft, temperature: "0.7", maxTokens: "2048" });
    const back = draftFrom(profile);

    expect(back.temperature).toBe("0.7");
    expect(back.maxTokens).toBe("2048");
    expect(back.label).toBe("Local model");
  });

  it("shows an unset parameter as an empty box, not as the word undefined", () => {
    const back = draftFrom(expectProfile(draft));
    expect(back.temperature).toBe("");
    expect(back.maxTokens).toBe("");
  });

  it("starts a new profile with a unique id and empty fields", () => {
    const a = blankDraft();
    const b = blankDraft();

    expect(a.id).not.toBe(b.id);
    expect(a.label).toBe("");
    expect(a.endpoint).toBe("");
  });
});

function expectProfile(value: ProfileDraft) {
  const result = toProfile(value);
  if (!result.ok) throw new Error(`fixture is not a valid profile: ${result.issues.join(", ")}`);
  return result.profile;
}

describe("tool calling", () => {
  it("is off for a new profile, because it cannot be detected", () => {
    expect(blankDraft().supportsTools).toBe(false);
  });

  it("survives a save and a reopen", () => {
    const result = toProfile({ ...draft, supportsTools: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.supportsTools).toBe(true);
      expect(draftFrom(result.profile).supportsTools).toBe(true);
    }
  });
});
