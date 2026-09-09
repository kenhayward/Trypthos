"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { registerIpcHandlers, tabOpenerFor } = require("../src/ipcHandlers");

/// GitHub through the real handlers.
///
/// What is under test here is the seam rather than the API client: that a token is verified before
/// it is stored, that nothing answers with one, that a repository opens as an ordinary workspace, and
/// that the acts a repository cannot do are refused rather than half-performed.

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  };
}

/// A stand-in account store. Same surface as the real one, in memory.
function fakeAccounts({ available = true } = {}) {
  const tokens = new Map();
  return {
    tokens,
    setToken: async (provider, token) => {
      if (!available) return { ok: false, reason: "encryption-unavailable" };
      tokens.set(provider, token);
      return { ok: true };
    },
    getToken: async (provider) => tokens.get(provider) ?? null,
    hasToken: async (provider) => tokens.has(provider),
    deleteToken: async (provider) => void tokens.delete(provider),
    connectedProviders: async () => [...tokens.keys()],
  };
}

const TREE = [
  { path: "README.md", mode: "100644", type: "blob", sha: "b1", size: 5 },
  { path: "docs", mode: "040000", type: "tree", sha: "t1" },
  { path: "docs/guide.md", mode: "100644", type: "blob", sha: "b2", size: 5 },
];

/// A stand-in GitHub client, built the way the handlers build the real one: over a token supplier,
/// so a test can watch which token a call was made with.
function fakeGitHubFactory({ valid = "ghp_good", repos = [], calls = {} } = {}) {
  calls.repoPages = calls.repoPages ?? 0;

  return (getToken) => ({
    whoami: async () => {
      const token = await getToken();
      if (token !== valid) return { ok: false, reason: "permission-denied" };
      return { ok: true, login: "ada" };
    },
    ownedRepositories: async () => {
      const token = await getToken();
      if (token !== valid) return { ok: false, reason: "permission-denied" };
      calls.repoPages += 1;
      return { ok: true, repos };
    },
    defaultBranchHead: async () => ({ ok: true, branch: "main", sha: "c0ffee" }),
    repoStatistics: async (owner, repo) => ({
      ok: true,
      stats: { fullName: `${owner}/${repo}`, stars: 12, forks: 3, issuesAndPullRequests: 4 },
    }),
    tree: async () => ({ ok: true, entries: TREE, truncated: false }),
    blob: async (_owner, _repo, sha) =>
      sha === "b2" ? { ok: true, bytes: Buffer.from("guide") } : { ok: false, reason: "not-found" },
  });
}

async function withHandlers(body, options = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-github-ipc-"));
  try {
    const ipcMain = fakeIpcMain();
    const accounts = options.accounts ?? fakeAccounts();

    registerIpcHandlers({
      ipcMain,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
      getWindow: () => null,
      userDataDir: userData,
      secrets: {
        endpointsWithKeys: async () => [],
        setKey: async () => ({ ok: true }),
        deleteKey: async () => {},
        retainOnly: async () => {},
      },
      accounts,
      openInWindow: options.openInWindow ?? (() => {}),
      createGitHub: options.createGitHub ?? fakeGitHubFactory(options.github),
      explorerIntegration: { supported: () => false, isRegistered: async () => false },
    });

    await body({ ipcMain, accounts });
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

test("says it is not connected before a token is stored", async () => {
  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("github:status"), {
      ok: true,
      connected: false,
      login: null,
      reason: null,
    });
  });
});

test("connecting stores the token and reports who it belongs to", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    assert.deepEqual(await ipcMain.invoke("github:connect", { token: "ghp_good" }), {
      ok: true,
      login: "ada",
    });
    assert.equal(accounts.tokens.get("github"), "ghp_good");

    const status = await ipcMain.invoke("github:status");
    assert.equal(status.connected, true);
    assert.equal(status.login, "ada");
  });
});

