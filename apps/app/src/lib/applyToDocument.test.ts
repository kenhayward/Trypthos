import { describe, expect, it } from "vitest";
import { applyToDocument } from "./applyToDocument";

const target = { from: 2, to: 4, insert: "XY" };

function spies(editorAnswer: boolean | undefined) {
  const editorCalls: unknown[][] = [];
  const committed: string[] = [];
  return {
    editorCalls,
    committed,
    args: (readOnly: boolean) => ({
      readOnly,
      content: "abcdef",
      target,
      applyInEditor: (...a: [number, number, string]) => {
        editorCalls.push(a);
        return editorAnswer;
      },
      commit: (text: string) => committed.push(text),
    }),
  };
}

describe("applyToDocument", () => {
  it("refuses a read-only document before it touches the editor", () => {
    // A mounted editor accepts a programmatic change even when it will not take typing, and the
    // document state would then ignore it while the card said Applied.
    const s = spies(true);
    expect(applyToDocument(s.args(true))).toBe(false);
    expect(s.editorCalls).toEqual([]);
    expect(s.committed).toEqual([]);
  });

  it("applies through the editor when there is one", () => {
    const s = spies(true);
    expect(applyToDocument(s.args(false))).toBe(true);
    expect(s.editorCalls).toEqual([[2, 4, "XY"]]);
    expect(s.committed).toEqual([]);
  });

  it("writes into the text when no editor is mounted", () => {
    const s = spies(undefined);
    expect(applyToDocument(s.args(false))).toBe(true);
    expect(s.committed).toEqual(["abXYef"]);
  });
});
