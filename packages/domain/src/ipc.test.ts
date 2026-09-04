import { describe, expect, it } from "vitest";
import {
  CloseWindowRequest,
  DiscardChoiceSchema,
  DocumentDirtyRequest,
  IPC_CHANNELS,
  ListRequest,
  ReadRequest,
  SetSecretRequest,
  WindowStateSchema,
  WriteRequest,
} from "./ipc";

describe("IPC_CHANNELS", () => {
  it("is a closed list, so the preload bridge stays enumerable", () => {
    expect([...IPC_CHANNELS]).toEqual([
      "workspace:open",
      "workspace:list",
      "file:read",
      "file:write",
      "window:minimize",
      "window:toggleMaximize",
      "window:close",
      "settings:read",
      "settings:write",
      "workspace:reopen",
      "secrets:list",
      "secrets:set",
      "secrets:delete",
      "chat:send",
      "chat:cancel",
      "menu:popup",
      "chats:list",
      "chats:load",
      "chats:save",
      "chats:delete",
      "workspace:outline",
      "document:dirty",
      "document:confirmDiscard",
    ]);
  });

  // The security property, stated where someone adding a channel will read it. `secrets:list`
  // answers with endpoints; nothing answers with a key. The shell's leak guard proves it holds by
  // calling every handler - this is the reminder of why that guard exists.
  it("has no channel that reads a stored key back", () => {
    const readsSecrets = IPC_CHANNELS.filter((channel) =>
      /^secrets:(get|read|reveal|export)/.test(channel),
    );
    expect(readsSecrets).toEqual([]);
  });
});

describe("WindowStateSchema", () => {
  it("accepts a state push from the main process", () => {
    expect(WindowStateSchema.parse({ maximized: true })).toEqual({ maximized: true });
  });

  // Validated even though main is trusted: without it a shape change surfaces as a button that
  // quietly stops updating, rather than as an error anybody notices.
  it("rejects a shape it does not recognise", () => {
    expect(() => WindowStateSchema.parse({ maximized: "yes" })).toThrow();
    expect(() => WindowStateSchema.parse({})).toThrow();
    expect(() => WindowStateSchema.parse({ maximized: true, extra: 1 })).toThrow();
  });
});

describe("ListRequest", () => {
  it("accepts a workspace-relative path", () => {
    expect(ListRequest.parse({ path: "notes" })).toEqual({ path: "notes" });
  });

  it("accepts the workspace root", () => {
    expect(ListRequest.parse({ path: "" })).toEqual({ path: "" });
  });

  it("rejects anything that is not a string path", () => {
    expect(() => ListRequest.parse({ path: 42 })).toThrow();
    expect(() => ListRequest.parse({})).toThrow();
  });

  // The renderer is untrusted. The main process re-validates every argument, and a payload carrying
  // extra fields is a sign something is wrong rather than something to quietly ignore.
  it("rejects unknown fields", () => {
    expect(() => ListRequest.parse({ path: "notes", root: "/etc" })).toThrow();
  });
});

describe("ReadRequest", () => {
  it("accepts a path", () => {
    expect(ReadRequest.parse({ path: "a/b.md" })).toEqual({ path: "a/b.md" });
  });

  it("rejects an empty path, since there is no file at the root itself", () => {
    expect(() => ReadRequest.parse({ path: "" })).toThrow();
  });
});

describe("WriteRequest", () => {
  it("requires the revision the caller last saw", () => {
    const parsed = WriteRequest.parse({
      path: "a.md",
      content: "hello",
      expectedRevision: { id: "123-45" },
    });
    expect(parsed.expectedRevision).toEqual({ id: "123-45" });
  });

  // Creating a new file is the only case with nothing to compare against, and it has to be stated
  // rather than implied by omission - a missing field would otherwise read as "overwrite whatever
  // is there", which is exactly the accident the revision exists to prevent.
  it("accepts an explicit null revision, for creating a file", () => {
    const parsed = WriteRequest.parse({ path: "a.md", content: "x", expectedRevision: null });
    expect(parsed.expectedRevision).toBeNull();
  });

  it("rejects a write with no revision field at all", () => {
    expect(() => WriteRequest.parse({ path: "a.md", content: "x" })).toThrow();
  });

  it("accepts empty content, which is a legitimate document", () => {
    expect(WriteRequest.parse({ path: "a.md", content: "", expectedRevision: null }).content).toBe("");
  });
});

describe("SetSecretRequest", () => {
  it("accepts an endpoint and a key", () => {
    const parsed = SetSecretRequest.parse({
      endpoint: "https://api.example.com/v1",
      key: "sk-test-do-not-use-90210",
    });
    expect(parsed.endpoint).toBe("https://api.example.com/v1");
  });

  it("rejects an endpoint that is not a URL", () => {
    expect(() => SetSecretRequest.parse({ endpoint: "localhost", key: "sk-test-1" })).toThrow();
  });

  it("rejects an empty key, which is a mistake rather than a key", () => {
    expect(() =>
      SetSecretRequest.parse({ endpoint: "https://api.example.com/v1", key: "" }),
    ).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() =>
      SetSecretRequest.parse({
        endpoint: "https://api.example.com/v1",
        key: "sk-test-1",
        profileId: "one",
      }),
    ).toThrow();
  });
});

/// Unsaved work, and the two sides that have to agree about it.
///
/// The dirty flag lives in the renderer, and the decision to close lives in the main process. That
/// split is the whole reason these channels exist: without them the window closes on a document
/// nobody saved, which is the one bug in this app that destroys the user's own writing.
describe("the unsaved-changes channels", () => {
  it("carries the dirty flag, and nothing else", () => {
    expect(() => DocumentDirtyRequest.parse({ dirty: true })).not.toThrow();
    expect(() => DocumentDirtyRequest.parse({ dirty: "yes" })).toThrow();
    expect(() => DocumentDirtyRequest.parse({ dirty: true, path: "notes.md" })).toThrow();
  });

  // Three answers, because there are three things a person can mean. "Not now" has to be one of
  // them, or the prompt is a demand rather than a question.
  it("offers save, discard and cancel, and nothing else", () => {
    for (const choice of ["save", "discard", "cancel"]) {
      expect(() => DiscardChoiceSchema.parse(choice)).not.toThrow();
    }
    expect(() => DiscardChoiceSchema.parse("ignore")).toThrow();
  });

  // Forcing it is what the renderer does AFTER it has asked; without the flag the main process would
  // ask again and the window would never close.
  it("lets a close say it has already been decided", () => {
    expect(() => CloseWindowRequest.parse({ force: true })).not.toThrow();
    expect(CloseWindowRequest.parse({}).force).toBe(false);
    expect(() => CloseWindowRequest.parse({ force: "yes" })).toThrow();
  });

  it("registers both channels on the enumerated surface", () => {
    expect(IPC_CHANNELS).toContain("document:dirty");
    expect(IPC_CHANNELS).toContain("document:confirmDiscard");
  });
});
