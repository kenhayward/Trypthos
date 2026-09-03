"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CHAT_SESSION_VERSION } = require("@trypthos/domain");
const { chatsDir, deleteSession, listSessions, loadSession, saveSession } = require("../src/chatStore");

/// Saved conversations on disk.
///
/// The part worth guarding: **a chat's id becomes a file name**, and the id arrives from the
/// renderer. An id that could escape the chats directory would be a way to read or overwrite any
/// file the user can - so it is validated as a UUID before anything touches the filesystem.

const ID = "3f1a1a2e-0000-4000-8000-000000000000";

const session = (over = {}) => ({
  schemaVersion: CHAT_SESSION_VERSION,
  id: ID,
  title: "About the plan",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:05:00.000Z",
  workspaceRoot: "D:/Notes",
  filePath: "plan.md",
  profileId: "local",
  turns: [{ role: "user", content: "Summarise this" }],
  ...over,
});

async function withDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-chats-"));
  const noise = console.error;
  console.error = () => {};
  try {
    await body(dir);
  } finally {
    console.error = noise;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("a saved conversation can be read back", async () => {
  await withDir(async (dir) => {
    assert.deepEqual(await saveSession(dir, session()), { ok: true });
    assert.deepEqual((await loadSession(dir, ID)).turns, session().turns);
  });
});

test("saving writes one plain, readable file per chat", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());

    const files = await fs.readdir(chatsDir(dir));
    assert.deepEqual(files, [`${ID}.json`]);

    // Inspectable and greppable is the point of this format, so it is pretty-printed.
    const raw = await fs.readFile(path.join(chatsDir(dir), `${ID}.json`), "utf8");
    assert.ok(raw.includes('\n  "title": "About the plan"'));
  });
});

test("saving the same chat again replaces it rather than piling up", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());
    await saveSession(dir, session({ title: "Renamed" }));

    assert.equal((await listSessions(dir)).length, 1);
    assert.equal((await loadSession(dir, ID)).title, "Renamed");
  });
});

test("the list shows the newest first, with no conversations in it", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session({ id: ID, updatedAt: "2026-09-01T10:00:00.000Z" }));
    await saveSession(
      dir,
      session({ id: "11111111-0000-4000-8000-000000000000", updatedAt: "2026-09-03T10:00:00.000Z" }),
    );

    const list = await listSessions(dir);
    assert.deepEqual(
      list.map((entry) => entry.updatedAt),
      ["2026-09-03T10:00:00.000Z", "2026-09-01T10:00:00.000Z"],
    );
    assert.ok(!("turns" in list[0]), "the list must not carry the conversations");
  });
});

test("the list is empty before anything has been saved", async () => {
  await withDir(async (dir) => {
    assert.deepEqual(await listSessions(dir), []);
  });
});

test("a deleted conversation is gone", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());
    await deleteSession(dir, ID);

    assert.deepEqual(await listSessions(dir), []);
    assert.equal(await loadSession(dir, ID), null);
  });
});

test("deleting a conversation that is not there is not an error", async () => {
  await withDir(async (dir) => {
    assert.deepEqual(await deleteSession(dir, ID), { ok: true });
  });
});

/// The guard. A chat id becomes a file name, and the id comes from the renderer.
test("an id that could escape the chats directory is refused", async () => {
  await withDir(async (dir) => {
    const outside = path.join(dir, "settings.json");
    await fs.writeFile(outside, '{"secret":true}', "utf8");

    for (const id of [
      "../settings",
      "..\\settings",
      "../../etc/passwd",
      "/etc/passwd",
      "C:\\Windows\\System32\\config",
      "chat/../../settings",
      "",
      ".",
      "..",
    ]) {
      assert.deepEqual(await saveSession(dir, session({ id })), { ok: false, reason: "bad-id" });
      assert.equal(await loadSession(dir, id), null);
      assert.deepEqual(await deleteSession(dir, id), { ok: false, reason: "bad-id" });
    }

    // Nothing outside the chats directory was touched.
    assert.equal(await fs.readFile(outside, "utf8"), '{"secret":true}');
  });
});

test("an id that is merely not a UUID is refused too", async () => {
  await withDir(async (dir) => {
    // Not dangerous, but the guard is a shape check rather than a search for dangerous characters -
    // which is the version that stays correct as new ones are invented.
    assert.deepEqual(await saveSession(dir, session({ id: "my-chat" })), {
      ok: false,
      reason: "bad-id",
    });
  });
});

test("a conversation that is not a valid session is not written", async () => {
  await withDir(async (dir) => {
    const result = await saveSession(dir, session({ turns: [] }));
    assert.deepEqual(result, { ok: false, reason: "bad-session" });
    assert.deepEqual(await listSessions(dir), []);
  });
});

// The user's own words. An unreadable file is reported, never replaced with an empty conversation
// that would look exactly like one that had been lost.
test("a corrupt chat file reads as missing rather than as empty", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());
    await fs.writeFile(path.join(chatsDir(dir), `${ID}.json`), "{ not json", "utf8");

    assert.equal(await loadSession(dir, ID), null);
  });
});

test("a corrupt file does not stop the rest of the list being read", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());
    await saveSession(dir, session({ id: "11111111-0000-4000-8000-000000000000" }));
    await fs.writeFile(path.join(chatsDir(dir), `${ID}.json`), "{ not json", "utf8");

    const list = await listSessions(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "11111111-0000-4000-8000-000000000000");
  });
});

test("anything that is not a chat file is ignored", async () => {
  await withDir(async (dir) => {
    await saveSession(dir, session());
    await fs.writeFile(path.join(chatsDir(dir), "notes.txt"), "hello", "utf8");
    await fs.mkdir(path.join(chatsDir(dir), "a-directory.json"), { recursive: true });

    assert.equal((await listSessions(dir)).length, 1);
  });
});
