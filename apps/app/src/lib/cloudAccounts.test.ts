import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT, cloudAccountKeys, oneDriveFailureKey } from "./cloudAccounts";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

describe("the account kinds and the catalogue", () => {
  it("name only keys that exist (kind to catalogue)", () => {
    for (const key of cloudAccountKeys()) expect(typeof lookup(key), key).toBe("string");
  });

  // The other direction: nothing under google. or onedrive. is unused, because the i18n guard
  // counts exactly the kinds' keys as used.
  it("leave no key under google. or onedrive. unnamed (catalogue to kind)", () => {
    const catalogue = flatten(en).filter((key) => key.startsWith("google.") || key.startsWith("onedrive."));
    const named = cloudAccountKeys().filter((key) => key.startsWith("google.") || key.startsWith("onedrive."));
    expect(catalogue.sort()).toEqual([...new Set(named)].sort());
  });

  it("names the Settings headings", () => {
    expect(GOOGLE_ACCOUNT.titleKey).toBe("settings.accounts.googleDrive");
    expect(ONEDRIVE_ACCOUNT.titleKey).toBe("settings.accounts.oneDrive");
  });
});

describe("oneDriveFailureKey", () => {
  it.each([
    ["offline", "errors.oneDriveOffline"],
    ["rate-limited", "errors.oneDriveRateLimited"],
    ["not-connected", "errors.oneDriveNotConnected"],
    ["scope-denied", "errors.oneDriveScopeDenied"],
    ["timed-out", "errors.oneDriveTimedOut"],
    ["not-configured", "errors.oneDriveNotConfigured"],
  ])("answers %s with %s, which exists", (reason, key) => {
    expect(oneDriveFailureKey(reason)).toBe(key);
    expect(typeof lookup(key)).toBe("string");
  });

  it("is not an error when the browser was closed", () => {
    expect(oneDriveFailureKey("cancelled")).toBeNull();
  });
});
