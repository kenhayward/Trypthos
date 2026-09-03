import { describe, expect, it } from "vitest";
import {
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
