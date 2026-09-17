"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GRAPH_CHANGED_CHANNEL, GRAPH_PROGRESS_CHANNEL } = require("@trypthos/domain");
const { createVaultIndexes } = require("../src/vaultIndex");
const { openWorkspaceFor } = require("../src/providers");

/// A provider over an in-memory tree of `path -> content`, with switches for the failures a disk
/// produces. `hold()` stops every read until the returned release is called, which is how the tests
/// get a build to sit still while something else happens.
function fakeProvider(files, options = {}) {
  const failList = options.failList ?? new Set();
  const failRead = options.failRead ?? new Set();
  const throwRead = options.throwRead ?? new Set();
  let gate = Promise.resolve();
  const reads = [];
  return {
    reads,
    hold() {
      let release;
      gate = new Promise((resolve) => (release = resolve));
      return () => release();
    },
    async list(directory) {
      if (failList.has(directory)) return { ok: false, reason: "not-found" };
      const prefix = directory === "" ? "" : `${directory}/`;
      const children = new Map();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...rest] = file.slice(prefix.length).split("/");
        children.set(name, rest.length > 0 ? "directory" : "file");
      }
      return { ok: true, nodes: [...children].map(([name, kind]) => ({ name, kind, id: `${prefix}${name}` })) };
    },
    async read(file) {
      await gate;
      reads.push(file);
      if (throwRead.has(file)) throw Object.assign(new Error("odd"), { code: "EIO" });
      if (failRead.has(file) || !(file in files)) return { ok: false, reason: "not-found" };
      return { ok: true, content: files[file] };
    },
  };
}

function vault(provider, id = "V") {
  return { id, ref: { kind: "local", root: "/v" }, root: "/v", provider, vault: true };
}

function recorder() {
  const events = [];
  return { events, emit: (channel, payload) => events.push({ channel, payload }) };
}

const NOW = () => new Date("2026-09-17T10:00:00.000Z");

test("builds a snapshot of a vault's notes, links, tags and attachments", async () => {
  const provider = fakeProvider({
    "Home.md": "[[Plan]] #inbox ![[img/diagram.png]] [[Missing]]",
    "Projects/Plan.md": "back to [[Home]]",
    "img/diagram.png": "",
    ".obsidian/app.json": JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "Inbox" }),
    ".trash/Old.md": "[[Home]]",
  });
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });

  indexes.start(vault(provider));
  await indexes.idle("V");

  const { snapshot, building, error } = indexes.state("V");
  assert.equal(building, null);
  assert.equal(error, null);
  assert.equal(snapshot.builtAt, "2026-09-17T10:00:00.000Z");
  assert.deepEqual(snapshot.newNotes, { mode: "folder", folder: "Inbox" });
  const kinds = Object.fromEntries(snapshot.nodes.map((node) => [node.id, node.kind]));
  assert.deepEqual(kinds, {
    "V/Home.md": "note",
    "V/Projects/Plan.md": "note",
    "V/img/diagram.png": "attachment",
    "ghost:missing": "ghost",
    "tag:inbox": "tag",
  });
  assert.ok(snapshot.edges.some((edge) => edge.source === "V/Home.md" && edge.target === "V/Projects/Plan.md" && edge.both));
  assert.ok(!provider.reads.some((file) => file.startsWith(".trash")));
  assert.equal(events.at(-1).channel, GRAPH_CHANGED_CHANNEL);
  assert.deepEqual(events.at(-1).payload, { workspaceId: "V" });
});

test("reports progress in batches, walking first and then reading", async () => {
  const files = Object.fromEntries(["a", "b", "c", "d", "e"].map((name) => [`${name}.md`, ""]));
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW, batchSize: 2 });

  indexes.start(vault(fakeProvider(files)));
  await indexes.idle("V");

  const progress = events.filter((event) => event.channel === GRAPH_PROGRESS_CHANNEL).map((event) => event.payload);
  assert.equal(progress[0].walking, true);
  assert.deepEqual(
    progress.filter((p) => !p.walking).map((p) => p.read),
    [0, 2, 4, 5],
  );
  assert.ok(progress.every((p) => p.workspaceId === "V" && p.read <= p.total));
});

test("skips and counts files it cannot read, including ones whose read throws", async () => {
  const provider = fakeProvider(
    { "A.md": "[[B]]", "B.md": "", "C.md": "" },
    { failRead: new Set(["B.md"]), throwRead: new Set(["C.md"]) },
  );
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });

  indexes.start(vault(provider));
  await indexes.idle("V");

  const { snapshot } = indexes.state("V");
  assert.equal(snapshot.unreadable, 2);
  assert.ok(snapshot.nodes.some((node) => node.id === "V/B.md"));
});

