import type { ChatTurn } from "@trypthos/domain";

/// The conversation, as data.
///
/// Pure, and separate from the panel, because a streaming bug is invisible in a component test: the
/// reply looks plausible whatever it does. These are the transitions worth pinning down - a token
/// arriving after the turn it belonged to, a retry that has to drop the answer it did not like -
/// and none of them need a rendered panel to check.

/// One entry in the conversation, AS THE PANEL HOLDS IT.
///
/// A superset of the wire turn. The panel records things a provider must never receive - today, the
/// files read on the model's behalf - so the two stopped being the same object the moment one of
/// them grew a field the other must not see.
///
/// `wireTurns` is the conversion, and it is not optional politeness: `ChatTurnSchema` is strict, so
/// a turn that skipped it would be a loud parse failure at the IPC boundary and at save rather than
/// a silent leak. That is the property worth keeping, and the reason the conversion is explicit.
export interface Turn extends ChatTurn {
  /// Files read on the model's behalf while this reply was produced, in the order asked for.
  ///
  /// On the TURN rather than beside it, so scrolling back to an answer still shows what it read to
  /// get there - a fact about that reply, not about whichever reply is on screen now.
  reads?: readonly string[];
}

/// The conversation as a provider receives it.
export function wireTurns(turns: readonly Turn[]): ChatTurn[] {
  return turns.map(({ role, content }) => ({ role, content }));
}

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

/// Records a file read on the model's behalf, against the reply in progress.
///
/// Named once however often it was asked for: the line this feeds says what the model looked at,
/// and a file listed twice reads as a bug in the panel rather than a fact about the turn.
export function noteRead(turns: readonly Turn[], path: string): Turn[] {
  const last = turns.at(-1);
  // The same rule the token appender follows: a late event from a stream nobody is listening to
  // must not attach itself to somebody's own message.
  if (last === undefined || last.role !== "assistant") return [...turns];
  if (last.reads?.includes(path) === true) return [...turns];

  return [...turns.slice(0, -1), { ...last, reads: [...(last.reads ?? []), path] }];
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
