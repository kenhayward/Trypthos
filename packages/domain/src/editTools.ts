import { z } from "zod";
import type { ProposedEdit } from "./documentEdit";

/// The second transport: the same edit, offered to the provider as a function it can call.
///
/// **Why there are two.** A fenced block works on every OpenAI-compatible endpoint and degrades to
/// readable text when a model gets it wrong, which is why it is the default. But models vary wildly
/// in how reliably they follow a format described in prose - measured on one local model, the block
/// arrived in several different shapes across a handful of runs. Where an endpoint supports tool
/// calling, structured arguments remove that variance entirely.
///
/// **This is structured output, not an agentic loop.** The tool call IS the proposal: no result is
/// sent back and the conversation does not continue on its own. Nothing here executes anything - the
/// user still has to press Apply, for exactly the reasons in `ChatEditCard`.
///
/// A completed call is turned into the same block the fenced transport produces, so everything
/// downstream has one representation to deal with rather than two.

export const EDIT_TOOL_NAME = "propose_edit";

const OPS = [
  "insert-before",
  "insert-after",
  "replace-section",
  "replace-selection",
  "append",
] as const;

/// Operations that need somewhere to go.
const ANCHORED: ReadonlySet<string> = new Set(["insert-before", "insert-after", "replace-section"]);

/// The tool, as the provider expects to be told about it.
///
/// Written out as a literal rather than generated from the zod schema. A JSON Schema converter would
/// produce something correct and unreadable, and this text is read by the model: the descriptions
/// are the only thing telling it what "replace-section" means or when a heading is required, and
/// vague ones produce plausible calls aimed at the wrong place.
export function editTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: EDIT_TOOL_NAME,
        description:
          "Propose a change to the markdown document the user is editing. The change is shown to " +
          "the user for approval and is not applied until they accept it. Use this only when the " +
          "user has asked for the document to change; answer a question about it in prose.",
        parameters: {
          type: "object" as const,
          properties: {
            op: {
              type: "string" as const,
              enum: [...OPS],
              description:
                "Where the content goes. insert-before and insert-after place it above or " +
                "directly below a named heading; replace-section replaces that heading and " +
                "everything under it; replace-selection replaces the text the user has selected; " +
                "append adds to the end of the document.",
            },
            heading: {
              type: "string" as const,
              description:
                "The heading to anchor to, exactly as it appears in the document and without its " +
                "hashes. Always send this field: give the heading for insert-before, insert-after " +
                "and replace-section, and an empty string for replace-selection and append. If two " +
                "headings share the name the change cannot be placed.",
            },
            content: {
              type: "string" as const,
              description:
                "The markdown to write, and nothing else. No explanation, no diff markers, and no " +
                "surrounding code fence. For replace-section, include the heading itself if it " +
                "should be kept.",
            },
          },
          // `heading` is required even though three of the five operations ignore it, with an
          // empty string standing in for "none". That is a measurement, not a preference: with it
          // listed as optional, a local model asked to insert before a named heading omitted the
          // parameter in four runs out of six, and every one of those proposals had to be thrown
          // away. Required, with the empty-string convention spelled out above, it was six out of
          // six. Models fill required fields; they skim prose about when a field applies.
          required: ["op", "heading", "content"],
        },
      },
    },
  ];
}

/// Loose, like every other provider response: a model adding a field of its own must not cost the
/// whole proposal.
const ArgumentsSchema = z.looseObject({
  op: z.string(),
  heading: z.string().nullish(),
  content: z.string(),
});

/// Reads one completed tool call into an edit, or null if it cannot be used.
///
/// Total: it never throws. Streamed arguments arrive in fragments and a turn can end mid-object, so
/// a half-written call is an ordinary outcome rather than an error - and the reply already on screen
/// is worth more than the proposal that failed to arrive.
export function editFromToolArguments(json: string): ProposedEdit | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const args = ArgumentsSchema.safeParse(parsed);
  if (!args.success) return null;

  const { op, content } = args.data;
  if (!OPS.includes(op as (typeof OPS)[number])) return null;
  if (content.trim() === "") return null;

  const heading = args.data.heading ?? null;
  // The same rule the fenced transport applies: an edit with nowhere to go is refused rather than
  // placed somewhere plausible.
  if (ANCHORED.has(op) && (heading === null || heading.trim() === "")) return null;

  return {
    op: op as ProposedEdit["op"],
    // Passed through as the model wrote it. `resolveEdit` already compares headings loosely, so
    // normalising here would be a second, quieter set of rules for the same question.
    heading: ANCHORED.has(op) ? heading : null,
    content: content.trim(),
  };
}
