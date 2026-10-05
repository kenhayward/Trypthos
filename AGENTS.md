# AGENTS.md

Operational notes for AI coding agents working in this repository. Project guidance, architecture
and conventions live in [CLAUDE.md](./CLAUDE.md) - read that first; this file records environment-
specific gotchas that CLAUDE.md cannot anticipate because they depend on the tooling an agent runs
in.

## Line endings: mixed in git, normalized by the editor tool

**The problem.** Committed files have MIXED line endings within a single file (for example
`apps/app/src/components/EditorPanel.test.tsx` on main is 109 CRLF lines plus 866 bare-LF lines).
There is no `.gitattributes`, and dev machines run with `core.autocrlf=true`. The DSH edit tool
rewrites a whole file as ALL BARE LF when it saves (verified by probe: a trivial one-line edit to
the 109-CRLF file above left 0 CRs). So after any edit, every line that was previously CRLF differs
from HEAD only by its trailing `\r` - hundreds of phantom diff pairs per file.

**Staging behavior (empirically verified on this repo):**

- `git add` of a NEW path normalizes the content to all-LF.
- `git add` of an EXISTING tracked path preserves the worktree bytes when their ending style matches
  what is already in the index, and otherwise normalizes to LF. So staging from "index = base blob
  (mixed) + worktree = mixed" preserves everything - that is how a clean commit gets made.
- Consequence: committing right after an edit-tool pass either ships phantom pairs or silently re-
  normalizes whole files to all-LF, depending on index state. Neither is acceptable for reviewable
  diffs.

**The fix: repair against the BASE branch before staging.** After ALL edits are done and BEFORE
`git add`, run a one-shot script that, for every file in `git diff --name-only`:

1. Reads the base blob - ALWAYS `git show main:<file>`, never HEAD. On a feature branch with commits
   already made, HEAD contains your own commit; repairing against it is a no-op that preserves the
   churn (this exact mistake was hit and cost an extra amend cycle).
2. Splits both versions into lines keeping their endings, compares normalized content (ALL trailing
   `\r` stripped - a line may carry doubled ones from an earlier broken pass) with an LCS diff.
3. Emits unchanged lines as the base's EXACT bytes (original ending); emits new/changed lines with
   CRLF - the dominant ending in these files.

Then verify before committing: `git diff --stat` shows only real changes, and spot-check CR counts -
a staged blob should have exactly (base CRs + your new CRLF lines). A quick check:

```powershell
node -e "const{execSync}=require('child_process');for(const f of process.argv.slice(1)){const a=(execSync('git show main:'+f).toString().match(/\r/g)||[]).length;const b=(execSync('git cat-file -p :'+f).toString().match(/\r/g)||[]).length;console.log(f,'base:',a,'staged:',b)}" <file...>
```

**Workflow to avoid hitting this:**

1. Do all file edits first (edit tool, writes, scripts) - including any post-test fixes.
2. Run the repair script ONCE as the last step before `git add`. It is throwaway: delete it after,
   and never commit it.
3. If you must edit a file AFTER repairing: that file goes back to all-LF, and the next staging may
   normalize it (index style mismatch). Recover with
   `git restore --staged --worktree --source=main <file>`, re-apply your change as CRLF lines spliced
   into main's exact bytes, re-stage, and verify CR counts before committing.

**The repair script.** Save as `.fix-eol.mjs` (dot-prefixed so it stays out of the diff), run
`node .fix-eol.mjs [base-ref]` (default `main`), delete when done:

```js
// One-shot line-ending repair: restore the base branch's exact line endings on every line that was
// not semantically changed, so the working diff contains only real content changes. New/changed
// lines keep CRLF, the dominant ending in this repo's files. Run once before staging, then delete.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "main";

// Strips ALL trailing \r: a line may carry doubled ones from an earlier broken pass.
const norm = (line) => line.replace(/\r+$/, "");

function lcsDiff(a, b) {
  // Returns ops: {type:"keep",a} | {type:"del",a} | {type:"ins",b}
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "keep", a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", a: i });
      i++;
    } else {
      ops.push({ type: "ins", b: j });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", a: i++ });
  while (j < m) ops.push({ type: "ins", b: j++ });
  return ops;
}

function splitLines(s) {
  // Lines WITHOUT endings, plus the ending of each. `text` may carry a trailing \r that belongs to
  // the ending; norm() removes it before comparison or output.
  const lines = [];
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\n") {
      lines.push({ text: s.slice(start, k), end: s[k - 1] === "\r" ? "\r\n" : "\n" });
      start = k + 1;
    }
  }
  if (start < s.length) lines.push({ text: s.slice(start), end: "" });
  return lines;
}

const files = execSync("git diff --name-only", { maxBuffer: 1024 * 1024 * 50 })
  .toString()
  .trim()
  .split("\n");

for (const file of files) {
  const baseRaw = execSync(`git show ${base}:${file}`, { maxBuffer: 1024 * 1024 * 50 }).toString();
  const curRaw = readFileSync(file, "utf8");
  const baseLines = splitLines(baseRaw);
  const curLines = splitLines(curRaw);
  const ops = lcsDiff(
    baseLines.map((l) => norm(l.text)),
    curLines.map((l) => norm(l.text)),
  );

  let out = "";
  let restored = 0;
  for (const op of ops) {
    if (op.type === "keep") {
      // Unchanged line: the base's exact bytes, ending included.
      out += norm(baseLines[op.a].text) + baseLines[op.a].end;
      restored++;
    } else if (op.type === "ins") {
      // New or changed line: CRLF, the dominant ending in this repo's files.
      const l = curLines[op.b];
      out += norm(l.text) + (l.end === "" ? "" : "\r\n");
    }
    // del: dropped entirely.
  }

  writeFileSync(file, out);
  console.log(`${file}: kept ${restored} ${base} lines byte-exact`);
}
```

**Related gotchas hit while working this:**

- PowerShell `>` redirects write UTF-16 - never use them for byte-level file work; use node
  one-liners or the editor tools.
- The DSH edit tool refuses to edit a file changed since it was last read (for example by your own
  repair script) - re-read, then retry.
- `git diff --stat` on the WORKTREE is not proof of what will be committed: staging can still
  normalize. Verify against the staged blob (`git cat-file -p :<file>`) after `git add`.
