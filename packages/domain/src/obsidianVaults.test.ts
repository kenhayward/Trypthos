import { describe, expect, it } from "vitest";
import { ObsidianVaultIdSchema, obsidianVaultsFrom } from "./obsidianVaults";

/// Obsidian's own list of vaults, as it writes it: an object keyed by an id it mints, each naming a
/// folder. Invented folders throughout - this file is never read from a real machine here.
const CONFIG = {
  vaults: {
    "0a1b2c3d4e5f6a7b": { path: "D:\\Vaults\\Work Notes", ts: 1700000000000, open: true },
    "1b2c3d4e5f6a7b8c": { path: "/Users/ada/Documents/Garden", ts: 1700000000001 },
  },
};

describe("obsidianVaultsFrom", () => {
  it("names each vault by its folder, whichever separator wrote the path", () => {
    expect(obsidianVaultsFrom(CONFIG)).toEqual([
      { id: "1b2c3d4e5f6a7b8c", name: "Garden", path: "/Users/ada/Documents/Garden" },
      { id: "0a1b2c3d4e5f6a7b", name: "Work Notes", path: "D:\\Vaults\\Work Notes" },
    ]);
  });

  // A list to choose from is read by name, and the file's own order is whatever order Obsidian
  // happened to mint ids in.
  it("lists vaults by name, ignoring case", () => {
    const names = obsidianVaultsFrom({
      vaults: {
        a: { path: "/v/zebra" },
        b: { path: "/v/Apple" },
        c: { path: "/v/mango" },
      },
    }).map((vault) => vault.name);

    expect(names).toEqual(["Apple", "mango", "zebra"]);
  });

  // The file belongs to another application and is written by versions of it this one has never
  // seen. One entry in a shape nobody expected must not take the rest of the list with it.
  it("skips an entry it cannot read and keeps the others", () => {
    const vaults = obsidianVaultsFrom({
      vaults: {
        good: { path: "/v/Garden" },
        nopath: { ts: 1 },
        blank: { path: "" },
        number: { path: 42 },
        "bad id with spaces": { path: "/v/Other" },
      },
    });

    expect(vaults.map((vault) => vault.id)).toEqual(["good"]);
  });

  it("answers with no vaults for a file that is not Obsidian's shape at all", () => {
    expect(obsidianVaultsFrom(null)).toEqual([]);
    expect(obsidianVaultsFrom("vaults")).toEqual([]);
    expect(obsidianVaultsFrom({})).toEqual([]);
    expect(obsidianVaultsFrom({ vaults: [] })).toEqual([]);
  });

  it("keeps the fields Obsidian adds that this app does not read out of the answer", () => {
    const [vault] = obsidianVaultsFrom({ vaults: { a: { path: "/v/Garden", ts: 1, open: true, extra: {} } } });
    expect(Object.keys(vault ?? {}).sort()).toEqual(["id", "name", "path"]);
  });
});

describe("ObsidianVaultIdSchema", () => {
  it("accepts the ids Obsidian mints", () => {
    expect(ObsidianVaultIdSchema.safeParse("0a1b2c3d4e5f6a7b").success).toBe(true);
  });

  // The renderer names a vault by this id, so it is untrusted input like any path.
  it("refuses anything that could be read as a path", () => {
    for (const id of ["", "../x", "a/b", "a\\b", "C:", "x".repeat(65)]) {
      expect(ObsidianVaultIdSchema.safeParse(id).success).toBe(false);
    }
  });
});
