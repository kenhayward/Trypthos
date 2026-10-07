import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import { GOOGLE_ACCOUNT, ONEDRIVE_ACCOUNT, oneDriveFailureKey, type CloudAccountKind } from "./cloudAccounts";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

describe.each([
  ["Google", GOOGLE_ACCOUNT],
  ["OneDrive", ONEDRIVE_ACCOUNT],
] as [string, CloudAccountKind][])("the %s account kind", (_name, kind) => {
  it("names only keys that exist in the catalogue", () => {
    const keys = [kind.titleKey, kind.checkingKey, kind.connectKey, kind.connectBlurbKey, kind.notConfiguredKey, kind.browserOnlyKey];
    if (kind.connectedNoteKey !== null) keys.push(kind.connectedNoteKey);
    for (const key of keys) expect(typeof lookup(key), key).toBe("string");
  });
});

describe("oneDriveFailureKey", () => {
  it("words every account failure for Microsoft and the key exists", () => {
    for (const reason of ["offline", "rate-limited", "not-connected", "scope-denied", "timed-out"]) {
      const key = oneDriveFailureKey(reason);
      expect(typeof lookup(key ?? ""), reason).toBe("string");
      expect(key, reason).toContain("oneDrive");
    }
  });

  it("is not an error when the browser was closed", () => {
    expect(oneDriveFailureKey("cancelled")).toBeNull();
  });
});
