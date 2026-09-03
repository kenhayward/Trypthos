import type { EditOp, ProposedEdit } from "./documentEdit";

/// Reading a proposed edit out of the model's reply.
///
/// **Why a fenced block rather than provider tool calling.** Trypthos points at any OpenAI-compatible
/// endpoint, and tool support across that space is patchy - Ollama varies by model, llama.cpp is
/// inconsistent, proxies strip it. A model without tool support does not fail; it answers in prose,
/// so a tools-only design would silently do nothing on a good share of the endpoints somebody might
/// configure. This works everywhere, streams as ordinary text, and needs no capability at all.
///
/// **The floor is what makes it safe.** A block this cannot parse stays ordinary text: the user sees
/// the markdown and can paste it by hand. A model that gets the format slightly wrong costs a copy
/// and paste, never the answer. That is the same graceful degradation Live mode uses, where a
/// construct without a decoration simply renders as source.
///
/// Tool calling is a second transport over the same `ProposedEdit`, for endpoints that support it -
/// which is why the edit model is defined in `documentEdit.ts` rather than here.

/// The info string that marks a fenced block as an edit rather than a code sample.
export const EDIT_FENCE_TAG = "trypthos-edit";

/// Writes an edit back out as the block the fenced transport would have produced.
///
/// The join between the two transports. A provider tool call arrives as structured arguments; this
/// turns it into exactly the same text a model would have written by hand, so the card, resolving
/// the anchor and applying it all have ONE representation to deal with. The alternative - carrying
/// tool-call edits alongside parsed ones through every layer - would be two of everything, differing
/// only in how the model happened to phrase itself.
///
/// `splitReply(formatEditBlock(edit))` returns the edit unchanged. That is a test, not a hope.
export function formatEditBlock(edit: ProposedEdit): string {
  // Longer than any run of backticks inside the content, or the content would close the block early
  // and everything after it would read as conversation.
  const longest = Math.max(0, ...[...edit.content.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));

  // Single quotes when the heading contains a double quote. A heading carrying both is not a real
  // document, and the parser's unquoted form would not help either.
  const quote = edit.heading?.includes('"') === true ? "'" : '"';
  const anchor = edit.heading === null ? "" : ` heading=${quote}${edit.heading}${quote}`;

  return `${fence}${EDIT_FENCE_TAG} ${edit.op}${anchor}\n${edit.content}\n${fence}`;
}

export type ReplyPart =
  | { kind: "text"; text: string }
  | { kind: "edit"; edit: ProposedEdit };

const HEADING_OPS: ReadonlySet<string> = new Set([
  "insert-before",
  "insert-after",
  "replace-section",
]);
const ANCHORLESS_OPS: ReadonlySet<string> = new Set(["replace-selection", "append"]);

/// `heading="Some name"`, `heading='Some name'`, or `heading=OneWord`.
const HEADING_ATTRIBUTE = /heading\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/;

/// Reads the info string that follows the opening fence.
///
/// Returns null for anything not understood, which is what keeps the block as text.
function parseInfo(info: string): { op: EditOp; heading: string | null } | null {
  const trimmed = info.trim();
  const op = trimmed.split(/\s+/)[0] ?? "";

  if (ANCHORLESS_OPS.has(op)) return { op: op as EditOp, heading: null };
  if (!HEADING_OPS.has(op)) return null;

  const heading = HEADING_ATTRIBUTE.exec(trimmed);
  const name = heading?.[1] ?? heading?.[2] ?? heading?.[3] ?? null;
  // A heading-anchored edit with no heading cannot be placed, and guessing a target is precisely
  // what this design refuses to do.
  if (name === null || name.trim() === "") return null;

  return { op: op as EditOp, heading: name.trim() };
}

/// Splits a reply into prose and proposed edits, in order.
///
/// Total: it never throws, and every part of the input appears in the output either as an edit or as
/// text.
///
/// `complete` says whether the reply has finished arriving, and it changes exactly one thing: how a
/// block that was never closed is read. Mid-stream, an unterminated fence is a cut-off reply, and
/// turning it into an applicable card would let somebody apply half a sentence. Once the turn has
/// ended it is a model that forgot the closing fence, which they do often enough that refusing would
/// mean showing raw markup instead of a card.
///
/// Completeness relaxes how a block ENDS, never what it means: an unrecognised operation or empty
/// content is still not an edit.
export function splitReply(reply: string, { complete = false } = {}): ReplyPart[] {
  const lines = reply.split("\n");
  const parts: ReplyPart[] = [];
  let text: string[] = [];

  const flushText = () => {
    // Blank lines at the edges are separation from the block beside it, not content. Only whole
    // blank LINES are removed - trimming the text itself would eat the indentation that makes a
    // first line part of a code block or a nested list item.
    const joined = text.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    if (joined.trim() !== "") parts.push({ kind: "text", text: joined });
    text = [];
  };

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    const opening = new RegExp(`^\\s{0,3}(\`{3,})${EDIT_FENCE_TAG}\\b(.*)$`).exec(line);

    if (opening === null) {
      text.push(line);
      continue;
    }

    const fence = opening[1]!;
    const info = parseInfo(opening[2] ?? "");

    // Find the closing fence: a run of at least the same length, as CommonMark requires. That is
    // what lets a ```` block carry an ordinary ``` code sample inside it.
    const ownLine = new RegExp(`^\\s{0,3}\`{${fence.length},}\\s*$`);
    // Models routinely close a block by appending the backticks to the last line of content instead
    // of giving them a line of their own. CommonMark says that is not a close; a model does not
    // read CommonMark, and refusing it means the user sees raw markup instead of a card.
    const appended = new RegExp(`^(.*\\S)\`{${fence.length},}\\s*$`);

    let close = -1;
    let trailing = -1;
    for (let scan = at + 1; scan < lines.length; scan += 1) {
      if (ownLine.test(lines[scan]!)) {
        close = scan;
        break;
      }
      // Remembered, not taken: a proper close later in the block wins, so a stray fence at the end
      // of a line cannot cut a well-formed block short.
      if (trailing === -1 && appended.test(lines[scan]!)) trailing = scan;
    }

    let content = "";
    if (close !== -1) {
      content = lines.slice(at + 1, close).join("\n");
    } else if (trailing !== -1) {
      const body = lines.slice(at + 1, trailing + 1);
      body[body.length - 1] = appended.exec(body[body.length - 1]!)![1]!;
      content = body.join("\n");
      close = trailing;
    } else if (complete) {
      // Never closed, and nothing more is coming: the rest of the reply is the content.
      content = lines.slice(at + 1).join("\n");
      close = lines.length - 1;
    }

    // Unclosed, unrecognised, or empty: keep every line as text. The user still has the markdown.
    if (close === -1 || info === null || content.trim() === "") {
      text.push(line);
      continue;
    }

    flushText();
    parts.push({ kind: "edit", edit: { ...info, content: content.trim() } });
    at = close;
  }

  flushText();
  return parts;
}