/// The order that matters. A token GitHub rejects must never reach disk: there would be no window in
/// which the app holds a credential it has never been able to use, and the user is told at the moment
/// they paste it rather than the first time they open a repository.
test("a token GitHub rejects is never stored", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    const result = await ipcMain.invoke("github:connect", { token: "ghp_wrong" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission-denied");
    assert.equal(accounts.tokens.size, 0, "nothing should have been written");
  });
});

// The store refuses rather than falling back to plaintext, and the user has to be told their token
// was not saved rather than being shown as connected.
test("a token that could not be encrypted is reported rather than assumed stored", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("github:connect", { token: "ghp_good" }), {
        ok: false,
        reason: "encryption-unavailable",
      });
    },
    { accounts: fakeAccounts({ available: false }) },
  );
});

test("a revoked token reads as disconnected, with the reason", async () => {
  const accounts = fakeAccounts();
  await accounts.setToken("github", "ghp_stale");

  await withHandlers(
    async ({ ipcMain }) => {
      assert.deepEqual(await ipcMain.invoke("github:status"), {
        ok: true,
        connected: false,
        login: null,
        reason: "permission-denied",
      });
    },
    { accounts },
  );
});

test("disconnecting removes the token", async () => {
  await withHandlers(async ({ ipcMain, accounts }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });
    await ipcMain.invoke("github:disconnect");

    assert.equal(accounts.tokens.size, 0);
    assert.equal((await ipcMain.invoke("github:status")).connected, false);
  });
});

test("lists the repositories the account owns", async () => {
  const repos = [
    { owner: "ada", name: "notes", fullName: "ada/notes", private: true, defaultBranch: "main", description: null, pushedAt: null },
  ];

  await withHandlers(
    async ({ ipcMain }) => {
      await ipcMain.invoke("github:connect", { token: "ghp_good" });
      const listed = await ipcMain.invoke("github:repos", { refresh: false });

      assert.equal(listed.ok, true);
      assert.deepEqual(listed.repos, repos);
    },
    { github: { repos } },
  );
});

// Several requests over a connection the user is paying for, and the picker is opened far more often
// than a repository is created.
test("holds the repository list rather than fetching it on every open", async () => {
  const calls = {};
  await withHandlers(
    async ({ ipcMain }) => {
      await ipcMain.invoke("github:connect", { token: "ghp_good" });
      await ipcMain.invoke("github:repos", { refresh: false });
      await ipcMain.invoke("github:repos", { refresh: false });
      assert.equal(calls.repoPages, 1);

      await ipcMain.invoke("github:repos", { refresh: true });
      assert.equal(calls.repoPages, 2, "refresh must actually go back to GitHub");
    },
    { github: { calls } },
  );
});

// Keeping it would let a picker opened after signing out show the repositories of an account the app
// can no longer reach.
test("the held list goes when the account does", async () => {
  const calls = {};
  await withHandlers(
    async ({ ipcMain }) => {
      await ipcMain.invoke("github:connect", { token: "ghp_good" });
      await ipcMain.invoke("github:repos", { refresh: false });
      await ipcMain.invoke("github:disconnect");
      await ipcMain.invoke("github:connect", { token: "ghp_good" });
      await ipcMain.invoke("github:repos", { refresh: false });

      assert.equal(calls.repoPages, 2);
    },
    { github: { calls } },
  );
});

/// A repository, once open, is an ordinary workspace.
///
/// Everything below here goes through the same channels a local folder does, with the same qualified
/// paths - which is the whole reason the tree, the filter box and the editor needed no changes.
test("opens a repository as a workspace and browses it like any other", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });

    const opened = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "github", owner: "ada", repo: "notes" },
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.workspace.name, "notes");
    // The reference says which provider answers and which repository it is - and, by having no
    // root at all, that there is no folder on disk to save into.
    assert.deepEqual(opened.workspace.ref, { kind: "github", owner: "ada", repo: "notes" });

    const listed = await ipcMain.invoke("workspace:list", { path: opened.workspace.id });
    assert.deepEqual(
      listed.nodes.map((node) => node.id),
      [`${opened.workspace.id}/README.md`, `${opened.workspace.id}/docs`],
    );

    const read = await ipcMain.invoke("file:read", { path: `${opened.workspace.id}/docs/guide.md` });
    assert.equal(read.content, "guide");
  });
});

