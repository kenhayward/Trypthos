"use strict";

const { randomUUID } = require("node:crypto");
const {
  READ_TOOL_NAME,
  buildChatRequest,
  completionsUrl,
  createSseDecoder,
  editFromToolArguments,
  formatEditBlock,
  parseStreamPayload,
  pathFromToolArguments,
} = require("@trypthos/domain");

/// How many times the model may ask to read a file in one turn.
///
/// A bound rather than a preference. Reading a file sends the whole conversation again, so an
/// unbounded loop is an unbounded bill on a hosted endpoint and an unbounded wait on a local one -
/// and a model that decides to read every file it was offered would do exactly that. Ten is more
/// than any sensible question needs and small enough to be survivable when one is not.
const MAX_READS_PER_TURN = 10;

/// Talking to the AI provider.
///
/// **In the main process, always.** The renderer sends a turn and receives tokens over IPC; it never
/// holds the API key and never opens a socket to a provider. A key in the renderer is a key in
/// devtools, in the network panel, and in any renderer crash dump - which is the whole reason this
/// boundary exists. Do not move a call across it to stream more simply.
///
/// The other rule here is quieter and easier to break: **no error path may repeat the key.** An error
/// message is shown to the user, written to a log, and pasted into a bug report - so a provider that
/// echoes the key back in a 401 body must not have that body forwarded verbatim. Every message
/// below is written here rather than taken from the response.

/// What a failing status means, in words the user can act on.
///
/// Written locally rather than passed through, because a provider's own message is untrusted text
/// that can contain anything - including the key that was just rejected.
function statusMessage(status, profile) {
  if (status === 401 || status === 403) {
    return `The endpoint rejected the API key for ${profile.label}. Check the key in Settings.`;
  }
  if (status === 404) {
    return `The endpoint has no model called ${profile.model}. Check the model in Settings.`;
  }
  if (status === 429) {
    return "The provider replied with too many requests. Wait a moment and try again.";
  }
  if (status >= 500) {
    return "The provider reported a server error. Try again in a moment.";
  }
  return `The request was refused (${status}).`;
}

