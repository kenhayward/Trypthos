"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("@trypthos/domain");
const { registerIpcHandlers } = require("../src/ipcHandlers");
const { writeSettings } = require("../src/settingsStore");

/// The chat channels.
///
/// The property worth protecting here is that the renderer names a PROFILE, not an endpoint - so a
/// renderer cannot point Trypthos at a server of its choosing, and cannot reach a key by naming the
/// endpoint it belongs to.

const PROFILE = {
  id: "one",
  label: "Local model",
  endpoint: "https://api.example.com/v1",
  model: "some-model",
  supportsImages: false,
  isDefault: true,
};

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  };
}

/// Records what reached the renderer, and what the provider was asked to do.
function harness({ run } = {}) {
  const sent = [];
  const runs = [];

  const chat = {
    run:
      run ??
      (async ({ profile, turns, onEvent }) => {
        runs.push({ profile, turns });
        onEvent({ type: "token", text: "Hi" });
        onEvent({ type: "end" });
      }),
  };

  const window = { isDestroyed: () => false, webContents: { send: (channel, message) => sent.push({ channel, message }) } };
  return { sent, runs, chat, window };
}

async function withHandlers(body, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-chat-ipc-"));
  const noise = console.error;
  console.error = () => {};
  try {
    await writeSettings(dir, {
      ...DEFAULT_SETTINGS,
      chat: {
        profiles: options.profiles ?? [PROFILE],
        systemPrompt: options.systemPrompt ?? DEFAULT_SETTINGS.chat.systemPrompt,
      },
    });

    const ipcMain = fakeIpcMain();
    const { sent, runs, chat, window } = harness(options);
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => window,
      userDataDir: dir,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => ({ ok: true }),
        deleteKey: async () => {},
        retainOnly: async () => {},
        getKey: async () => null,
      },
      chat,
    });

    await body({ ipcMain, sent, runs });
  } finally {
    console.error = noise;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const turns = [{ role: "user", content: "Hello" }];
const NO_CONTEXT = { kind: "none" };
const send = (extra = {}) => ({ profileId: "one", turns, context: NO_CONTEXT, ...extra });

test("starts a stream and names it, so replies can be told apart", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const result = await ipcMain.invoke("chat:send", send());

    assert.equal(result.ok, true);
    assert.equal(typeof result.streamId, "string");
    assert.ok(result.streamId.length > 0);
  });
});

test("pushes the reply to the renderer, tagged with its stream", async () => {
  await withHandlers(async ({ ipcMain, sent }) => {
    const { streamId } = await ipcMain.invoke("chat:send", send());

    assert.deepEqual(
      sent.map((entry) => entry.message),
      [
        { streamId, event: { type: "token", text: "Hi" } },
        { streamId, event: { type: "end" } },
      ],
    );
    assert.deepEqual([...new Set(sent.map((entry) => entry.channel))], ["chat:event"]);
  });
});

// The point of naming a profile rather than an endpoint. A renderer that could name its own endpoint
// could point Trypthos at any server on the internet and have it send whatever key was stored there.
test("resolves the profile from settings rather than trusting the renderer", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    await ipcMain.invoke("chat:send", send());

    assert.equal(runs[0].profile.endpoint, "https://api.example.com/v1");
    assert.equal(runs[0].profile.model, "some-model");
  });
});

test("refuses a profile id that is not configured", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    const result = await ipcMain.invoke("chat:send", send({ profileId: "invented" }));

    assert.deepEqual(result, { ok: false, reason: "no-such-profile" });
    assert.equal(runs.length, 0, "an unknown profile must never reach the provider");
  });
});

test("refuses a request that names an endpoint of its own", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    const result = await ipcMain.invoke("chat:send", send({
      endpoint: "https://attacker.example.com/v1",
    }));

    assert.deepEqual(result, { ok: false, reason: "bad-request" });
    assert.equal(runs.length, 0);
  });
});

