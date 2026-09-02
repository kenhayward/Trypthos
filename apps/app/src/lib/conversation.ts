import type { ChatTurn } from "@trypthos/domain";

/// The conversation, as data.
///
/// Pure, and separate from the panel, because a streaming bug is invisible in a component test: the
/// reply looks plausible whatever it does. These are the transitions worth pinning down - a token
/// arriving after the turn it belonged to, a retry that has to drop the answer it did not like -
/// and none of them need a rendered panel to check.

export type Turn = ChatTurn;

/// Adds the empty assistant turn that arriving tokens fill.
///
/// Present from the moment the request is sent, so the panel has somewhere to show "thinking" while
/// nothing has arrived yet.
export function beginReply(turns: readonly Turn[]): Turn[] {
  return [...turns, { role: "assistant", content: "" }];
}

/// Appends one streamed token to the reply in progress.
///
/// A new array every time: React re-renders on identity, and a mutated array would leave the thread
/// showing the previous token until something else happened to change.
export function appendToken(turns: readonly Turn[], text: string): Turn[] {
  const last = turns.at(-1);
  // A late token, from a stream the panel has stopped listening to. Appending it to a user's own
  // message would put words in their mouth, which is worse than dropping it.
  if (last === undefined || last.role !== "assistant") return [...turns];

  return [...turns.slice(0, -1), { ...last, content: last.content + text }];
}

/// Replaces the reply in progress - used to show an error in the place the answer would have been.
export function setReply(turns: readonly Turn[], content: string): Turn[] {
  const last = turns.at(-1);
  if (last === undefined || last.role !== "assistant") return [...turns];

  return [...turns.slice(0, -1), { ...last, content }];
}

/// The history a retry resends: everything up to and including the last question.
export function historyWithoutReply(turns: readonly Turn[]): Turn[] {
  return turns.at(-1)?.role === "assistant" ? turns.slice(0, -1) : [...turns];
}

/// The question a retry would repeat, or null if nobody has asked one.
export function askedBy(turns: readonly Turn[]): string | null {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const turn = turns[at]!;
    if (turn.role === "user") return turn.content;
  }
  return null;
}
