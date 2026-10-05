import { describe, expect, it } from "vitest";
import { findHeadings, resolveEdit } from "./documentEdit";
import { splitReply } from "./editBlocks";
import { normaliseEndpoint } from "./endpoints";
import { branchNameFor, countFromLink } from "./github";
import { embeddedSection } from "./noteEmbed";
import { createPathGuard } from "./workspacePath";

/// Text the app did not write - a user's note, a model's reply, a pasted URL - must not be able to
/// stall it. Each case here is a long run of one character that a backtracking regular expression
/// would retry from every starting position: quadratic at best, and for the heading patterns worse,
/// where a line of two thousand spaces took seconds and eight thousand never finished.
///
/// The bound is generous on purpose. What it separates is linear from super-linear: the linear
/// version answers in about a millisecond, the old one in seconds to minutes.
const RUN = 20_000;
const BOUND_MS = 250;

function timed<T>(work: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = work();
  return { value, ms: performance.now() - start };
}

describe("a long run of one character does not stall", () => {
  it("finding a heading whose title is mostly spaces", () => {
    const { value, ms } = timed(() => findHeadings(`# a${" ".repeat(RUN)}b`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value[0]?.text).toBe(`a${" ".repeat(RUN)}b`);
  });

  it("matching an edit to a heading written with spaces", () => {
    const doc = `# Plan\n\nBody.\n`;
    const { value, ms } = timed(() =>
      resolveEdit(
        { op: "insert-after", heading: `${" ".repeat(RUN)}x`, content: "More." },
        { doc, selection: null },
      ),
    );
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value.ok).toBe(false);
  });

  it("appending to a document with a long run of spaces inside it", () => {
    const doc = `a${" ".repeat(RUN * 5)}b`;
    const { value, ms } = timed(() =>
      resolveEdit({ op: "append", heading: null, content: "More." }, { doc, selection: null }),
    );
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toMatchObject({ ok: true, from: doc.length, to: doc.length });
  });

  it("splitting a reply with a long run of blank lines", () => {
    const { value, ms } = timed(() => splitReply(`a${"\n".repeat(RUN * 5)}b`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toHaveLength(1);
  });

  it("normalising an endpoint full of slashes", () => {
    const { value, ms } = timed(() => normaliseEndpoint(`https://x${"/".repeat(RUN * 5)}y//`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBe(`https://x${"/".repeat(RUN * 5)}y`);
  });

  it("checking a path full of slashes against the workspace", () => {
    const guard = createPathGuard({ root: "/ws", caseInsensitive: false });
    const { value, ms } = timed(() => guard.contains(`/other${"/".repeat(RUN * 5)}x/`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBe(false);
  });

  it("naming a branch after a file full of punctuation", () => {
    const { value, ms } = timed(() => branchNameFor(`a${"-".repeat(RUN * 5)}b.md`));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toMatch(/update-a-b$/);
  });

  it("reading a Link header that never closes its address", () => {
    const { value, ms } = timed(() => countFromLink(`${"<=".repeat(RUN * 5)}; rel="last"`, 1));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBeNull();
  });

  it("finding an embedded section under a heading full of tabs", () => {
    const note = `# a${"\t".repeat(RUN)}b\n\nBody.`;
    const { value, ms } = timed(() => embeddedSection(note, { heading: "Missing", block: null }));
    expect(ms).toBeLessThan(BOUND_MS);
    expect(value).toBeNull();
  });
});