function createChatProvider({ fetchImpl = globalThis.fetch, secrets, logger = console }) {
  /// Runs one turn, emitting events until the reply ends.
  ///
  /// Never rejects. A failure is an `error` event followed by nothing - the panel has one place to
  /// look, and a thrown exception crossing IPC would arrive as an opaque string.
  /// Runs one turn, following any file reads the model asks for.
  ///
  /// **This is where chat becomes a loop rather than a single request.** `propose_edit` is still
  /// structured output - the call IS the proposal and nothing is executed. `get_file_contents` is
  /// different in kind: the app carries it out and sends the result back, so the model can read a
  /// file and keep going.
  ///
  /// Two bounds hold that in place. `readFile` decides what may be read, and it answers only for
  /// paths the outline named - so the model's own path never reaches the filesystem unchecked. And
  /// `MAX_READS_PER_TURN` caps how many times round: an unbounded loop is an unbounded bill.
  async function run({ profile, turns, onEvent, signal, readFile = null }) {
    /// The conversation as the provider sees it, which grows as the loop runs. Never returned: the
    /// tool-call and tool-result messages exist for this turn only and are never stored, resent as
    /// history, or shown in the panel.
    const messages = [...turns];

    for (let round = 0; ; round += 1) {
      const reads = await runOnce({ profile, messages, onEvent, signal, readFile });
      if (reads === null) return; // the turn ended, one way or another

      // Told plainly rather than silently stopping: a model that thinks it is still gathering will
      // otherwise answer as though it had read everything it asked for.
      if (round + 1 >= MAX_READS_PER_TURN) {
        messages.push({
          role: "tool",
          tool_call_id: reads.id,
          content: "No more files can be read for this question. Answer with what you have.",
        });
        await runOnce({ profile, messages, onEvent, signal, readFile: null });
        return;
      }
    }
  }

  /// One request, and what to do with what came back.
  ///
  /// Returns null when the turn is over, or the tool call that has already been answered and needs
  /// another round.
  async function runOnce({ profile, messages, onEvent, signal, readFile }) {
    // Read here, used here, and never returned. The renderer asked for a profile by id; it has no
    // idea whether a key exists beyond the boolean the settings UI shows.
    const key = await secrets.getKey(profile.endpoint);

    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    // Absent rather than empty when there is no key: a local model served by Ollama or llama.cpp
    // needs none, and refusing to call would make the most private way to use Trypthos the one way
    // that does not work.
    if (key !== null && key !== "") headers.Authorization = `Bearer ${key}`;

    let response;
    try {
      response = await fetchImpl(completionsUrl(profile.endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(
          buildChatRequest(profile, messages, { canReadFiles: readFile !== null }),
        ),
        signal,
      });
    } catch {
      if (signal?.aborted) {
        onEvent({ type: "end" });
        return null;
      }
      // Deliberately not including the thrown message: a request error can carry the headers that
      // were sent, and those contain the key.
      logger.error("The chat endpoint could not be reached.");
      onEvent({
        type: "error",
        message: `${profile.label} could not be reached. Check the endpoint in Settings.`,
      });
      onEvent({ type: "end" });
      return null;
    }

    if (!response.ok || !response.body) {
      // The body is NOT read into the message. Some providers echo the rejected key back in it.
      logger.error(`The chat endpoint answered ${response.status}.`);
      onEvent({ type: "error", message: statusMessage(response.status, profile) });
      onEvent({ type: "end" });
      return null;
    }

    const reader = response.body.getReader();
    const decoder = createSseDecoder();
    const utf8 = new TextDecoder();

    /// The names of the tools called this round, by index, so a read can be told from a proposal.
    const toolNames = new Map();
    /// Tool call arguments, assembled by index as the fragments arrive.
    ///
    /// Held until the turn ends rather than parsed as they come: the arguments are a JSON object
    /// streamed as a string, so every prefix of one is invalid JSON and only the last is not.
    const toolArguments = new Map();

    /// Turns finished tool calls into the same block the fenced transport produces.
    ///
    /// Emitted as ordinary tokens, which is the point: downstream there is one representation of a
    /// proposed edit, not two differing only in how the model happened to phrase itself. The panel,
    /// the card, resolving the anchor and applying it are all untouched by this transport existing.
    ///
    /// A call that never finished, or asks for something unrecognised, is dropped in silence. The
    /// reply already on screen is worth more than the proposal that failed to arrive, and half an
    /// argument object is not something to offer anybody.
    function flushToolCalls() {
      for (const [index, json] of toolArguments) {
        // Reads are handled separately, and only after the stream has finished: this turns the
        // proposals into text.
        if (toolNames.get(index) === READ_TOOL_NAME) continue;

        const edit = editFromToolArguments(json);
        if (edit === null) {
          logger.error("A tool call could not be read as an edit, and was dropped.");
          continue;
        }
        onEvent({ type: "token", text: `\n\n${formatEditBlock(edit)}` });
      }
    }

    /// The first read the model asked for, answered and appended to the conversation.
    ///
    /// One at a time. A model that asked for three files in one message would have them served in
    /// order across the next rounds, and serving them all at once would make the cap meaningless.
    async function answerRead() {
      if (readFile === null) return null;

      for (const [index, json] of toolArguments) {
        if (toolNames.get(index) !== READ_TOOL_NAME) continue;

        const wanted = pathFromToolArguments(json);
        const id = `call_${randomUUID()}`;
        // Shown in the panel: a turn that pauses for several seconds while a file is read should
        // say what it is doing rather than look stuck.
        onEvent({ type: "tool", name: READ_TOOL_NAME, detail: wanted ?? "" });

        // The allowlist lives in `readFile`, which answers only for paths the outline named. A
        // refusal is told to the model rather than ending the turn: it can pick another file.
        const result = wanted === null ? { ok: false, reason: "bad-path" } : await readFile(wanted);

        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name: READ_TOOL_NAME, arguments: json } },
          ],
        });
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: result.ok
            ? result.content
            : `That file cannot be read. Only the files listed for this folder are available.`,
        });

        return { id };
      }

      return null;
    }

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        // `stream: true` matters: a multi-byte character split across two network reads would
        // otherwise decode as two replacement characters, which is how accented text arrives
        // mangled from a provider that is behaving perfectly.
        for (const payload of decoder.push(utf8.decode(value, { stream: true }))) {
          const event = parseStreamPayload(payload);

          if (event.type === "ignored") continue;
          if (event.type === "tool-call") {
            // The name arrives once, on the first fragment; the arguments arrive in pieces.
            if (event.name !== null) toolNames.set(event.index, event.name);
            toolArguments.set(
              event.index,
              (toolArguments.get(event.index) ?? "") + event.argumentsDelta,
            );
            continue;
          }
          if (event.type === "done") {
            flushToolCalls();
            const read = await answerRead();
            if (read !== null) return read;

            onEvent({ type: "end" });
            return null;
          }
          if (event.type === "error") {
            // A provider that streams an error has stopped answering. Waiting for more tokens would
            // hang the panel until the connection dropped. Anything already proposed still stands:
            // a complete call before the failure is a complete call.
            flushToolCalls();
            onEvent(event);
            onEvent({ type: "end" });
            return null;
          }
          onEvent(event);
        }
      }
    } catch {
      if (!signal?.aborted) {
        logger.error("The chat stream failed part-way through.");
        onEvent({ type: "error", message: "The reply stopped part-way through." });
      }
    } finally {
      // Best effort. The reader is already finished on the normal path.
      await reader.cancel?.().catch(() => {});
    }

    // Reached when the stream closed without a [DONE] sentinel - a dropped connection, or simply a
    // provider that does not send one. The panel has to be told the turn ended, or the stop button
    // stays up for ever.
    flushToolCalls();
    const read = await answerRead();
    if (read !== null) return read;

    onEvent({ type: "end" });
    return null;
  }

  return { run };
}

module.exports = { createChatProvider };
