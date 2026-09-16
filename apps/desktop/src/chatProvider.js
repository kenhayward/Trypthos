"use strict";

const { randomUUID } = require("node:crypto");
const {
  DEFAULT_TIMEOUT_MINUTES,
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  buildChatRequest,
  capRead,
  completionsUrl,
  contextCharacterBudget,
  createSseDecoder,
  editFromToolArguments,
  formatEditBlock,
  parseCompletionPayload,
  parseStreamPayload,
  pathFromToolArguments,
  readRequestIn,
  toolCallDetail,
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

/// What to tell the user when a model went quiet for longer than its timeout allows.
function timeoutMessage(profile, minutes) {
  const span = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `${profile.label} sent nothing for ${span}, so Trypthos stopped waiting. If this model needs longer, raise its timeout in Settings.`;
}

/// A clock that gives up on a reply after a stretch of SILENCE, not after a total duration.
///
/// Its own abort signal is what the request is made with. It aborts when the caller's signal does -
/// the user pressing Stop - or when `touch` has not been called for `ms`. Every piece of a reply calls
/// `touch`, so a long answer that keeps arriving is never cut off, while a model that has gone away
/// is given up on rather than left holding the stop button up.
///
/// **Why this exists at all.** Node's own `fetch` gave up after five minutes without a response,
/// whatever anybody wanted, so a large reasoning model thinking before its first token could never be
/// waited for. Requests now go through a stack with no limit of its own, and this is the limit - one
/// the user sets per model.
function createSilenceWatch({ ms, signal, timers }) {
  const controller = new AbortController();
  let timer = null;
  let stopped = false;
  let timedOut = false;

  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const touch = () => {
    if (stopped) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      timedOut = true;
      controller.abort();
    }, ms);
  };

  const stop = () => {
    stopped = true;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    signal?.removeEventListener("abort", onAbort);
  };

  touch();
  return { signal: controller.signal, touch, stop, timedOut: () => timedOut };
}

/// How much of a request or a response a trace carries, in characters.
///
/// A trace crosses IPC and is held by the renderer for as long as the conversation is open, and a
/// request carries whole attached documents. A million characters is far more than a reply that went
/// wrong needs to be read, and small enough to carry without a second thought.
const TRACE_TEXT_LIMIT = 1_000_000;

/// What replaces the API key wherever it appears in a trace.
const KEY_REMOVED = "[key removed]";

/// Everything one request sent and received, for the conversation log.
///
/// Sent at most once, through `onTrace`. **The key is removed from every string before it goes**:
/// the headers are never recorded, but an endpoint can echo the key anywhere in what it sends back,
/// and a trace is shown in a tab a user can copy from.
function createTrace({ round, url, onTrace }) {
  const record = { round, url, request: "", status: null, response: "", notes: [] };
  let key = null;
  let sent = false;
  /// Characters that arrived after the response reached the limit, counted rather than kept.
  let dropped = 0;
  /// Kept past the limit by this much, so a key straddling the cut is still whole when it is removed.
  const MARGIN = 1024;

  const clean = (text) => (key === null || key === "" ? text : text.split(key).join(KEY_REMOVED));
  const capped = (text, extra = 0) => {
    const over = Math.max(0, text.length - TRACE_TEXT_LIMIT) + extra;
    return over === 0 ? text : `${text.slice(0, TRACE_TEXT_LIMIT)}\n\n[${over} characters not shown]`;
  };

  return {
    record,
    redact(value) {
      key = value;
    },
    append(text) {
      const room = Math.max(0, TRACE_TEXT_LIMIT + MARGIN - record.response.length);
      record.response += text.slice(0, room);
      dropped += Math.max(0, text.length - room);
    },
    note(text) {
      record.notes.push(text);
    },
    send() {
      if (sent || onTrace === null) return;
      sent = true;
      onTrace({
        round: record.round,
        url: clean(record.url),
        request: capped(clean(record.request)),
        status: record.status,
        response: capped(clean(record.response), dropped),
        notes: record.notes.map(clean),
      });
    },
  };
}

/// The body of a refused response, or nothing if it cannot be read.
async function bodyText(response) {
  try {
    return typeof response.text === "function" ? await response.text() : "";
  } catch {
    return "";
  }
}

