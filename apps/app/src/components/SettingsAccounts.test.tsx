import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SettingsAccounts from "./SettingsAccounts";
import type { GoogleBridge, OneDriveBridge } from "../lib/workspaceClient";

const status = { ok: true as const, configured: true, connected: false, email: null, reason: null };

const google: GoogleBridge = {
  googleStatus: async () => status,
  connectGoogle: async () => ({ ok: true, email: "ada@example.com" }),
  cancelGoogleConnect: async () => ({ ok: true }),
  disconnectGoogle: async () => ({ ok: true }),
  listDriveFolders: async () => ({ ok: true, folders: [] }),
};

const oneDrive: OneDriveBridge = {
  oneDriveStatus: async () => status,
  connectOneDrive: async () => ({ ok: true, email: "ada@example.com" }),
  cancelOneDriveConnect: async () => ({ ok: true }),
  disconnectOneDrive: async () => ({ ok: true }),
  listOneDriveFolders: async () => ({ ok: true, folders: [] }),
};

describe("SettingsAccounts", () => {
  it("draws a section for Google Drive and one for OneDrive", async () => {
    render(<SettingsAccounts bridge={null} google={google} oneDrive={oneDrive} />);
    expect(await screen.findByRole("heading", { name: "Google Drive" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "OneDrive" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Connect OneDrive" })).toBeTruthy();
  });
});