test("refuses a malformed request before anything is sent", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    for (const payload of [
      null,
      {},
      { profileId: "one" },
      // Context is required, not optional: a missing field would read as "no context" for both a
      // deliberate choice and a renderer that forgot to send it.
      { profileId: "one", turns },
      send({ turns: [] }),
      send({ turns: [{ role: "wizard", content: "Hello" }] }),
      send({ turns: [{ role: "user" }] }),
      send({ context: { kind: "elsewhere", text: "x" } }),
      // Larger than the cap the renderer applies, so it is a bug or a renderer doing as it pleases.
      send({
        context: { kind: "file", path: "big.md", text: "x".repeat(60_001), truncated: false },
      }),
    ]) {
      const result = await ipcMain.invoke("chat:send", payload);
      assert.deepEqual(result, { ok: false, reason: "bad-request" });
    }

    assert.equal(runs.length, 0);
  });
});

test("cancelling a stream stops it", async () => {
  let aborted = false;
  await withHandlers(
    async ({ ipcMain, sent }) => {
      const { streamId } = await ipcMain.invoke("chat:send", send());
      await ipcMain.invoke("chat:cancel", { streamId });

      assert.equal(aborted, true);
      assert.deepEqual(sent.at(-1).message.event, { type: "end" });
    },
    {
      run: async ({ signal, onEvent }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          onEvent({ type: "end" });
        });
        // Left running: the test cancels it.
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
      },
    },
  );
});

test("cancelling a stream that has already finished is harmless", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const { streamId } = await ipcMain.invoke("chat:send", send());
    assert.deepEqual(await ipcMain.invoke("chat:cancel", { streamId }), { ok: true });
  });
});

// The window can be closed while a reply is still arriving. Sending to a destroyed webContents
// throws, and that exception would surface as an unhandled rejection in the main process.
test("a reply arriving after the window has gone is dropped quietly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-chat-ipc-"));
  try {
    await writeSettings(dir, {
      ...DEFAULT_SETTINGS,
      chat: { profiles: [PROFILE], systemPrompt: "" },
    });

    const ipcMain = fakeIpcMain();
    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => null,
      userDataDir: dir,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => ({ ok: true }),
        deleteKey: async () => {},
        retainOnly: async () => {},
        getKey: async () => null,
      },
      chat: {
        run: async ({ onEvent }) => {
          onEvent({ type: "token", text: "Hi" });
          onEvent({ type: "end" });
        },
      },
    });

    assert.equal((await ipcMain.invoke("chat:send", send())).ok, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/// What the model is actually sent.
///
/// The handler composes the request: the system prompt from settings, then the conversation, then
/// the document beside the question it belongs to. None of that is visible from the panel, and all
/// of it decides whether an answer is about the right text.
test("leads with the system prompt from settings", async () => {
  await withHandlers(
    async ({ ipcMain, runs }) => {
      await ipcMain.invoke("chat:send", send());
      assert.deepEqual(runs[0].turns[0], { role: "system", content: "Be brief." });
    },
    { systemPrompt: "Be brief." },
  );
});

test("sends no system message when the prompt has been cleared", async () => {
  await withHandlers(
    async ({ ipcMain, runs }) => {
      await ipcMain.invoke("chat:send", send());
      assert.equal(
        runs[0].turns.some((turn) => turn.role === "system"),
        false,
      );
    },
    { systemPrompt: "" },
  );
});

// The renderer resolved the context; the main process turns it into the message. Keeping the
// wording in one place means the panel cannot drift from what the model is told.
test("puts the document before the question, labelled and fenced", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    await ipcMain.invoke(
      "chat:send",
      send({
        context: { kind: "file", path: "notes/plan.md", text: "# Plan", truncated: false },
      }),
    );

    const sent = runs[0].turns;
    assert.equal(sent.at(-1).content, "Hello", "the question must come last");

    const document = sent.at(-2);
    assert.equal(document.role, "user");
    assert.match(document.content, /notes\/plan\.md/);
    assert.match(document.content, /# Plan/);
    // The rule a markdown file can attack: it is data, and the model is told so.
    assert.match(document.content, /not instructions/i);
  });
});

test("says when the text was a selection rather than the whole file", async () => {
  await withHandlers(async ({ ipcMain, runs }) => {
    await ipcMain.invoke(
      "chat:send",
      send({
        context: { kind: "selection", path: "notes/plan.md", text: "One paragraph", truncated: false },
      }),
    );

    assert.match(runs[0].turns.at(-2).content, /selected/i);
  });
});

