import { describe, expect, it } from "vitest";
import { draftFrom } from "./documentDraft";

/// What a document window makes of the answer when it claims the text it was opened with.
///
/// The answer crosses the IPC boundary, so it is checked rather than trusted - and anything that is
/// not a well-formed draft means "open the file from disk", which is what a window opened from the
/// file tree does anyway.
describe("draftFrom", () => {
  const draft = { content: "# Half written\n", revision: { id: "rev-1" } };

  it("takes a draft the window was opened with", () => {
    expect(draftFrom({ ok: true, draft })).toEqual(draft);
  });

  it("has nothing when the window was opened without one", () => {
    expect(draftFrom({ ok: true, draft: null })).toBeNull();
  });

  // The browser preview has no shell to ask.
  it("has nothing when there was nobody to ask", () => {
    expect(draftFrom({ ok: false, reason: "not-desktop" })).toBeNull();
  });

  it("has nothing for an answer of the wrong shape", () => {
    expect(draftFrom({ ok: true, draft: { content: 7 } })).toBeNull();
    expect(draftFrom(undefined)).toBeNull();
  });
});
