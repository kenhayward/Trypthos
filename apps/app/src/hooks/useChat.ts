import { useCallback, useEffect, useRef, useState } from "react";
import { ChatEventMessage, type ChatContext, type ChatEvent } from "@trypthos/domain";
import {
  appendToken,
  beginReply,
  historyWithoutReply,
  type Turn,
} from "../lib/conversation";

/// One conversation, and the stream feeding it.
///
/// The renderer sends a turn and receives tokens; it never holds an API key and never opens a socket
/// to a provider. What lives here is the bookkeeping that makes a streamed reply behave: which
/// stream the panel is currently listening to, and what to do with everything that is not it.

export interface ChatBridge {
  sendChat(
    profileId: string,
    turns: Turn[],
    context: ChatContext,
  ): Promise<{ ok: true; streamId: string } | { ok: false; reason: string }>;
  cancelChat(streamId: string): Promise<unknown>;
  onChatEvent(listener: (message: { streamId: string; event: ChatEvent }) => void): () => void;
}

export function useChat(
  bridge: ChatBridge | null,
  profileId: string | null,
  /// What the model should be told about the document, asked for at the moment a turn is sent.
  ///
  /// A function rather than a value because it must be read late: the user may select a passage,
  /// type a question, then change the selection before pressing Enter - and a retry minutes later
  /// should see the document as it is then, not as it was when the question was first asked.
  getContext: () => ChatContext = () => ({ kind: "none" }),
) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// What the model thought, for the turn in flight.
  ///
  /// Kept apart from `turns` on purpose: turns are the wire format, resent to the provider every
  /// message, and a model's own reasoning is not part of the conversation. It exists only so the
  /// panel has something to show when a turn ends having produced reasoning and no answer, which is
  /// how gpt-oss and DeepSeek-R1 sometimes finish.
  const [reasoning, setReasoning] = useState("");

  /// The stream whose events count. Everything from any other stream is dropped.
  ///
  /// A ref rather than state: the subscription below is registered once, and reading this through a
  /// closure over state would pin it to the value at subscription time - so every event would be
  /// compared against `null` and dropped.
  const activeStream = useRef<string | null>(null);

  /// Read through a ref so `run` does not change identity every time the selection moves, which
  /// would rebuild `send` and `retry` on every keystroke in the editor.
  const latestContext = useRef(getContext);
  useEffect(() => {
    latestContext.current = getContext;
  }, [getContext]);

  useEffect(() => {
    if (bridge === null) return;

    return bridge.onChatEvent((message) => {
      // Strict, because this is our own contract rather than a provider's response: an unexpected
      // shape means the two sides have drifted, and guessing at it would show the user nonsense.
      const parsed = ChatEventMessage.safeParse(message);
      if (!parsed.success) return;

      // A reply the user stopped, or one belonging to a conversation they have since cleared. Left
      // unchecked it would append itself to whatever they typed next.
      if (parsed.data.streamId !== activeStream.current) return;

      const event = parsed.data.event;
      if (event.type === "token") {
        setTurns((current) => appendToken(current, event.text));
        return;
      }
      if (event.type === "reasoning") {
        setReasoning((current) => current + event.text);
        return;
      }
      if (event.type === "error") {
        // The error goes beside the reply, not over it: tokens already on screen are the model's
        // actual words, and a partial answer is often worth reading.
        setError(event.message);
        return;
      }
      if (event.type === "end") {
        activeStream.current = null;
        setStreaming(false);
      }
      // `usage` is accepted and ignored for now - the context dial that will show it comes with the
      // context layer.
    });
  }, [bridge]);

  /// Sends one turn for a history that must already end in a question.
  const run = useCallback(
    async (history: Turn[]) => {
      if (bridge === null || profileId === null) return;

      setError(null);
      setReasoning("");
      setTurns(beginReply(history));
      setStreaming(true);

      const result = await bridge.sendChat(profileId, history, latestContext.current());
      if (!result.ok) {
        // The shell refused before anything was sent - an unconfigured profile, or a malformed
        // request. Nothing will stream, so the turn has to be ended here.
        activeStream.current = null;
        setStreaming(false);
        setError(
          result.reason === "no-such-profile"
            ? "That model is no longer configured. Choose another in Preferences."
            : "The message could not be sent.",
        );
        return;
      }

      activeStream.current = result.streamId;
    },
    [bridge, profileId],
  );

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      // A blank message, or a second one while a reply is still arriving. Both are the user pressing
      // Enter twice, and neither should reach a provider.
      if (prompt === "" || streaming) return;

      await run([...turns, { role: "user", content: prompt }]);
    },
    [run, streaming, turns],
  );

  /// Asks the last question again, dropping the answer it produced.
  const retry = useCallback(async () => {
    if (streaming) return;

    const history = historyWithoutReply(turns);
    if (history.length === 0) return;

    await run(history);
  }, [run, streaming, turns]);

  const stop = useCallback(async () => {
    const streamId = activeStream.current;
    if (streamId === null || bridge === null) return;

    await bridge.cancelChat(streamId);
    // Not ended here: the shell answers a cancellation with a final `end`, and ending it twice would
    // make the panel's state depend on which arrived first.
  }, [bridge]);

  /// Replaces the thread with a conversation loaded from disk.
  ///
  /// Whatever is still streaming stops counting first: a reply arriving into a conversation the user
  /// has just left would append itself to somebody else's words.
  const replace = useCallback((loaded: Turn[]) => {
    activeStream.current = null;
    setTurns(loaded);
    setError(null);
    setReasoning("");
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    // Whatever is still arriving stops counting the moment the thread is cleared.
    activeStream.current = null;
    setTurns([]);
    setError(null);
    setReasoning("");
    setStreaming(false);
  }, []);

  return { turns, streaming, error, reasoning, send, retry, stop, clear, replace };
}
