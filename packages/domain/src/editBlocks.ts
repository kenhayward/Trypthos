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
/// text. Called on every render while a reply streams, so a partial block - which is what every
/// prefix of a complete one looks like - must never produce an applicable edit. An unterminated
/// fence stays text for exactly that reason.
export function splitReply(reply: string): ReplyPart[] {
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
    let close = -1;
    for (let scan = at + 1; scan < lines.length; scan += 1) {
      if (new RegExp(`^\\s{0,3}\`{${fence.length},}\\s*$`).test(lines[scan]!)) {
        close = scan;
        break;
      }
    }

    const content = close === -1 ? "" : lines.slice(at + 1, close).join("\n");

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
