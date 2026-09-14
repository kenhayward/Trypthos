import { describe, expect, it } from "vitest";
import { attachFailureKey } from "./attachFailure";
import i18n from "./i18n";

/// What the chat's scope bar says when a file could not be added to the conversation.
///
/// Its own wording rather than the editor's: the editor's refusals talk about opening and saving a
/// file, and neither is what the user just asked for.
describe("attachFailureKey", () => {
  it("names each refusal a user can do something about", () => {
    expect(attachFailureKey("too-large")).toBe("chat.scope.attachFailed.tooLarge");
    expect(attachFailureKey("not-text")).toBe("chat.scope.attachFailed.notText");
    expect(attachFailureKey("unsupported-encoding")).toBe("chat.scope.attachFailed.notText");
    expect(attachFailureKey("not-found")).toBe("chat.scope.attachFailed.notFound");
  });

  // An errno or a reason nobody mapped must never reach the interface as wording, or as a raw key.
  it("says something general for anything else", () => {
    expect(attachFailureKey("EACCES")).toBe("chat.scope.attachFailed.unknown");
    expect(attachFailureKey("")).toBe("chat.scope.attachFailed.unknown");
  });

  // The keys are chosen here rather than written at a call site, so the guard that scans for `t(...)`
  // cannot see them. A key missing from the catalogue would render as itself.
  it("answers only with keys the catalogue has", () => {
    const reasons = ["too-large", "not-text", "unsupported-encoding", "not-found", "EACCES"];
    for (const reason of reasons) {
      expect(i18n.exists(attachFailureKey(reason)), attachFailureKey(reason)).toBe(true);
    }
  });
});
