"use strict";

const {
  buildChatRequest,
  completionsUrl,
  createSseDecoder,
  editFromToolArguments,
  formatEditBlock,
  parseStreamPayload,
} = require("@trypthos/domain");

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
    return `The endpoint rejected the API key for ${profile.label}. Check the key in Preferences.`;
  }
  if (status === 404) {
    return `The endpoint has no model called ${profile.model}. Check the model in Preferences.`;
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
  async function run({ profile, turns, onEvent, signal }) {
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
        body: JSON.stringify(buildChatRequest(profile, turns)),
        signal,
      });
    } catch {
      if (signal?.aborted) return void onEvent({ type: "end" });
      // Deliberately not including the thrown message: a request error can carry the headers that
      // were sent, and those contain the key.
      logger.error("The chat endpoint could not be reached.");
      onEvent({
        type: "error",
        message: `${profile.label} could not be reached. Check the endpoint in Preferences.`,
      });
      return;
    }

    if (!response.ok || !response.body) {
      // The body is NOT read into the message. Some providers echo the rejected key back in it.
      logger.error(`The chat endpoint answered ${response.status}.`);
      onEvent({ type: "error", message: statusMessage(response.status, profile) });
      return;
    }

    const reader = response.body.getReader();
    const decoder = createSseDecoder();
    const utf8 = new TextDecoder();

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
      for (const json of toolArguments.values()) {
        const edit = editFromToolArguments(json);
        if (edit === null) {
          logger.error("A tool call could not be read as an edit, and was dropped.");
          continue;
        }
        onEvent({ type: "token", text: `\n\n${formatEditBlock(edit)}` });
      }
      toolArguments.clear();
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
            toolArguments.set(
              event.index,
              (toolArguments.get(event.index) ?? "") + event.argumentsDelta,
            );
            continue;
          }
          if (event.type === "done") {
            flushToolCalls();
            onEvent({ type: "end" });
            return;
          }
          if (event.type === "error") {
            // A provider that streams an error has stopped answering. Waiting for more tokens would
            // hang the panel until the connection dropped. Anything already proposed still stands:
            // a complete call before the failure is a complete call.
            flushToolCalls();
            onEvent(event);
            onEvent({ type: "end" });
            return;
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
    onEvent({ type: "end" });
  }

  return { run };
}

module.exports = { createChatProvider };