test("says why when the vault root cannot be listed, and keeps the last good graph on a refresh", async () => {
  const failList = new Set();
  const provider = fakeProvider({ "A.md": "" }, { failList });
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  await indexes.idle("V");
  const good = indexes.state("V").snapshot;

  failList.add("");
  assert.deepEqual(indexes.refresh(workspace), { ok: true });
  await indexes.idle("V");

  assert.equal(indexes.state("V").error, "not-found");
  assert.equal(indexes.state("V").snapshot, good);
});

test("refuses a refresh while a build is running", async () => {
  const provider = fakeProvider({ "A.md": "" });
  const release = provider.hold();
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  assert.deepEqual(indexes.refresh(workspace), { ok: false, reason: "building" });
  release();
  await indexes.idle("V");
});

test("stops a build and forgets the vault when it is closed", async () => {
  const provider = fakeProvider({ "A.md": "" });
  const release = provider.hold();
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });

  indexes.start(vault(provider));
  indexes.close("V");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(indexes.state("V"), null);
  assert.ok(!events.some((event) => event.channel === GRAPH_CHANGED_CHANNEL));
});

test("applies a write made during a build once the build finishes", async () => {
  const provider = fakeProvider({ "A.md": "[[Risks]]" });
  const release = provider.hold();
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);

  indexes.start(workspace);
  indexes.written(workspace, "Risks.md", "");
  release();
  await indexes.idle("V");

  const { snapshot } = indexes.state("V");
  assert.ok(snapshot.nodes.some((node) => node.id === "V/Risks.md"));
  assert.ok(!snapshot.nodes.some((node) => node.id === "ghost:risks"));
});

test("updates the graph and says so when a note is written after the build", async () => {
  const { events, emit } = recorder();
  const indexes = createVaultIndexes({ emit, now: NOW });
  const workspace = vault(fakeProvider({ "A.md": "" }));
  indexes.start(workspace);
  await indexes.idle("V");
  events.length = 0;

  indexes.written(workspace, "A.md", "[[B]] #new");

  const { snapshot } = indexes.state("V");
  assert.ok(snapshot.nodes.some((node) => node.id === "ghost:b"));
  assert.ok(snapshot.nodes.some((node) => node.id === "tag:new"));
  assert.deepEqual(events, [{ channel: GRAPH_CHANGED_CHANNEL, payload: { workspaceId: "V" } }]);
});

test("follows a renamed file, and rebuilds for a renamed folder", async () => {
  const files = { "A.md": "[[B]]", "B.md": "", "f/C.md": "" };
  const provider = fakeProvider(files);
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const workspace = vault(provider);
  indexes.start(workspace);
  await indexes.idle("V");

  indexes.renamed(workspace, "B.md", "D.md");
  assert.ok(indexes.state("V").snapshot.nodes.some((node) => node.id === "ghost:b"));

  delete files["f/C.md"];
  files["g/C.md"] = "";
  indexes.renamed(workspace, "f", "g");
  await indexes.idle("V");
  assert.ok(indexes.state("V").snapshot.nodes.some((node) => node.id === "V/g/C.md"));
});

test("does not index a folder that is not a vault, or a repository", async () => {
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  const plain = { ...vault(fakeProvider({ "A.md": "" })), vault: false };
  const repo = { ...vault(fakeProvider({ "A.md": "" }), "R"), ref: { kind: "github" }, root: null };

  indexes.start(plain);
  indexes.start(repo);

  assert.equal(indexes.state("V"), null);
  assert.equal(indexes.state("R"), null);
  assert.deepEqual(indexes.refresh(repo), { ok: false, reason: "unsupported" });
});

test("never puts a note's contents into a snapshot", async () => {
  const marker = "MARKER-7f3a-never-leaves-main";
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  indexes.start(vault(fakeProvider({ "A.md": `${marker} [[B]] #tag` })));
  await indexes.idle("V");

  assert.ok(!JSON.stringify(indexes.state("V")).includes(marker));
});

test("does not follow a junction out of a real vault", async (t) => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-graph-")));
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-outside-")));
  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(base, ".obsidian"));
  await fs.writeFile(path.join(base, "Home.md"), "[[Secret]]");
  await fs.writeFile(path.join(outside, "Secret.md"), "outside");
  try {
    await fs.symlink(outside, path.join(base, "escape"), "junction");
  } catch {
    t.skip("this machine cannot create a junction or symlink");
    return;
  }

  const opened = await openWorkspaceFor({ kind: "local", root: base });
  assert.equal(opened.ok, true);
  const indexes = createVaultIndexes({ emit: () => {}, now: NOW });
  indexes.start({ ...opened.workspace, id: "V" });
  await indexes.idle("V");

  const ids = indexes.state("V").snapshot.nodes.map((node) => node.id);
  assert.ok(ids.includes("ghost:secret"));
  assert.ok(!ids.some((id) => id.includes("escape")));
});