test("sends the conversation alone when there is no context", async () => {
  await withHandlers(
    async ({ ipcMain, runs }) => {
      await ipcMain.invoke("chat:send", send());
      assert.deepEqual(runs[0].turns, turns);
    },
    { systemPrompt: "" },
  );
});

/// Saved conversations, over IPC.
///
/// The main process fills in what the renderer must not decide: the id, which becomes a file name,
/// and the workspace root, which the renderer cannot name for the same reason it cannot name one to
/// open.
const conversation = [
  { role: "user", content: "Summarise this document" },
  { role: "assistant", content: "It is a plan." },
];

test("saves a conversation and gives back its id", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const result = await ipcMain.invoke("chats:save", {
      id: null,
      turns: conversation,
      profileId: "one",
      filePath: "plan.md",
    });

    assert.equal(result.ok, true);
    assert.match(result.id, /^[0-9a-f-]{36}$/);
  });
});

// Derived, not asked for. A dialog demanding a name before a chat can be saved is one people learn
// to dismiss.
test("names the chat after the question that started it", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const result = await ipcMain.invoke("chats:save", {
      id: null,
      turns: conversation,
      profileId: null,
      filePath: null,
    });

    assert.equal(result.title, "Summarise this document");
  });
});

test("saving the same chat again replaces it", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const first = await ipcMain.invoke("chats:save", {
      id: null,
      turns: conversation,
      profileId: null,
      filePath: null,
    });
    await ipcMain.invoke("chats:save", {
      id: first.id,
      turns: [...conversation, { role: "user", content: "And again" }],
      profileId: null,
      filePath: null,
    });

    const list = await ipcMain.invoke("chats:list");
    assert.equal(list.chats.length, 1);

    const loaded = await ipcMain.invoke("chats:load", { id: first.id });
    assert.equal(loaded.chat.turns.length, 3);
  });
});

test("lists saved conversations without their contents", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("chats:save", {
      id: null,
      turns: conversation,
      profileId: null,
      filePath: "plan.md",
    });

    const list = await ipcMain.invoke("chats:list");
    assert.equal(list.chats.length, 1);
    assert.equal(list.chats[0].filePath, "plan.md");
    assert.ok(!("turns" in list.chats[0]));
  });
});

test("deletes a conversation", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const saved = await ipcMain.invoke("chats:save", {
      id: null,
      turns: conversation,
      profileId: null,
      filePath: null,
    });

    assert.deepEqual(await ipcMain.invoke("chats:delete", { id: saved.id }), { ok: true });
    assert.deepEqual((await ipcMain.invoke("chats:list")).chats, []);
  });
});

test("a chat that cannot be opened is reported, not replaced with an empty one", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const result = await ipcMain.invoke("chats:load", {
      id: "3f1a1a2e-0000-4000-8000-000000000000",
    });
    assert.deepEqual(result, { ok: false, reason: "not-found" });
  });
});

// The id becomes a file name. The store checks its shape too, but a malformed request should not
// reach it at all.
test("refuses a malformed save or load", async () => {
  await withHandlers(async ({ ipcMain }) => {
    for (const payload of [
      null,
      {},
      { id: null, turns: [], profileId: null, filePath: null },
      { id: null, turns: conversation, profileId: null },
      { id: null, turns: conversation, profileId: null, filePath: null, root: "/etc" },
    ]) {
      assert.deepEqual(await ipcMain.invoke("chats:save", payload), {
        ok: false,
        reason: "bad-request",
      });
    }

    assert.deepEqual(await ipcMain.invoke("chats:load", { id: "" }), {
      ok: false,
      reason: "bad-request",
    });
  });
});

test("an id that could escape the chats directory never reaches the filesystem", async () => {
  await withHandlers(async ({ ipcMain }) => {
    for (const id of ["../settings", "../../etc/passwd", "C:\\Windows\\System32"]) {
      assert.deepEqual(await ipcMain.invoke("chats:delete", { id }), {
        ok: false,
        reason: "bad-id",
      });
      assert.deepEqual(await ipcMain.invoke("chats:load", { id }), {
        ok: false,
        reason: "not-found",
      });
    }
  });
});
