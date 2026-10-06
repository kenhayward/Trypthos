import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenDriveDialog from "./OpenDriveDialog";
import type { DriveFoldersResult, DriveLocation, GoogleBridge } from "../lib/workspaceClient";

const DRIVES: DriveFoldersResult = { ok: true, folders: [{ id: "sharedDDD", name: "Team", shared: true }] };

/// What each place holds. Keyed by what the dialog asks, so a test also proves what it asked.
function answerFor(location: DriveLocation): DriveFoldersResult {
  if (location.in === "drives") return DRIVES;
  if (location.in === "shared-with-me") {
    return { ok: true, folders: [{ id: "dirGGG", name: "Handbook", shared: false }] };
  }
  switch (location.id) {
    case "root":
      return {
        ok: true,
        folders: [
          { id: "dirBBB", name: "Projects", shared: false },
          { id: "dirHHH", name: "Joint", shared: true },
        ],
      };
    case "sharedDDD":
    case "dirBBB":
    case "dirGGG":
      return { ok: true, folders: [{ id: "dirEEE", name: "2026", shared: false }] };
    default:
      return { ok: true, folders: [] };
  }
}

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    connectGoogle: vi.fn(async () => ({ ok: true as const, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    listDriveFolders: vi.fn(async (location: DriveLocation): Promise<DriveFoldersResult> => answerFor(location)),
    ...overrides,
  } satisfies GoogleBridge;
}

const markOf = (button: HTMLElement) => button.querySelector("[data-mark]")?.getAttribute("data-mark");

describe("OpenDriveDialog", () => {
  it("shows My Drive, Shared with me and the shared drives, each with its own icon, and nothing to open", async () => {
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    const team = await screen.findByRole("button", { name: "Team" });
    expect(bridge.listDriveFolders).toHaveBeenCalledWith({ in: "drives" });
    expect(markOf(screen.getByRole("button", { name: "My Drive" }))).toBe("drive-my-drive");
    expect(markOf(screen.getByRole("button", { name: "Shared with me" }))).toBe("drive-shared-with-me");
    expect(markOf(team)).toBe("drive-shared-drive");
    expect(screen.getByRole("heading", { name: "Shared drives" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
  });

  it("hides the Shared drives heading when there are none", async () => {
    const bridge = fakeBridge({
      listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => ({ ok: true, folders: [] })),
    });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);
    await screen.findByRole("button", { name: "My Drive" });
    expect(screen.queryByRole("heading", { name: "Shared drives" })).toBeNull();
  });

  it("puts the Drive mark beside the title", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await screen.findByRole("button", { name: "My Drive" });
    const title = screen.getByRole("heading", { name: "Open a Google Drive folder" });
    expect(title.parentElement?.querySelector('[data-mark="google-drive"]')).not.toBeNull();
  });

  it("is a larger dialog, held inside the window", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await screen.findByRole("button", { name: "My Drive" });
    const panel = screen.getByRole("dialog").firstElementChild;
    expect(panel?.className).toContain("w-[56rem]");
    expect(panel?.className).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("shows a spinner while the folders are being listed", async () => {
    const bridge = fakeBridge({ listDriveFolders: vi.fn(() => new Promise<DriveFoldersResult>(() => {})) });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    expect(await screen.findByRole("status", { name: "Loading folders..." })).toBeDefined();
    expect(screen.getByText("Loading folders...")).toBeDefined();
  });

  it("opens My Drive itself", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My Drive" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
    expect(bridge.listDriveFolders).toHaveBeenLastCalledWith({ in: "folder", id: "root" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "root", name: "My Drive" });
  });

  it("opens a folder it was taken into, under the name it showed", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "My Drive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", { name: "2026" })).toBeDefined();
    expect(bridge.listDriveFolders).toHaveBeenLastCalledWith({ in: "folder", id: "dirBBB" });

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirBBB", name: "Projects" });
  });

  it("opens a shared drive, and a folder inside it with the drive it lives in", async () => {
    const onOpen = vi.fn();
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(await screen.findByRole("button", { name: "2026" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open this folder" })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirEEE", driveId: "sharedDDD", name: "2026" });
  });

  it("offers nothing to open in Shared with me, but a folder inside it opens", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    const handbook = await screen.findByRole("button", { name: "Handbook" });
    expect(bridge.listDriveFolders).toHaveBeenLastCalledWith({ in: "shared-with-me" });
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
    expect(markOf(handbook)).toBe("drive-shared-folder");

    await userEvent.click(handbook);
    await screen.findByRole("button", { name: "2026" });
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirGGG", name: "Handbook" });
  });

  it("draws a shared folder with the shared-folder icon and an ordinary one with the folder icon", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "My Drive" }));

    expect(markOf(await screen.findByRole("button", { name: "Projects" }))).toBe("drive-folder");
    expect(markOf(screen.getByRole("button", { name: "Joint" }))).toBe("drive-shared-folder");
  });

  it("carries the category icon on the first crumb only", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(await screen.findByRole("button", { name: "2026" }));
    await screen.findByRole("button", { name: "Open this folder" });

    const crumbs = within(screen.getByRole("navigation"));
    expect(markOf(crumbs.getByRole("button", { name: "Team" }))).toBe("drive-shared-drive");
    expect(markOf(crumbs.getByRole("button", { name: "2026" }))).toBeUndefined();
  });

  it("gives My Drive and Shared with me their icons on the first crumb", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "My Drive" }));
    await screen.findByRole("button", { name: "Projects" });
    expect(markOf(within(screen.getByRole("navigation")).getByRole("button", { name: "My Drive" }))).toBe("drive-my-drive");

    await userEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Google Drive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Shared with me" }));
    await screen.findByRole("button", { name: "Handbook" });
    expect(markOf(within(screen.getByRole("navigation")).getByRole("button", { name: "Shared with me" }))).toBe("drive-shared-with-me");
  });

  it("goes back up through the breadcrumb", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "My Drive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "2026" });
    await userEvent.click(screen.getByRole("button", { name: "Google Drive" }));
    expect(await screen.findByRole("button", { name: "Team" })).toBeDefined();
  });

  it("asks to connect when no account is connected, and reloads once one is", async () => {
    let connected = false;
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected, email: connected ? "ada@example.com" : null, reason: null })),
      connectGoogle: vi.fn(async () => {
        connected = true;
        return { ok: true as const, email: "ada@example.com" };
      }),
      listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => (connected ? DRIVES : { ok: false, reason: "not-connected" })),
    });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(await screen.findByRole("button", { name: "Team" })).toBeDefined();
  });

  it("names a failed listing in Google's words", async () => {
    const bridge = fakeBridge({ listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => ({ ok: false, reason: "offline" })) });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Google");
    expect(alert.textContent).not.toContain("GitHub");
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={onCancel} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
