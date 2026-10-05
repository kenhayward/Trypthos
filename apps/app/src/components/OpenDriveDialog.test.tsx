import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpenDriveDialog from "./OpenDriveDialog";
import type { DriveFoldersResult, GoogleBridge } from "../lib/workspaceClient";

const TOP: DriveFoldersResult = {
  ok: true,
  folders: [{ id: "dirBBB", name: "Projects" }],
  drives: [{ id: "sharedDDD", name: "Team" }],
};

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: true, email: "ada@example.com", reason: null })),
    connectGoogle: vi.fn(async () => ({ ok: true as const, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    listDriveFolders: vi.fn(async (parentId: string | null): Promise<DriveFoldersResult> =>
      parentId === null ? TOP : { ok: true, folders: [{ id: "dirEEE", name: "2026" }], drives: [] },
    ),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("OpenDriveDialog", () => {
  it("shows My Drive's folders and the Shared Drives, with nothing to open at the top", async () => {
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={() => {}} />);
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Team" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open this folder" })).toBeNull();
  });

  it("shows a spinner while the folders are being listed", async () => {
    const bridge = fakeBridge({ listDriveFolders: vi.fn(() => new Promise<DriveFoldersResult>(() => {})) });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    expect(await screen.findByRole("status", { name: "Loading folders..." })).toBeDefined();
    expect(screen.getByText("Loading folders...")).toBeDefined();
  });

  it("opens the folder it was taken into, under the name it showed", async () => {
    const onOpen = vi.fn();
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", { name: "2026" })).toBeDefined();
    expect(bridge.listDriveFolders).toHaveBeenLastCalledWith("dirBBB");

    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirBBB", name: "Projects" });
  });

  it("opens a Shared Drive folder with the drive it lives in", async () => {
    const onOpen = vi.fn();
    render(<OpenDriveDialog bridge={fakeBridge()} onCancel={() => {}} onOpen={onOpen} />);

    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    await userEvent.click(await screen.findByRole("button", { name: "2026" }));
    await screen.findByRole("button", { name: "Open this folder" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open this folder" })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Open this folder" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "google-drive", folderId: "dirEEE", driveId: "sharedDDD", name: "2026" });
  });

  it("goes back up through the breadcrumb", async () => {
    const bridge = fakeBridge();
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "2026" });
    await userEvent.click(screen.getByRole("button", { name: "Google Drive" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
  });

  it("asks to connect when no account is connected, and reloads once one is", async () => {
    let connected = false;
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected, email: connected ? "ada@example.com" : null, reason: null })),
      connectGoogle: vi.fn(async () => {
        connected = true;
        return { ok: true as const, email: "ada@example.com" };
      }),
      listDriveFolders: vi.fn(async (): Promise<DriveFoldersResult> => (connected ? TOP : { ok: false, reason: "not-connected" })),
    });
    render(<OpenDriveDialog bridge={bridge} onCancel={() => {}} onOpen={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(await screen.findByRole("button", { name: "Projects" })).toBeDefined();
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
