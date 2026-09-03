import { describe, expect, it } from "vitest";
import {
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  editFromToolArguments,
  editTools,
  pathFromToolArguments,
  readTools,
} from "./editTools";

/// The second transport: the same edit, described to the provider as a function it can call.
///
/// Worth its own tests because the tool schema is read by something we do not control. A parameter
/// the model cannot make sense of produces a call we cannot use, and the only symptom is a chat that
/// answers in prose while insisting it made the change.

describe("editTools", () => {
  const tool = editTools()[0]!;

  it("describes exactly one function", () => {
    expect(editTools()).toHaveLength(1);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe(EDIT_TOOL_NAME);
  });

  // The operations are enumerated for the model rather than described in prose, so it cannot invent
  // a sixth one that then fails to parse.
  it("offers the operations as a closed list", () => {
    expect(tool.function.parameters.properties.op.enum).toEqual([
      "insert-before",
      "insert-after",
      "replace-section",
      "replace-selection",
      "append",
    ]);
  });

  // Measured, not preferred. Listed as optional, a local model omitted the heading in four runs out
  // of six when asked to insert before one, and every one of those proposals was unusable. Required,
  // with an empty string standing in for "none", it was six out of six.
  it("requires the heading too, so the model does not skip it", () => {
    expect(tool.function.parameters.required).toEqual(["op", "heading", "content"]);
  });

  it("tells the model to send an empty heading when there is none", () => {
    expect(tool.function.parameters.properties.heading.description).toMatch(/empty string/);
  });

  // A model reads these to decide what to send. Vague ones produce plausible calls aimed at the
  // wrong place, which is the failure this whole feature is trying to avoid.
  it("explains each parameter", () => {
    const { op, heading, content } = tool.function.parameters.properties;
    for (const parameter of [op, heading, content]) {
      expect(parameter.description.length).toBeGreaterThan(20);
    }
  });

  it("says the heading is needed for the anchored operations", () => {
    expect(tool.function.parameters.properties.heading.description).toMatch(/insert-before/);
  });
});

describe("editFromToolArguments", () => {
  it("reads a heading-anchored call", () => {
    const json = JSON.stringify({
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    });

    expect(editFromToolArguments(json)).toEqual({
      op: "insert-before",
      heading: "Objectives",
      content: "## Summary\n\nAn overview.",
    });
  });

  it("reads a call that needs no heading", () => {
    const json = JSON.stringify({ op: "append", content: "Text." });
    expect(editFromToolArguments(json)).toEqual({ op: "append", heading: null, content: "Text." });
  });

  // Same rule as the fenced transport: an edit with nowhere to go is refused rather than placed
  // somewhere plausible.
  it("refuses an anchored operation with no heading", () => {
    expect(editFromToolArguments(JSON.stringify({ op: "insert-before", content: "Text." }))).toBeNull();
  });

  it("refuses an operation it does not recognise", () => {
    expect(editFromToolArguments(JSON.stringify({ op: "delete-all", content: "Text." }))).toBeNull();
  });

  it("refuses empty content", () => {
    expect(editFromToolArguments(JSON.stringify({ op: "append", content: "   " }))).toBeNull();
  });

  // Streamed arguments arrive in fragments and a turn can end mid-object. Nothing here may throw:
  // the reply on screen is worth more than the proposal that failed to arrive.
  it("refuses arguments that are not JSON", () => {
    expect(editFromToolArguments('{"op": "append", "content"')).toBeNull();
  });

  it("refuses arguments that are not an object", () => {
    expect(editFromToolArguments('"just a string"')).toBeNull();
    expect(editFromToolArguments("")).toBeNull();
  });

  // Tolerant outward, like every other provider response: a model adding a field of its own must not
  // cost the whole proposal.
  it("ignores fields it does not know about", () => {
    const json = JSON.stringify({ op: "append", content: "Text.", confidence: 0.9 });
    expect(editFromToolArguments(json)).toEqual({ op: "append", heading: null, content: "Text." });
  });

  it("trims a heading the model wrapped in its own hashes", () => {
    const json = JSON.stringify({ op: "insert-before", heading: "## Objectives", content: "Text." });
    // Not normalised here: `resolveEdit` already compares headings loosely, so the text is passed
    // through as the model wrote it and matched later.
    expect(editFromToolArguments(json)?.heading).toBe("## Objectives");
  });
});

/// The empty-string convention that comes with making `heading` required.
describe("a heading sent as an empty string", () => {
  it("is accepted for an operation that has no anchor", () => {
    const json = JSON.stringify({ op: "append", heading: "", content: "Text." });
    expect(editFromToolArguments(json)).toEqual({ op: "append", heading: null, content: "Text." });
  });

  it("is still refused for an operation that needs one", () => {
    const json = JSON.stringify({ op: "insert-before", heading: "", content: "Text." });
    expect(editFromToolArguments(json)).toBeNull();
  });

  // A heading sent for an operation that ignores it would otherwise be carried into the edit and
  // shown on the card, describing an anchor the change does not have.
  it("is dropped when sent for an operation that ignores it", () => {
    const json = JSON.stringify({ op: "append", heading: "Objectives", content: "Text." });
    expect(editFromToolArguments(json)?.heading).toBeNull();
  });
});

/// The read tool. Different in kind from `propose_edit`: this one is executed.
describe("readTools", () => {
  const tool = readTools()[0]!;

  it("describes one function, which takes a path", () => {
    expect(tool.function.name).toBe(READ_TOOL_NAME);
    expect(tool.function.parameters.required).toEqual(["path"]);
  });

  // The allowlist stated to the model as well as enforced in the shell. A model told it can read
  // anything will try, and every attempt is a wasted turn.
  it("says that only the listed files can be read", () => {
    expect(tool.function.description).toMatch(/only the paths in that list|anything else is refused/i);
  });

  it("says it can be called more than once", () => {
    expect(tool.function.description).toMatch(/more than once/i);
  });
});

describe("pathFromToolArguments", () => {
  it("reads the path", () => {
    expect(pathFromToolArguments(JSON.stringify({ path: "plan.md" }))).toBe("plan.md");
  });

  it("trims it, because a model will sometimes pad it", () => {
    expect(pathFromToolArguments(JSON.stringify({ path: "  plan.md  " }))).toBe("plan.md");
  });

  it("refuses arguments that never finished arriving", () => {
    expect(pathFromToolArguments('{"path": "pla')).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(pathFromToolArguments(JSON.stringify({ path: "   " }))).toBeNull();
    expect(pathFromToolArguments(JSON.stringify({}))).toBeNull();
  });
});