test("opening the same repository twice is one workspace", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });

    const ref = { kind: "github", owner: "ada", repo: "notes" };
    const one = await ipcMain.invoke("workspace:openRef", { ref });
    // Spelled differently, and the same repository: GitHub folds case for an owner and a name.
    const two = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "github", owner: "Ada", repo: "Notes" },
    });

    assert.equal(one.workspace.id, two.workspace.id);
  });
});

// A repository has nowhere for a save dialog to open and nowhere for the file to land. Refused
// before a dialog appears: offering one and then declining what the user chose would ask a question
// whose every answer is no.
test("refuses Save As into a repository rather than opening a dialog", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });
    const opened = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "github", owner: "ada", repo: "notes" },
    });

    assert.deepEqual(
      await ipcMain.invoke("file:saveAs", {
        workspaceId: opened.workspace.id,
        path: null,
        content: "hello",
      }),
      { ok: false, reason: "unsupported" },
    );
  });
});

/// The refusal that matters most.
///
/// Writing to GitHub is a commit on a branch, and until the user has said WHICH branch there is no
/// answer to where a save goes. What must never happen is the editor reporting a save it did not
/// make - so the channel answers honestly rather than committing somewhere nobody chose.
test("refuses a write to a repository until a branch has been chosen", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });
    const opened = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "github", owner: "ada", repo: "notes" },
    });

    const written = await ipcMain.invoke("file:write", {
      path: `${opened.workspace.id}/README.md`,
      content: "changed",
      expectedRevision: { id: "b1" },
      message: null,
    });

    assert.equal(written.ok, false);
    assert.equal(written.reason, "no-branch");
  });
});

/// The security property, asserted rather than assumed.
///
/// No channel answers with the token. This walks every handler the shell registered and checks that
/// nothing anywhere in what comes back is the stored token - the same guard the chat keys have.
test("no channel answers with the stored token", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });

    for (const [channel, handler] of ipcMain.handlers) {
      let answer;
      try {
        answer = await handler(null, {});
      } catch {
        continue; // A handler refusing a payload it cannot read has answered with nothing at all.
      }

      assert.ok(
        !JSON.stringify(answer ?? null).includes("ghp_good"),
        `${channel} answered with the stored token`,
      );
    }
  });
});

/// Truncation reaches the interface, rather than stopping at the provider.
///
/// GitHub cuts a very large tree short. The browser has to be able to say so, and it can only say
/// what it is told - so the fact travels with the workspace rather than staying in the shell.
test("tells the renderer when a repository could not be listed in full", async () => {
  await withHandlers(
    async ({ ipcMain }) => {
      await ipcMain.invoke("github:connect", { token: "ghp_good" });
      // A repository no other test in this file has opened. The registry of open workspaces is
      // module state, so a name already opened would answer with the workspace it is already open
      // as - which is right in the app and a false pass here.
      const opened = await ipcMain.invoke("workspace:openRef", {
        ref: { kind: "github", owner: "ada", repo: "enormous" },
      });

      assert.equal(opened.workspace.truncated, true);
    },
    {
      createGitHub: () => ({
        whoami: async () => ({ ok: true, login: "ada" }),
        ownedRepositories: async () => ({ ok: true, repos: [] }),
        defaultBranchHead: async () => ({ ok: true, branch: "main", sha: "c0ffee" }),
    repoStatistics: async (owner, repo) => ({
      ok: true,
      stats: { fullName: `${owner}/${repo}`, stars: 12, forks: 3, issuesAndPullRequests: 4 },
    }),
        tree: async () => ({ ok: true, entries: TREE, truncated: true }),
        blob: async () => ({ ok: false, reason: "not-found" }),
      }),
    },
  );
});

