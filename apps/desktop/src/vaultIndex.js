"use strict";

const {
  EMPTY_INDEX,
  GRAPH_CHANGED_CHANNEL,
  GRAPH_PROGRESS_CHANNEL,
  OBSIDIAN_APP_CONFIG,
  applyIndexChange,
  buildGraph,
  extractReferences,
  isHidden,
  isNotePath,
  newNoteLocationFrom,
  qualifyPath,
  sortNodes,
} = require("@trypthos/domain");

/// The vault graph's index: one per open local vault, held here in the main process.
///
/// **Every read goes through the workspace's provider**, so the boundary guard - including its
/// realpath check - applies to the index exactly as it does to the tree. Nothing here touches `fs`.
///
/// **Note contents never leave this module.** A note is read, its references extracted, and the text
/// dropped; a snapshot is names, paths and pairs of ids.
///
/// **Batched, and yielding between batches.** The main process also runs every window's events, so a
/// vault of thousands of notes is read 32 at a time with a turn of the event loop between batches.

const READ_BATCH = 32;
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function settled(call) {
  try {
    return await call();
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function parsedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createVaultIndexes({ emit, now = () => new Date(), batchSize = READ_BATCH }) {
  const entries = new Map();

  const isIndexable = (workspace) =>
    workspace.vault === true && workspace.ref?.kind === "local" && typeof workspace.root === "string";

  function publish(entry) {
    entry.snapshot = {
      workspaceId: entry.workspace.id,
      builtAt: now().toISOString(),
      unreadable: entry.unreadable,
      newNotes: entry.newNotes,
      ...buildGraph(entry.input),
    };
  }

  // Guarded: this fires after a build has already succeeded or failed, so a broken listener (a send
  // to a destroyed window, say) must not turn a finished build into an unhandled rejection.
  const changed = (entry) => {
    try {
      emit(GRAPH_CHANGED_CHANNEL, { workspaceId: entry.workspace.id });
    } catch {
      // Notifying is best-effort; the index itself is already consistent.
    }
  };
  const progress = (entry, building) => {
    entry.building = building;
    emit(GRAPH_PROGRESS_CHANNEL, building);
  };

  async function build(entry) {
    const token = Symbol("build");
    entry.token = token;
    const id = entry.workspace.id;
    const { provider } = entry.workspace;
    const alive = () => entry.token === token && entries.get(id) === entry;

    entry.error = null;
    progress(entry, { workspaceId: id, read: 0, total: 0, walking: true });

    const files = [];
    let unreadable = 0;
    let queue = [""];
    while (queue.length > 0) {
      const next = [];
      for (const directory of queue) {
        const listed = await settled(() => provider.list(directory));
        if (!alive()) return;
        if (!listed.ok) {
          if (directory === "") {
            entry.building = null;
            entry.error = listed.reason ?? "not-found";
            // A change queued while this build was running has nowhere to land now - the walk it
            // was waiting on never finished. Apply it to the last good graph instead of leaving it
            // queued, or the next successful build would replay it on top of whatever happened
            // meanwhile. A queued "rebuild" is dropped rather than retried: the walk just failed.
            const queued = entry.pending.splice(0);
            let applied = false;
            let input = entry.input;
            for (const change of queued) {
              if (change === "rebuild") continue;
              input = applyIndexChange(input, change);
              applied = true;
            }
            if (entry.snapshot !== null && applied) {
              entry.input = input;
              publish(entry);
            }
            changed(entry);
            return;
          }
          unreadable += 1;
          continue;
        }
        for (const node of sortNodes(listed.nodes)) {
          if (isHidden(node.name)) continue;
          if (node.kind === "directory") next.push(node.id);
          else files.push(node.id);
        }
      }
      queue = next;
      progress(entry, { workspaceId: id, read: 0, total: files.filter(isNotePath).length, walking: queue.length > 0 });
      await nextTurn();
      if (!alive()) return;
    }

    const notes = files.filter(isNotePath);
    const references = new Map();
    for (let start = 0; start < notes.length; start += batchSize) {
      const batch = notes.slice(start, start + batchSize);
      const results = await Promise.all(batch.map((file) => settled(() => provider.read(file))));
      if (!alive()) return;
      results.forEach((result, index) => {
        if (result.ok) references.set(qualifyPath(id, batch[index]), extractReferences(result.content));
        else unreadable += 1;
      });
      progress(entry, { workspaceId: id, read: start + batch.length, total: notes.length, walking: false });
      await nextTurn();
      if (!alive()) return;
    }

    const config = await settled(() => provider.read(OBSIDIAN_APP_CONFIG));
    if (!alive()) return;
    entry.newNotes = newNoteLocationFrom(config.ok ? parsedJson(config.content) : null);

    let input = { files: files.map((file) => qualifyPath(id, file)), references };
    let rebuild = false;
    for (const change of entry.pending.splice(0)) {
      if (change === "rebuild") rebuild = true;
      else input = applyIndexChange(input, change);
    }
    entry.input = input;
    entry.unreadable = unreadable;
    entry.building = null;
    publish(entry);
    changed(entry);
    if (rebuild) run(entry);
  }

  // `entry.running` must never reject: `idle()` awaits it directly, and a rejection there would be
  // an unhandled one the first time nothing happens to be awaiting it. A build can throw from
  // several places outside this module's control - a send to a destroyed window, or a domain
  // function handed a shape it does not expect - and all of them land here the same way.
  function run(entry) {
    entry.running = build(entry).catch(() => {
      if (entries.get(entry.workspace.id) !== entry) return; // Closed (or replaced) meanwhile.
      entry.building = null;
      entry.error = "unreadable";
      entry.pending = [];
      changed(entry);
    });
  }

  function apply(workspace, change) {
    const entry = entries.get(workspace.id);
    if (entry === undefined) return;
    if (entry.building !== null) {
      entry.pending.push(change);
      return;
    }
    if (entry.snapshot === null) return;
    entry.input = applyIndexChange(entry.input, change);
    publish(entry);
    changed(entry);
  }

  return {
    isIndexable,

    start(workspace) {
      if (!isIndexable(workspace) || entries.has(workspace.id)) return;
      const entry = {
        workspace,
        input: EMPTY_INDEX,
        snapshot: null,
        building: null,
        error: null,
        pending: [],
        token: null,
        running: Promise.resolve(),
        newNotes: { mode: "root" },
        unreadable: 0,
      };
      entries.set(workspace.id, entry);
      run(entry);
    },

    refresh(workspace) {
      if (!isIndexable(workspace)) return { ok: false, reason: "unsupported" };
      const entry = entries.get(workspace.id);
      if (entry === undefined) {
        this.start(workspace);
        return { ok: true };
      }
      if (entry.building !== null) return { ok: false, reason: "building" };
      run(entry);
      return { ok: true };
    },

    close(workspaceId) {
      entries.delete(workspaceId);
    },

    state(workspaceId) {
      const entry = entries.get(workspaceId);
      if (entry === undefined) return null;
      return { snapshot: entry.snapshot, building: entry.building, error: entry.error };
    },

    written(workspace, relativePath, content) {
      const file = qualifyPath(workspace.id, relativePath);
      apply(workspace, {
        kind: "written",
        path: file,
        references: isNotePath(file) ? extractReferences(content) : null,
      });
    },

    renamed(workspace, fromRelative, toRelative) {
      const entry = entries.get(workspace.id);
      if (entry === undefined) return;
      if (entry.building !== null) {
        entry.pending.push("rebuild");
        return;
      }
      const from = qualifyPath(workspace.id, fromRelative);
      if (entry.input.files.includes(from)) {
        apply(workspace, { kind: "renamed", from, to: qualifyPath(workspace.id, toRelative) });
      } else if (entry.input.files.some((file) => file.startsWith(`${from}/`))) {
        run(entry);
      }
    },

    async idle(workspaceId) {
      for (;;) {
        const entry = entries.get(workspaceId);
        if (entry === undefined || entry.building === null) return;
        await entry.running;
      }
    },
  };
}

module.exports = { createVaultIndexes };
