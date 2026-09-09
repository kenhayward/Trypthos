import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommitDialog from "./CommitDialog";
import type { WorkspaceClient } from "../lib/workspaceClient";

/// Where a repository's commits go, asked once.
///
/// The rule under test throughout: this is the FIRST save in a repository and never again for it,
/// so it has to ask enough to be worth asking - and it has to default to something safe, because
/// most people will press Commit without reading it.

function draw(overrides: Partial<WorkspaceClient> = {}, fileName = "README.md") {
  const onCancel = vi.fn();
  const onCommit = vi.fn();
  const client = {
    repoBranches: vi.fn(async () => ({
      ok: true as const,
      branches: ["main", "trunk"],
      branch: null,
      readingBranch: "main",
    })),
    ...overrides,
  } as unknown as WorkspaceClient;

  render(
    <CommitDialog
      workspaceId="notes"
      fileName={fileName}
      client={client}
      onCancel={onCancel}
      onCommit={onCommit}
    />,
  );
  return { onCancel, onCommit, client };
}

describe("CommitDialog", () => {
  /// A new branch, not the default one.
  ///
  /// Committing to the default branch by default is how somebody pushes to main without meaning to -
  /// and a protected main refuses the commit anyway, which is a worse way to find out.
  it("offers a new branch, named after the file, as the default", () => {
    draw();
    expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe(
      "trypthos/update-readme",
    );
    expect(screen.getByLabelText("Branch name")).toBeTruthy();
  });

  it("suggests a message that says what was done", () => {
    draw();
    expect((screen.getByLabelText("Message") as HTMLInputElement).value).toBe("Update README.md");
  });

  it("hands back the branch and the message", async () => {
    const { onCommit } = draw();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Commit" }));

    expect(onCommit).toHaveBeenCalledWith({
      branch: "trypthos/update-readme",
      create: true,
      message: "Update README.md",
    });
  });

  /// Caught in the box it was typed in.
  ///
  /// A name git refuses comes back from the API as a 422, which reads as "that branch already
  /// exists" - so without this the user is told the wrong thing about the right mistake.
  it("refuses a branch name git would not accept, and says so", async () => {
    const { onCommit } = draw();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Branch name"));
    await user.type(screen.getByLabelText("Branch name"), "has space");

    expect(screen.getByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("will not commit with no message", async () => {
    const { onCommit } = draw();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Message"));
    await user.click(screen.getByRole("button", { name: "Commit" }));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("offers the branches the repository already has", async () => {
    const { onCommit } = draw();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("option", { name: "trunk" })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Choose a branch"), "trunk");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    // `create` false: this branch is already there, and cutting it would be refused as taken.
    expect(onCommit).toHaveBeenCalledWith({
      branch: "trunk",
      create: false,
      message: "Update README.md",
    });
  });

  /// The listing is a convenience, not a requirement.
  ///
  /// A repository whose branches could not be listed can still have one cut, which is the default -
  /// so a failed listing must not take the dialog down with it.
  it("still commits to a new branch when the branches cannot be listed", async () => {
    const { onCommit } = draw({
      repoBranches: vi.fn(async () => ({ ok: false as const, reason: "rate-limited" })),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(onCommit).toHaveBeenCalled();
  });

  it("cancels without committing", async () => {
    const { onCancel, onCommit } = draw();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Escape is what a dialog does. Without it the only way out is the mouse, for a question raised
  // by a keyboard shortcut.
  it("cancels on Escape", async () => {
    const { onCancel } = draw();
    const user = userEvent.setup();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});