// A local folder is listed one folder at a time and is never truncated, so it must not be reported
// as though it might be.
test("a local folder is never reported as cut short", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-github-local-"));
    try {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "local", root: dir } });
      assert.equal(opened.workspace.truncated, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

/// The one act that assumed every workspace has a folder on disk.
///
/// Chat's folder tools can open a file they found, down the channel a launch from File Explorer
/// uses - which names a file by its ROOT. A repository has not got one, and sending null would fail
/// the schema on arrival and reach the user as a file that could not be found. The runner already
/// refuses the tool when it has no way to open a tab, so that is what it is given.
test("gives the model no way to open a tab it could not address", () => {
  const opens = [];
  const openInWindow = (target) => opens.push(target);

  // A folder on disk: the tool works, and names the file by its root.
  const local = tabOpenerFor({ root: "D:/Notes" }, openInWindow);
  assert.equal(typeof local, "function");
  local("plan.md");
  assert.deepEqual(opens, [{ root: "D:/Notes", file: "plan.md" }]);

  // A repository: null, which is what makes the runner refuse rather than send a root that is not
  // there. `folderToolRunner.test.js` covers the refusal itself.
  assert.equal(tabOpenerFor({ root: null }, openInWindow), null);
  assert.equal(opens.length, 1, "nothing more should have reached the window");
});

/// Which network stack the GitHub calls go over.
///
/// Node's `fetch` in the main process knows nothing about the machine's proxy settings or its
/// certificate store; Electron's `net.fetch` uses Chromium's networking stack, which knows both.
/// Behind a corporate proxy or a VPN that is the difference between a request that answers and one
/// that hangs - and a hung request is what left the picker spinning with nothing to say.
///
/// Asserted against `main.js` because that is the only place the two are joined, and nothing else
/// can see it: the API client takes whatever fetch it is handed, and every test hands it a fake.
test("the shell makes its GitHub requests through Electron's network stack", () => {
  const main = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "main.js"),
    "utf8",
  );

  assert.match(main, /\bnet\b[\s\S]*?= require\("electron"\)/, "main must import net from electron");
  assert.match(
    main,
    /createGitHubApi\(\{[^}]*fetch:[^}]*net\.fetch/,
    "createGitHubApi must be given net.fetch",
  );
});

/// The repository page's statistics.
test("answers with the statistics for an open repository", async () => {
  await withHandlers(async ({ ipcMain }) => {
    await ipcMain.invoke("github:connect", { token: "ghp_good" });
    const opened = await ipcMain.invoke("workspace:openRef", {
      ref: { kind: "github", owner: "ada", repo: "statsrepo" },
    });

    const info = await ipcMain.invoke("github:repoInfo", { workspaceId: opened.workspace.id });
    assert.equal(info.ok, true);
    assert.equal(info.stats.fullName, "ada/statsrepo");
    assert.equal(info.stats.stars, 12);
  });
});

// A local folder has no repository behind it. Refused rather than answered with empty numbers,
// which would read as a repository with nothing in it.
test("refuses statistics for a folder that is not a repository", async () => {
  await withHandlers(async ({ ipcMain }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trypthos-stats-local-"));
    try {
      const opened = await ipcMain.invoke("workspace:openRef", { ref: { kind: "local", root: dir } });
      assert.deepEqual(await ipcMain.invoke("github:repoInfo", { workspaceId: opened.workspace.id }), {
        ok: false,
        reason: "unsupported",
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// The renderer names a workspace id, which is a thing this side made up - and one it has closed, or
// never minted, names nothing.
test("refuses statistics for a workspace that is not open", async () => {
  await withHandlers(async ({ ipcMain }) => {
    assert.deepEqual(await ipcMain.invoke("github:repoInfo", { workspaceId: "never-opened" }), {
      ok: false,
      reason: "no-workspace",
    });
  });
});
