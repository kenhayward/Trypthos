import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { branchNameFor, commitMessageFor, isValidBranchName } from "@trypthos/domain";
import type { CommitChoice } from "../hooks/useWorkspace";
import type { WorkspaceClient } from "../lib/workspaceClient";

interface Props {
  /// The repository being committed to, and the file being saved.
  workspaceId: string;
  fileName: string;
  /// Reads the branches. The dialog asks when it opens rather than the app asking at startup, so
  /// nothing is spent on somebody who never saves to a repository.
  client: WorkspaceClient;
  onCancel: () => void;
  onCommit: (choice: CommitChoice) => void;
}

/// Where a repository's commits go, asked once.
///
/// **The questions belong to the branch, not to the save.** This opens on the FIRST save in a
/// repository and never again for it: a document is saved every couple of minutes, and a dialog on
/// each one would be asking a question whose answer has not changed.
///
/// A new branch is the default because committing to the default branch by default is how somebody
/// pushes to main without meaning to - and because a protected `main` refuses the commit anyway,
/// which is a worse way to find out.
export default function CommitDialog({ workspaceId, fileName, client, onCancel, onCommit }: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(true);
  const [branch, setBranch] = useState(() => branchNameFor(fileName));
  const [message, setMessage] = useState(() => commitMessageFor(fileName, { creating: false }));
  const [existing, setExisting] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // The branch list is a convenience, not a requirement: a repository whose branches could not be
  // listed can still have one cut, which is the default anyway. So a failure here quietly leaves
  // the second option with nothing in it rather than taking the dialog down.
  useEffect(() => {
    let live = true;
    void (async () => {
      const listed = await client.repoBranches(workspaceId);
      if (!live || !listed.ok) return;
      setExisting(listed.branches);
      setChosen((prev) => prev ?? listed.readingBranch);
    })();
    return () => {
      live = false;
    };
  }, [client, workspaceId]);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const named = creating ? branch.trim() : (chosen ?? "");
  /// What is wrong with what has been typed, or null.
  ///
  /// Checked HERE rather than left to the API: a name git refuses comes back as a 422, which reads
  /// as "that branch already exists", and the user would be told the wrong thing about the right
  /// mistake.
  const problem =
    named === ""
      ? "empty"
      : creating && !isValidBranchName(named)
        ? "invalid"
        : message.trim() === ""
          ? "no-message"
          : null;

  const commit = () => {
    if (problem !== null) return;
    onCommit({ branch: named, create: creating, message: message.trim() });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("commit.title")}
      // Flex, never `grid place-items-center` - see `OpenRepoDialog` for the whole of why. A grid's
      // implicit row is sized to unclipped content, which draws a tall panel off the bottom of the
      // window while this backdrop still covers it.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-[26rem] flex-col overflow-auto rounded-lg border border-rule bg-app p-4 shadow-popup">
        <h2 className="text-base font-semibold text-ink">{t("commit.title")}</h2>
        <p className="mt-1 text-xs text-ink-4">{t("commit.blurb", { name: fileName })}</p>

        <fieldset className="mt-3">
          <legend className="text-2xs tracking-[0.06em] text-ink-4 uppercase">
            {t("commit.commitTo")}
          </legend>

          <label className="mt-1.5 flex items-center gap-2 text-sm text-ink-2">
            <input
              type="radio"
              name="commit-branch"
              checked={creating}
              onChange={() => setCreating(true)}
            />
            {t("commit.newBranch")}
          </label>
          <input
            ref={field}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            onFocus={() => setCreating(true)}
            aria-label={t("commit.branchName")}
            className="mt-1 ml-6 w-[calc(100%-1.5rem)] rounded border border-rule bg-panel px-2 py-1 text-sm text-ink"
          />

          <label className="mt-2.5 flex items-center gap-2 text-sm text-ink-2">
            <input
              type="radio"
              name="commit-branch"
              checked={!creating}
              onChange={() => setCreating(false)}
              // Nothing to move to. A radio that selects an empty list would be a choice with no
              // answers behind it.
              disabled={existing.length === 0}
            />
            {t("commit.existingBranch")}
          </label>
          <select
            value={chosen ?? ""}
            onChange={(event) => {
              setChosen(event.target.value);
              setCreating(false);
            }}
            disabled={existing.length === 0}
            // Its own label, not the radio's: two controls answering to one name is a picker a
            // screen reader cannot tell from the button beside it.
            aria-label={t("commit.chooseBranch")}
            className="mt-1 ml-6 w-[calc(100%-1.5rem)] rounded border border-rule bg-panel px-2 py-1 text-sm text-ink disabled:opacity-50"
          >
            {existing.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </fieldset>

        <label className="mt-3 block text-2xs tracking-[0.06em] text-ink-4 uppercase">
          {t("commit.message")}
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-1 w-full rounded border border-rule bg-panel px-2 py-1 text-sm normal-case text-ink"
          />
        </label>

        {/* Said as it is typed rather than after Commit is pressed, so the name is corrected in the
            box it was typed in rather than in an error banner after a request that failed. */}
        {problem === "invalid" && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {t("commit.invalidBranch")}
          </p>
        )}

        <p className="mt-3 text-xs text-ink-4">{t("commit.note")}</p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-rule px-3 py-1 text-sm text-ink-2 hover:bg-hover"
          >
            {t("commit.cancel")}
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={problem !== null}
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("commit.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}
