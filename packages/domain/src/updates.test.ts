import { describe, expect, it } from "vitest";
import { isNewerVersion, parseReleaseTag, pickUpdate } from "./updates";

describe("parseReleaseTag", () => {
  it("reads a v-prefixed tag", () => {
    expect(parseReleaseTag("v0.9.0")).toBe("0.9.0");
  });

  it("reads a bare version", () => {
    expect(parseReleaseTag("0.9.0")).toBe("0.9.0");
  });

  // Anything that is not Major.Minor.Build is not one of our releases. A tag like "nightly" or
  // "v2-beta" must not be compared as though it were a version.
  it("refuses anything that is not Major.Minor.Build", () => {
    expect(parseReleaseTag("nightly")).toBeNull();
    expect(parseReleaseTag("v1.2")).toBeNull();
    expect(parseReleaseTag("v1.2.3.4")).toBeNull();
    expect(parseReleaseTag("v1.2.3-beta")).toBeNull();
    expect(parseReleaseTag("")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares numerically, not as text", () => {
    // The trap: "0.10.0" sorts before "0.9.0" as a string, so a string comparison would tell a user
    // on 0.9.0 that 0.10.0 is older and never offer it.
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(false);
  });

  it("is false for the same version", () => {
    expect(isNewerVersion("0.9.0", "0.9.0")).toBe(false);
  });

  it("compares each part in turn", () => {
    expect(isNewerVersion("0.9.0", "0.9.1")).toBe(true);
    expect(isNewerVersion("0.9.1", "0.9.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(true);
  });

  // A downgrade must never be offered as an update, however it arose - a yanked release, or someone
  // running a build newer than anything published.
  it("never treats an older release as an update", () => {
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
  });
});

describe("pickUpdate", () => {
  const releases = [
    { tag_name: "v0.10.0", draft: false, prerelease: false, html_url: "u/0.10.0" },
    { tag_name: "v0.9.0", draft: false, prerelease: false, html_url: "u/0.9.0" },
  ];

  it("finds the newest release when one is newer", () => {
    const update = pickUpdate(releases, "0.9.0");
    expect(update?.version).toBe("0.10.0");
    expect(update?.url).toBe("u/0.10.0");
  });

  it("finds nothing when already on the newest", () => {
    expect(pickUpdate(releases, "0.10.0")).toBeNull();
  });

  it("finds nothing when running a build newer than anything published", () => {
    expect(pickUpdate(releases, "1.0.0")).toBeNull();
  });

  // A draft is not published, and a prerelease was not chosen by anyone running a stable build.
  it("ignores drafts and prereleases", () => {
    const withDraft = [
      { tag_name: "v0.11.0", draft: true, prerelease: false, html_url: "u/draft" },
      { tag_name: "v0.12.0", draft: false, prerelease: true, html_url: "u/pre" },
      ...releases,
    ];
    expect(pickUpdate(withDraft, "0.9.0")?.version).toBe("0.10.0");
  });

  it("ignores tags that are not versions", () => {
    const odd = [{ tag_name: "nightly", draft: false, prerelease: false, html_url: "u/n" }, ...releases];
    expect(pickUpdate(odd, "0.9.0")?.version).toBe("0.10.0");
  });

  // GitHub returns newest first, but nothing guarantees it - and picking the first newer one rather
  // than the newest would offer an upgrade to a version that is already superseded.
  it("picks the highest version, not the first one listed", () => {
    const shuffled = [
      { tag_name: "v0.9.5", draft: false, prerelease: false, html_url: "u/0.9.5" },
      { tag_name: "v0.11.0", draft: false, prerelease: false, html_url: "u/0.11.0" },
      { tag_name: "v0.10.0", draft: false, prerelease: false, html_url: "u/0.10.0" },
    ];
    expect(pickUpdate(shuffled, "0.9.0")?.version).toBe("0.11.0");
  });

  it("finds nothing in an empty list", () => {
    expect(pickUpdate([], "0.9.0")).toBeNull();
  });
});