function createChatProvider({
  fetchImpl = globalThis.fetch,
  secrets,
  logger = console,
  /// Injected so a ten-minute wait can be a step in a test rather than ten minutes.
  timers = globalThis,
}) {
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
  ///
  /// `onTrace`, when given, receives each request as it went and came back - see `createTrace`.
  async function run({
    profile,
    turns,
    onEvent,
    signal,
    readFile = null,
    callTool = null,
    onTrace = null,
  }) {
    /// The conversation as the provider sees it, which grows as the loop runs. Never returned: the
    /// tool-call and tool-result messages exist for this turn only and are never stored, resent as
    /// history, or shown in the panel.
    const messages = [...turns];

    for (let round = 0; ; round += 1) {
      const reads = await runOnce({
        profile,
        messages,
        onEvent,
        signal,
        readFile,
        callTool,
        onTrace,
        index: round,
      });
      if (reads === null) return; // the turn ended, one way or another

      // Told plainly rather than silently stopping: a model that thinks it is still gathering will
      // otherwise answer as though it had read everything it asked for.
      if (round + 1 >= MAX_READS_PER_TURN) {
        const enough = "No more files can be read for this question. Answer with what you have.";
        // Said in whichever shape the model has been speaking. A `tool` message to an endpoint
        // that never sent a tool call is a message it has no idea what to do with.
        messages.push(
          reads.kind === "tool"
            ? { role: "tool", tool_call_id: reads.id, content: enough }
            : { role: "user", content: enough },
        );
        await runOnce({
          profile,
          messages,
          onEvent,
          signal,
          readFile: null,
          callTool: null,
          onTrace,
          index: round + 1,
        });
        return;
      }
    }
  }

  /// One request, and what to do with what came back - watched for silence.
  ///
  /// Returns null when the turn is over, or the tool call that has already been answered and needs
  /// another round. The watch is stopped however this ends: a timer left running would fire an error
  /// into a conversation that finished long ago.
  async function runOnce({ onTrace, index, ...round }) {
    const minutes = round.profile.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
    const watch = createSilenceWatch({ ms: minutes * 60_000, signal: round.signal, timers });
    const trace = createTrace({ round: index, url: completionsUrl(round.profile.endpoint), onTrace });
    // The trace goes out BEFORE `end`: the panel stops listening to a stream once it has ended, so a
    // trace sent after it would be dropped.
    const onEvent = (event) => {
      if (event.type === "end") trace.send();
      round.onEvent(event);
    };
    try {
      return await runWatched({ ...round, onEvent, watch, minutes, trace });
    } finally {
      watch.stop();
      // A round that continues into another request never sends `end`; this is where its trace goes.
      trace.send();
    }
  }

  async function runWatched({
    profile,
    messages,
    onEvent,
    signal,
    readFile,
    callTool,
    watch,
    minutes,
    trace,
  }) {
    /// How a request that ended early is reported: quietly when the user stopped it, as a timeout
    /// when the model went silent, and otherwise as whatever went wrong.
    const failure = (fallback) => {
      if (signal?.aborted) return null;
      if (watch.timedOut()) {
        logger.error("The chat endpoint sent nothing for longer than its timeout.");
        return timeoutMessage(profile, minutes);
      }
      return fallback;
    };

    // Read here, used here, and never returned. The renderer asked for a profile by id; it has no
    // idea whether a key exists beyond the boolean the settings UI shows.
    const key = await secrets.getKey(profile.endpoint);
    // So the trace can take the key out of anything the endpoint sends back, before it is sent.
    trace.redact(key);

    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    // Absent rather than empty when there is no key: a local model served by Ollama or llama.cpp
    // needs none, and refusing to call would make the most private way to use Trypthos the one way
    // that does not work.
    if (key !== null && key !== "") headers.Authorization = `Bearer ${key}`;

    let response;
    try {
      const body = buildChatRequest(profile, messages, {
        canReadFiles: readFile !== null,
        canExploreFolder: callTool !== null,
        canActOnFolder: callTool !== null,
      });
      // The body, never the headers: the headers carry the key.
      trace.record.request = JSON.stringify(body, null, 2);
      response = await fetchImpl(completionsUrl(profile.endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: watch.signal,
      });
    } catch {
      // Deliberately not including the thrown message: a request error can carry the headers that
      // were sent, and those contain the key.
      const message = failure(`${profile.label} could not be reached. Check the endpoint in Settings.`);
      if (message !== null) {
        if (!watch.timedOut()) logger.error("The chat endpoint could not be reached.");
        onEvent({ type: "error", message });
      }
      onEvent({ type: "end" });
      return null;
    }
    // The answer has begun: the clock restarts rather than counting the wait for it as silence.
    watch.touch();
    trace.record.status = response.status;

    if (!response.ok || (profile.stream !== false && !response.body)) {
      // The body is NOT read into the message. Some providers echo the rejected key back in it. It
      // IS read into the trace, which removes the key, because it is what says why the request was
      // refused - and a refusal nobody can see the reason for is the one that cannot be fixed.
      if (!response.ok) trace.append(await bodyText(response));
      logger.error(`The chat endpoint answered ${response.status}.`);
      onEvent({ type: "error", message: statusMessage(response.status, profile) });
      onEvent({ type: "end" });
      return null;
    }

    /// The names of the tools called this round, by index, so a read can be told from a proposal.
    const toolNames = new Map();
    /// Tool call arguments, assembled by index as the fragments arrive.
    ///
    /// Held until the turn ends rather than parsed as they come: the arguments are a JSON object
    /// streamed as a string, so every prefix of one is invalid JSON and only the last is not.
    const toolArguments = new Map();

    /// Everything the model has said this round, for the fenced read transport to look through.
    let replyText = "";

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
        // Only proposals become text. Anything the app CARRIES OUT - reading a file, listing a
        // folder, searching, comparing - is answered after the stream has finished and fed back as
        // a tool result, so it must not be flushed as an edit here.
        if (toolNames.get(index) !== EDIT_TOOL_NAME) continue;

        const edit = editFromToolArguments(json);
        if (edit === null) {
          logger.error("A tool call could not be read as an edit, and was dropped.");
          trace.note(`A ${EDIT_TOOL_NAME} call could not be read as an edit, and was dropped.`);
          continue;
        }
        onEvent({ type: "token", text: `\n\n${formatEditBlock(edit)}` });
      }
    }

    /// The first read the model asked for, answered and appended to the conversation.
    ///
    /// One at a time. A model that asked for three files in one message would have them served in
    /// order across the next rounds, and serving them all at once would make the cap meaningless.
    /// The first tool call the app CARRIES OUT, answered and appended to the conversation.
    ///
    /// One at a time. A model that asked for three things in one message has them served in order
    /// across the next rounds, and serving them all at once would make `MAX_READS_PER_TURN`
    /// meaningless - which is the bound on how much one question can cost.
    ///
    /// `propose_edit` is deliberately not here: it is structured OUTPUT, the call IS the proposal,
    /// and nothing is carried out. These are the other kind - the app does the thing and sends the
    /// result back, which is what makes a turn a loop.
    async function answerToolCall() {
      for (const [index, json] of toolArguments) {
        const name = toolNames.get(index);
        if (name === undefined || name === EDIT_TOOL_NAME) continue;

        const result = await carryOut(name, json);
        // A name nothing carries out. Told to the model rather than ignored: a tool call that
        // vanishes leaves it waiting for an answer that is never coming.
        if (result === null) {
          trace.note(`A call to ${name} was not carried out: nothing here answers to that name.`);
          continue;
        }
        trace.note(`${name} was carried out, and its result sent back in the next request.`);

        const id = `call_${randomUUID()}`;
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: json } }],
        });
        messages.push({ role: "tool", tool_call_id: id, content: result });

        return { kind: "tool", id };
      }

      return null;
    }

    /// A file the model read, held to this model's budget - the one attachments get.
    ///
    /// Reported to the panel when it had to be cut, straight after the `tool` event for the read, so
    /// the call that read it can be marked. Whole files report nothing.
    function fitted(content) {
      const read = capRead(content, contextCharacterBudget(profile.contextWindow ?? null));
      if (read.cut !== null) onEvent({ type: "tool-cut", ...read.cut });
      return read.content;
    }

    /// Does one thing the model asked for, and answers with what to tell it.
    ///
    /// Null means "nothing here carries out that name", which is different from a refusal: a
    /// refusal is an answer the model can act on, and this is the app not recognising the request.
    async function carryOut(name, json) {
      if (name === READ_TOOL_NAME) {
        if (readFile === null) return null;

        const wanted = pathFromToolArguments(json);
        // Shown in the panel: a turn that pauses for several seconds should say what it is doing
        // rather than look stuck.
        onEvent({ type: "tool", name, detail: wanted ?? "" });

        // The allowlist lives in `readFile`, which answers only for paths the outline named. A
        // refusal is told to the model rather than ending the turn: it can pick another file.
        const result = wanted === null ? { ok: false } : await readFile(wanted);
        return result.ok
          ? fitted(result.content)
          : "That file cannot be read. Only the files listed for this folder are available.";
      }

      if (callTool === null) return null;
      const done = await callTool(name, json);
      if (done === null) return null;

      // What it was aimed at, so the panel's list of calls says what was searched or listed. Worked
      // out here from the arguments: the renderer never sees them, and `create_file`'s carry a
      // whole file.
      onEvent({ type: "tool", name, detail: toolCallDetail(name, json) });
      return done.content;
    }

    /// A file the model asked for in a fenced block, answered and appended to the conversation.
    ///
    /// The fallback for endpoints with no tool calling, where the outline would otherwise be a menu
    /// nobody can order from. Tried after the tool path, and independently of it: a model that
    /// writes a block despite having the tool is asking for a file either way, and refusing on a
    /// technicality would be refusing the thing it plainly meant.
    ///
    /// **What may be read is still decided by `readFile`**, which answers only for paths the
    /// outline named. This transport changes how a request is written, never what it may reach.
    async function answerFencedRead(reply) {
      if (readFile === null) return null;

      const wanted = readRequestIn(reply);
      if (wanted === null) return null;

      // The same event the tool path emits, so the panel's line of files reads the same however the
      // model asked.
      onEvent({ type: "tool", name: READ_TOOL_NAME, detail: wanted });
      const result = await readFile(wanted);

      // Ordinary roles, not tool roles: this exists precisely because the endpoint has no tool
      // calling, so a `tool` message would be the one shape it cannot take.
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content: result.ok
          ? `Here is ${wanted}:\n\n${fitted(result.content)}`
          : "That file cannot be read. Only the files listed for this folder are available.",
      });

      // What streamed was a request, not an answer. The panel drops it and the next round writes the
      // real reply in its place - otherwise the user reads the model's bookkeeping.
      trace.note(
        `The reply asked to read ${wanted} in a fenced block, so it was cleared from the panel and the file was sent back.`,
      );
      onEvent({ type: "reset" });
      return { kind: "fenced" };
    }

    if (profile.stream === false) {
      let events;
      try {
        const payload = await response.json();
        trace.append(JSON.stringify(payload, null, 2));
        events = parseCompletionPayload(payload);
      } catch {
        const message = failure("The reply could not be read.");
        if (message !== null) {
          if (!watch.timedOut()) logger.error("The chat endpoint returned an unreadable response.");
          onEvent({ type: "error", message });
        }
        onEvent({ type: "end" });
        return null;
      }
      // The whole reply is in. Carrying out a tool it asked for is the app's work, not the model's
      // silence, so it is not timed.
      watch.stop();

      for (const event of events) {
        if (event.type === "ignored") continue;
        if (event.type === "tool-call") {
          if (event.name !== null) toolNames.set(event.index, event.name);
          toolArguments.set(
            event.index,
            (toolArguments.get(event.index) ?? "") + event.argumentsDelta,
          );
          continue;
        }
        if (event.type === "error") {
          flushToolCalls();
          onEvent(event);
          onEvent({ type: "end" });
          return null;
        }
        if (event.type === "token") replyText += event.text;
        onEvent(event);
      }

      flushToolCalls();
      const read = await answerToolCall();
      if (read !== null) return read;

      const fenced = await answerFencedRead(replyText);
      if (fenced !== null) return fenced;

      onEvent({ type: "end" });
      return null;
    }

    const reader = response.body.getReader();
    const decoder = createSseDecoder();
    const utf8 = new TextDecoder();

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // A piece of the reply arrived: the model is still working, so the silence starts again.
        watch.touch();

        // `stream: true` matters: a multi-byte character split across two network reads would
        // otherwise decode as two replacement characters, which is how accented text arrives
        // mangled from a provider that is behaving perfectly.
        const text = utf8.decode(value, { stream: true });
        // As it arrived, before anything is made of it: the trace exists to check what the panel
        // made of it.
        trace.append(text);
        for (const payload of decoder.push(text)) {
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
            // The reply is complete; any tool it asked for is the app's work, not timed silence.
            watch.stop();
            flushToolCalls();
            const read = await answerToolCall();
            if (read !== null) return read;

            const fenced = await answerFencedRead(replyText);
            if (fenced !== null) return fenced;

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
          // Kept so a reply can be re-read at the end: the fenced transport asks for a file by
          // writing one, and nothing else here has the whole text.
          if (event.type === "token") replyText += event.text;
          onEvent(event);
        }
      }
    } catch {
      const message = failure("The reply stopped part-way through.");
      if (message !== null) {
        if (!watch.timedOut()) logger.error("The chat stream failed part-way through.");
        onEvent({ type: "error", message });
      }
    } finally {
      // Best effort. The reader is already finished on the normal path.
      await reader.cancel?.().catch(() => {});
    }
    watch.stop();

    // Reached when the stream closed without a [DONE] sentinel - a dropped connection, or simply a
    // provider that does not send one. The panel has to be told the turn ended, or the stop button
    // stays up for ever.
    flushToolCalls();
    const read = await answerToolCall();
    if (read !== null) return read;

    onEvent({ type: "end" });
    return null;
  }

  return { run };
}

module.exports = { TRACE_TEXT_LIMIT, createChatProvider };
