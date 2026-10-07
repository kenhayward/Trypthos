import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectsConsoleError } from "../test-setup";
import CloudAccountSection from "./CloudAccountSection";
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT } from "../lib/cloudAccounts";
import { googleAccount, oneDriveAccount, type GoogleBridge, type GoogleConnectResult, type OneDriveBridge } from "../lib/workspaceClient";

function fakeBridge(overrides: Partial<GoogleBridge> = {}) {
  return {
    googleStatus: vi.fn(async () => ({ ok: true as const, configured: true, connected: false, email: null, reason: null })),
    connectGoogle: vi.fn(async (): Promise<GoogleConnectResult> => ({ ok: true, email: "ada@example.com" })),
    cancelGoogleConnect: vi.fn(async () => ({ ok: true })),
    disconnectGoogle: vi.fn(async () => ({ ok: true })),
    listDriveFolders: vi.fn(async () => ({ ok: true as const, folders: [] })),
    ...overrides,
  } satisfies GoogleBridge;
}

describe("CloudAccountSection with Google", () => {
  it("connects through the browser and shows who is connected", async () => {
    const bridge = fakeBridge();
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));

    expect(await screen.findByText("Connected as ada@example.com")).toBeDefined();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined();
  });

  it("offers Cancel while waiting for the browser", async () => {
    let finish: (value: GoogleConnectResult) => void = () => {};
    const bridge = fakeBridge({
      connectGoogle: vi.fn(() => new Promise<GoogleConnectResult>((resolve) => (finish = resolve))),
      cancelGoogleConnect: vi.fn(async () => {
        finish({ ok: false, reason: "cancelled" });
        return { ok: true };
      }),
    });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect(screen.getByText("Waiting for your browser...")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Google Drive" })).toBeDefined());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so, with no button, in a build without Google Drive", async () => {
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => ({ ok: true as const, configured: false, connected: false, email: null, reason: null })),
    });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    expect(await screen.findByText("This build of Trypthos was made without Google Drive support.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Connect Google Drive" })).toBeNull();
  });

  it("shows a refused sign-in as an alert", async () => {
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "scope-denied" })) });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Google Drive access was not allowed");
  });

  it("explains the browser preview cannot connect", async () => {
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={null} />);
    expect(await screen.findByText("Connecting to Google Drive needs the desktop app. This is the browser preview.")).toBeDefined();
  });

  it("keeps Connect and does not claim the build lacks Drive when the status check itself fails", async () => {
    expectsConsoleError(/A call to the shell did not complete/);
    const bridge = fakeBridge({
      googleStatus: vi.fn(async () => {
        throw new Error("ipc down");
      }),
    });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Connect Google Drive" })).toBeDefined();
    expect(screen.queryByText("This build of Trypthos was made without Google Drive support.")).toBeNull();
  });

  it("names Google, not GitHub, when it cannot be reached", async () => {
    const bridge = fakeBridge({
      connectGoogle: vi.fn(async (): Promise<GoogleConnectResult> => ({ ok: false, reason: "offline" })),
    });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} />);

    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Google");
    expect(alert.textContent).not.toContain("GitHub");
  });

  it("tells its owner when an account has been connected", async () => {
    const onConnected = vi.fn();
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(fakeBridge())} onConnected={onConnected} />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
  });

  it("does not report a sign-in that did not connect", async () => {
    const onConnected = vi.fn();
    const bridge = fakeBridge({ connectGoogle: vi.fn(async () => ({ ok: false as const, reason: "cancelled" })) });
    render(<CloudAccountSection kind={GOOGLE_ACCOUNT} bridge={googleAccount(bridge)} onConnected={onConnected} />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    await waitFor(() => expect(bridge.connectGoogle).toHaveBeenCalled());
    expect(onConnected).not.toHaveBeenCalled();
  });
});

function fakeOneDrive(overrides: Partial<OneDriveBridge> = {}): OneDriveBridge {
  return {
    oneDriveStatus: async () => ({ ok: true, configured: true, connected: false, email: null, reason: null }),
    connectOneDrive: async () => ({ ok: true, email: "ada@example.com" }),
    cancelOneDriveConnect: async () => ({ ok: true }),
    disconnectOneDrive: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("the OneDrive account", () => {
  it("connects and names the account", async () => {
    const user = userEvent.setup();
    render(<CloudAccountSection kind={ONEDRIVE_ACCOUNT} bridge={oneDriveAccount(fakeOneDrive())} />);
    expect(await screen.findByRole("heading", { name: "OneDrive" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect(await screen.findByText("Connected as ada@example.com")).toBeTruthy();
    // Microsoft cannot be asked to forget the grant, so the section says where to.
    expect(screen.getByText(/account\.live\.com/)).toBeTruthy();
  });

  it("says when this build has no OneDrive", async () => {
    render(
      <CloudAccountSection
        kind={ONEDRIVE_ACCOUNT}
        bridge={oneDriveAccount(fakeOneDrive({ oneDriveStatus: async () => ({ ok: true, configured: false, connected: false, email: null, reason: null }) }))}
      />,
    );
    expect(await screen.findByText("This build of Trypthos was made without OneDrive support.")).toBeTruthy();
  });

  it("explains a failed sign-in in OneDrive's words", async () => {
    const user = userEvent.setup();
    render(
      <CloudAccountSection
        kind={ONEDRIVE_ACCOUNT}
        bridge={oneDriveAccount(fakeOneDrive({ connectOneDrive: async () => ({ ok: false, reason: "offline" }) }))}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach Microsoft. Check your connection and try again.");
  });

  it("names Microsoft, not Google, when sign-in is refused or times out", async () => {
    const user = userEvent.setup();
    render(
      <CloudAccountSection
        kind={ONEDRIVE_ACCOUNT}
        bridge={oneDriveAccount(fakeOneDrive({ connectOneDrive: async () => ({ ok: false, reason: "scope-denied" }) }))}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect OneDrive" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("OneDrive");
    expect(alert).not.toContain("Google");
  });

  it("is a desktop-only control in the browser preview", () => {
    render(<CloudAccountSection kind={ONEDRIVE_ACCOUNT} bridge={null} />);
    expect(screen.getByText("Connecting to OneDrive needs the desktop app. This is the browser preview.")).toBeTruthy();
  });
});
