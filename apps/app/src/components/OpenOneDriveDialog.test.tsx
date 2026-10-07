import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenOneDriveDialog from "./OpenOneDriveDialog";
import type { OneDriveBridge, OneDriveFoldersResult, OneDriveLocation } from "../lib/workspaceClient";

const MINE = "d0c0ffee";
const THEIRS = "beefcafe";

/// What each place holds. Keyed by what the dialog asks, so a test also proves what it asked.
function answerFor(location: OneDriveLocation): OneDriveFoldersResult {
  if (location.in === "my-files") {
    return {
      ok: true,
      driveId: MINE,
      folders: [
        { driveId: THEIRS, itemId: "SHARED!7", name: "Joint", shared: true },
        { driveId: MINE, itemId: "ITEM!2", name: "Projects", shared: false },
      ],
    };
  }
  if (location.in === "shared-with-me") return { ok: true, folders: [{ driveId: THEIRS, itemId: "SHARED!8", name: "Handbook", shared: true }] };
  if (location.itemId === "ITEM!2") return { ok: true, folders: [{ driveId: MINE, itemId: "ITEM!5", name: "2026", shared: false }] };
  if (location.itemId === "SHARED!8") return { ok: true, folders: [{ driveId: THEIRS, itemId: "ITEM!6", name: "Chapters", shared: false }] };
  return { ok: true, folders: [] };
}

function fakeBridge(overrides: Partial<OneDriveBridge> = {}) {
  return {
    oneDriveStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    connectOneDrive: vi.fn(async () => ({ ok: true as const, email: "ada@example.com" })),
    cancelOneDriveConnect: vi.fn(async () => ({ ok: true })),
    disconnectOneDrive: vi.fn(async () => ({ ok: true })),
    listOneDriveFolders: vi.fn(async (location: OneDriveLocation): Promise<OneDriveFoldersResult> => answerFor(location)),
    ...overrides,
  } satisfies OneDriveBridge;
}

const markOf = (button: HTMLElement) => button.querySelector("[data-mark]")?.getAttribute("data-mark");

describe("OpenOneDriveDialog", () => {
  it("shows My files and Shared with me under OneDrive's mark, and nothing to open yet", async () => {
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    const myFiles = await screen.findByRole("button", { name: "My files" });
    expect(markOf(myFiles)).toBe("onedrive");
    expect(markOf(screen.getByRole("button", { name: "Shared with me" }))).toBe("drive-shared-with-me");
    const title = screen.getByRole("heading", { name: "Open a OneDrive folder" });
    expect(title.parentElement?.querySelector('[data-mark="onedrive"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
    // The top level is two fixed places: nothing is listed until one is entered.
    expect(bridge.listOneDriveFolders).not.toHaveBeenCalled();
  });

  it("opens My files itself, on the connected account's drive", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "my-files" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: MINE, itemId: "root", name: "My files" });
  });

  it("opens a folder in My files by its drive and item", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", { name: "2026" })).toBeDefined();
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "folder", driveId: MINE, itemId: "ITEM!2" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: MINE, itemId: "ITEM!2", name: "Projects" });
  });

  it("offers nothing to open in Shared with me; a shared folder opens in its owner's drive, marked shared", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    const handbook = await screen.findByRole("button", { name: "Handbook" });
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "shared-with-me" });
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
    expect(markOf(handbook)).toBe("drive-shared-folder");

    await userEvent.click(handbook);
    await screen.findByRole("button", { name: "Chapters" });
    expect(bridge.listOneDriveFolders).toHaveBeenLastCalledWith({ in: "folder", driveId: THEIRS, itemId: "SHARED!8" });
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: THEIRS, itemId: "SHARED!8", shared: true, name: "Handbook" });
  });

  it("marks a shared folder in My files as shared, and opens it in its owner's drive", async () => {
    const onOpen = vi.fn();
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    const joint = await screen.findByRole("button", { name: "Joint" });
    expect(markOf(joint)).toBe("drive-shared-folder");
    expect(markOf(screen.getByRole("button", { name: "Projects" }))).toBe("drive-folder");

    await userEvent.click(joint);
    expect(await screen.findByText("No folders here.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "onedrive", driveId: THEIRS, itemId: "SHARED!7", shared: true, name: "Joint" });
  });

  // Spec, open questions: Shared with me answering nothing - or failing, which the shell answers as
  // nothing - is an empty place, never an error over the dialog.
  it("shows an empty Shared with me as an empty place", async () => {
    const bridge = fakeBridge({ listOneDriveFolders: vi.fn(async (): Promise<OneDriveFoldersResult> => ({ ok: true, folders: [] })) });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    expect(await screen.findByText("No folders here.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks to connect when no account is connected, and carries on once one is", async () => {
    let connected = false;
    const bridge = fakeBridge({
      oneDriveStatus: vi.fn(async () => ({
        ok: true as const,
        configured: true,
        connected,
        email: connected ? "ada@example.com" : null,
        reason: null,
      })),
      connectOneDrive: vi.fn(async () => {
        connected = true;
        return { ok: true as const, email: "ada@example.com" };
      }),
    });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect(await screen.findByRole("button", { name: "My files" })).toBeDefined();
  });

  it("names a failed listing in Microsoft's words", async () => {
    const bridge = fakeBridge({ listOneDriveFolders: vi.fn(async (): Promise<OneDriveFoldersResult> => ({ ok: false, reason: "offline" })) });
    render(<OpenOneDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Microsoft");
    expect(alert.textContent).not.toContain("GitHub");
  });

  it("goes back up through the breadcrumb", async () => {
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "My files" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "2026" });

    const crumbs = within(screen.getByRole("navigation"));
    expect(crumbs.getByRole("button", { name: "My files" })).toBeDefined();
    await userEvent.click(crumbs.getByRole("button", { name: "OneDrive" }));
    expect(await screen.findByRole("button", { name: "Shared with me" })).toBeDefined();
  });

  it("says OneDrive opens read-only in this release, and cancels", async () => {
    const onCancel = vi.fn();
    render(<OpenOneDriveDialog bridge={fakeBridge()} onCancel={onCancel} onOpen={() => {}} />);

    expect(await screen.findByText("OneDrive folders open read-only for now. Saving to OneDrive follows in the next release.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
