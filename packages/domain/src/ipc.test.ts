import { describe, expect, it } from "vitest";
import {
  ChatEventSchema,
  CloseWindowRequest,
  ConfirmDiscardRequest,
  OpenTargetSchema,
  SetIntegrationRequest,
  DiscardChoiceSchema,
  DocumentDirtyRequest,
  IPC_CHANNELS,
  OpenExternalRequest,
  OpenInNewWindowRequest,
  ListRequest,
  CreateDirectoryRequest,
  RenameRequest,
  RevealRequest,
  ReadRequest,
  SaveAsRequest,
  SetSecretRequest,
  TakeDraftResponse,
  WindowStateSchema,
  WriteRequest,
} from "./ipc";

describe("IPC_CHANNELS", () => {
  it("is a closed list, so the preload bridge stays enumerable", () => {
    expect([...IPC_CHANNELS]).toEqual([
      "workspace:open",
      "workspace:list",
      "workspace:createDirectory",
      "file:read",
      "file:write",
      "file:openInNewWindow",
      "file:saveAs",
      "file:readImage",
      "window:minimize",
      "window:toggleMaximize",
      "window:close",
      "settings:read",
      "settings:write",
      "workspace:openRef",
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
      "workspace:find",
    "workspace:filter",
      "workspace:close",
      "workspace:refresh",
      "document:dirty",
      "document:confirmDiscard",
      "document:takeDraft",
      "shell:openExternal",
      "shell:integration",
      "shell:setIntegration",
      "github:status",
      "github:connect",
      "github:disconnect",
      "github:repos",
      "github:repoInfo",
      "github:branches",
      "github:setBranch",
      "workspace:rename",
      "workspace:reveal",
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

/// The events a reply streams to the panel. Strict, because both sides are ours.
describe("ChatEventSchema", () => {
  // A file the model read was cut to fit its budget. Reported after the call it belongs to.
  it("accepts a report of how much of a read was sent", () => {
    expect(ChatEventSchema.parse({ type: "tool-cut", sent: 3_600, total: 5_003 })).toEqual({
      type: "tool-cut",
      sent: 3_600,
      total: 5_003,
    });
  });

  it("refuses a cut that is not two whole counts", () => {
    for (const event of [
      { type: "tool-cut", sent: 3_600 },
      { type: "tool-cut", sent: "3600", total: 5_003 },
      { type: "tool-cut", sent: 1.5, total: 5_003 },
      { type: "tool-cut", sent: 3_600, total: 5_003, path: "a.md" },
    ]) {
      expect(ChatEventSchema.safeParse(event).success).toBe(false);
    }
  });
});

describe("OpenExternalRequest", () => {
  it("accepts a web address", () => {
    expect(OpenExternalRequest.parse({ url: "https://example.com/a" })).toEqual({
      url: "https://example.com/a",
    });
  });

  // The renderer decided this was external before sending it. That is not a decision: the renderer
  // is untrusted, and the main process is the side holding a handle to the operating system.
  it("refuses a scheme the shell must never hand to the operating system", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ms-msdt:/id", "notes.md"]) {
      expect(OpenExternalRequest.safeParse({ url }).success).toBe(false);
    }
  });

  it("refuses anything but a url field", () => {
    expect(OpenExternalRequest.safeParse({ url: "https://example.com", open: true }).success).toBe(
      false,
    );
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

describe("CreateDirectoryRequest", () => {
  it("accepts a path inside an open workspace", () => {
    expect(CreateDirectoryRequest.parse({ path: "notes/archive" })).toEqual({ path: "notes/archive" });
  });

  it("requires a directory below the workspace root", () => {
    expect(() => CreateDirectoryRequest.parse({ path: "" })).toThrow();
  });
});

describe("RenameRequest", () => {
  it("accepts an entry below the root and the name it should have", () => {
    expect(RenameRequest.parse({ path: "Notes/a.md", name: "b.md" })).toEqual({
      path: "Notes/a.md",
      name: "b.md",
    });
  });

  it("refuses to rename without a path", () => {
    expect(() => RenameRequest.parse({ path: "", name: "b.md" })).toThrow();
  });

  // The dialog checks these too, but the renderer having checked is not a check - and a name
  // carrying a separator would be a move to somewhere the renderer chose.
  it.each(["", "  b.md", "b.md ", "../b.md", "sub/b.md", "a\\b.md", "CON", "b.", "a:b"])(
    "refuses the name %j",
    (name) => {
      expect(() => RenameRequest.parse({ path: "Notes/a.md", name })).toThrow();
    },
  );
});

describe("RevealRequest", () => {
  it("accepts any entry, the root included", () => {
    expect(RevealRequest.parse({ path: "Notes" })).toEqual({ path: "Notes" });
    expect(RevealRequest.parse({ path: "Notes/docs/a.md" })).toEqual({ path: "Notes/docs/a.md" });
  });

  it("refuses anything but a path", () => {
    expect(() => RevealRequest.parse({ path: "Notes", open: true })).toThrow();
  });
});

describe("OpenInNewWindowRequest", () => {
  it("accepts the qualified path of the file to show", () => {
    expect(OpenInNewWindowRequest.parse({ path: "Notes/plan.md" })).toEqual({ path: "Notes/plan.md" });
  });

  it("refuses an empty file path", () => {
    expect(() => OpenInNewWindowRequest.parse({ path: "" })).toThrow();
  });

  // A tab moving to its own window takes its unsaved text with it, and the revision that text was
  // based on - so a save from the new window still detects a file that changed on disk meanwhile.
  it("carries a tab's unsaved text and the revision it was based on", () => {
    const request = {
      path: "Notes/plan.md",
      draft: { content: "# Plan\n\nhalf written", revision: { id: "rev-1" } },
    };
    expect(OpenInNewWindowRequest.parse(request)).toEqual(request);
  });

  it("refuses a draft with no revision to measure a save against", () => {
    expect(() =>
      OpenInNewWindowRequest.parse({ path: "Notes/plan.md", draft: { content: "x" } }),
    ).toThrow();
  });

  it("refuses anything else riding along with the draft", () => {
    expect(() =>
      OpenInNewWindowRequest.parse({
        path: "Notes/plan.md",
        draft: { content: "x", revision: { id: "r" }, root: "/etc" },
      }),
    ).toThrow();
  });
});

describe("TakeDraftResponse", () => {
  // What a document window receives when it claims the draft it was opened with. Validated on
  // arrival like every other message from the main process.
  it("accepts a draft, or nothing when the window was opened without one", () => {
    const draft = { content: "text", revision: { id: "rev-1" } };
    expect(TakeDraftResponse.parse({ ok: true, draft })).toEqual({ ok: true, draft });
    expect(TakeDraftResponse.parse({ ok: true, draft: null })).toEqual({ ok: true, draft: null });
  });

  it("refuses a draft of the wrong shape", () => {
    expect(() => TakeDraftResponse.parse({ ok: true, draft: { content: 1 } })).toThrow();
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

describe("ConfirmDiscardRequest", () => {
  it("carries the name of the document being discarded", () => {
    const parsed = ConfirmDiscardRequest.safeParse({ name: "notes.md" });

    expect(parsed.success && parsed.data.name).toBe("notes.md");
  });

  // With one document there was one thing the prompt could be about. With tabs there are several, so
  // a nameless prompt asks about work the user cannot identify - but the name stays optional,
  // because the window closing is about the window rather than about any one file.
  it("allows no name at all", () => {
    const parsed = ConfirmDiscardRequest.safeParse({});

    expect(parsed.success && parsed.data.name).toBeNull();
  });

  it("refuses a name that is not a string", () => {
    expect(ConfirmDiscardRequest.safeParse({ name: 7 }).success).toBe(false);
  });
});

describe("SetIntegrationRequest", () => {
  it("carries whether the Explorer entries are wanted", () => {
    const parsed = SetIntegrationRequest.safeParse({ enabled: true });

    expect(parsed.success && parsed.data.enabled).toBe(true);
  });

  it("refuses anything but a boolean", () => {
    expect(SetIntegrationRequest.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(SetIntegrationRequest.safeParse({}).success).toBe(false);
  });
});

describe("OpenTargetSchema", () => {
  it("carries a folder, and a document within it", () => {
    const parsed = OpenTargetSchema.safeParse({ root: "D:/Notes", file: "todo.md" });

    expect(parsed.success && parsed.data.file).toBe("todo.md");
  });

  it("carries a folder alone", () => {
    expect(OpenTargetSchema.safeParse({ root: "D:/Notes", file: null }).success).toBe(true);
  });

  // Main is trusted, but the schema is what stops the two sides drifting silently - a shape change
  // would otherwise surface as a launch that quietly opens nothing.
  it("refuses a shape it does not recognise", () => {
    expect(OpenTargetSchema.safeParse({ root: "D:/Notes" }).success).toBe(false);
    expect(OpenTargetSchema.safeParse({ file: "todo.md", root: 7 }).success).toBe(false);
  });
});

/// Save As: the renderer asks for a dialog, and the main process decides where the file may go.
///
/// Note what the renderer does NOT send - a destination. It cannot: the path comes from the native
/// dialog, on the main process's side of the boundary, and is checked against the open workspace
/// there. `path` is only where the dialog starts, so a Save As from a file deep in the tree opens in
/// that folder rather than at the root.
describe("SaveAsRequest", () => {
  it("takes the document being saved and where it currently lives", () => {
    const parsed = SaveAsRequest.safeParse({
      workspaceId: "Notes",
      path: "Notes/notes/plan.md",
      content: "# Plan",
    });
    expect(parsed.success).toBe(true);
  });

  // The scratch buffer has never been anywhere, and Save As is how it gets somewhere.
  it("accepts a document with no path yet", () => {
    expect(
      SaveAsRequest.safeParse({ workspaceId: "Notes", path: null, content: "" }).success,
    ).toBe(true);

    // Which workspace is not optional. A document with no path has no other way of saying, and a
    // Save As that guessed would write into whichever folder happened to be first.
    expect(SaveAsRequest.safeParse({ path: null, content: "" }).success).toBe(false);
  });

  it("has no way to name a destination", () => {
    const parsed = SaveAsRequest.safeParse({
      path: "a.md",
      content: "x",
      target: "C:/Windows/System32/notes.md",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a request with no content, which is not a save", () => {
    expect(SaveAsRequest.safeParse({ path: "a.md" }).success).toBe(false);
  });
});
