import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  READ_TOOL_NAME,
  splitReply,
  type ChatProfile,
  type ChatSessionSummary,
  type EditTarget,
  type ProposedEdit,
} from "@trypthos/domain";
import { useCodeHighlighting } from "../hooks/useCodeHighlighting";
import { linkifyPaths } from "../lib/replyLinks";
import { renderMarkdown } from "../lib/markdown";
import { contextUsage } from "@trypthos/domain";
import type { ToolCall, Turn } from "../lib/conversation";
import ChatEditCard from "./ChatEditCard";
import ChatHistoryMenu from "./ChatHistoryMenu";
import ChatModelPicker from "./ChatModelPicker";
import ChatStatsMenu from "./ChatStatsMenu";
import type { ReplyStats } from "../lib/replyStats";
import ChatScope from "./ChatScope";
import { TREE_FILE_TYPE } from "../lib/treeDrag";

interface Props {
  width: number;
  /// Takes whatever room the row leaves rather than `width`: with the editor hidden, the rail and the
  /// dividers beside it have width too, and a chat sized without them would run off the window.
  fill?: boolean;
  onCollapse: () => void;
  models: readonly ChatProfile[];
  selectedId: string | null;
  onSelectModel: (id: string) => void;
  turns: readonly Turn[];
  /// The file types the user has turned on, so a fenced code block in a reply is coloured on the
  /// same terms one in their own document is.
  fileTypes: readonly string[];
  /// Which folder the paths a model names are in, so they can be turned into links. Null when no
  /// folder is open, where a path names nothing.
  linkWorkspaceId?: string | null;
  streaming: boolean;
  error: string | null;
  /// The tool call being carried out on the model's behalf, if one is.
  activity: ToolCall | null;
  /// What the next request will already carry, and the window it has to fit in.
  ///
  /// The count arrives measured rather than measured here: it needs the system prompt and the
  /// resolved document context, which live above this panel. What is typed is added here, because
  /// that is the part this component owns.
  context: { tokens: number; limit: number | null };
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  /// Opens Settings on the chat models page, which is the only way out of having no model configured.
  onConfigure: () => void;
  /// Where a proposed edit would land in the document as it is NOW, or why it cannot.
  ///
  /// Passed in rather than computed here because the panel does not hold the document. Called on
  /// every render, so a heading renamed while the user reads the proposal turns Apply off.
  resolveEdit: (edit: ProposedEdit) => EditTarget;
  /// Applies an edit the user accepted. Returns true if it landed.
  onApplyEdit: (edit: ProposedEdit) => boolean;
  /// Saved conversations, newest first.
  chats: readonly ChatSessionSummary[];
  /// The saved chat on screen, if this thread came from one.
  openChatId: string | null;
  /// Set when the chat that was opened names a file that is not there any more. The conversation
  /// still opens - it is the user's own words - and this says what it was about.
  missingFile: string | null;
  /// The folder a reopened conversation was mapping, when that folder is not open. Null otherwise.
  missingFolder?: string | null;
  onSaveChat: () => void;
  /// How each reply in this conversation went, oldest first, for the statistics popover.
  replyStats?: readonly ReplyStats[];
  /// Opens the conversation log in a tab of its own.
  onOpenLog?: () => void;
  /// Puts text on the clipboard. Injected so a test can see what was copied; the browser's own
  /// clipboard otherwise, which the renderer may write to after a click.
  copyText?: (text: string) => Promise<void>;
  /// What chat can see beyond the open document.
  scope: {
    attachments: readonly string[];
    files: readonly string[];
    includeFolder: boolean;
    /// The folder that would be sent, named on the button - it is chosen on the far side of the
    /// window, so a button saying only "Folder" would be one whose meaning has to be remembered.
    folderPath: string;
    canUseFolder: boolean;
    onToggleFolder: (include: boolean) => void;
    onNeedFiles: () => void;
    onAttach: (path: string) => void;
    onDetach: (path: string) => void;
    /// Why the last file could not be attached, as a failure reason, or null.
    attachFailure?: string | null;
    /// Attachments that do not fit the model's budget whole - see `ChatScope`.
    cutShort?: Readonly<Record<string, "partial" | "none">>;
  };
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

/// One stretch of a reply's prose, rendered.
///
/// Sanitised in `renderMarkdown` (DOMPurify) before injection: a model's output is text the app did
/// not write, and is treated as data rather than markup for the same reason a workspace file is.
///
/// Memoised on its text, and the markup object with it. React 19 sets `innerHTML` again whenever the
/// object it is handed is a new one - so an inline `{ __html }` rewrote every reply on every render of
/// the panel, which is every keystroke in the message box, and wiped the colouring drawn into its code.
const ReplyMarkdown = memo(function ReplyMarkdown({ text }: { text: string }) {
  const markup = useMemo(() => ({ __html: renderMarkdown(text) }), [text]);
  return (
    <div
      className="chat-md break-words [&_a]:text-leaf [&_a]:underline [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_pre]:overflow-x-auto"
      dangerouslySetInnerHTML={markup}
    />
  );
});

/// Right panel: AI chat.
///
/// Ported from Diariz - the layout, the thread, and the send button that becomes a stop button are
/// all recognisable from it. What changed is underneath: there is no server, so the provider call
/// happens in the MAIN process and streams back over IPC. The renderer never holds an API key and
/// never opens a socket to a provider.
///
/// This is presentation only. The conversation and the stream live in `useChat`, so the awkward
/// cases - a token arriving after the user stopped the reply, a retry - can be tested without
/// rendering anything.
export default function ChatPanel({
  width,
  fill = false,
  onCollapse,
  models,
  selectedId,
  onSelectModel,
  turns,
  fileTypes,
  linkWorkspaceId = null,
  streaming,
  error,
  activity,
  context,
  onSend,
  onStop,
  onClear,
  onConfigure,
  resolveEdit,
  onApplyEdit,
  chats,
  openChatId,
  missingFile,
  missingFolder = null,
  onSaveChat,
  replyStats = [],
  onOpenLog,
  copyText = (text) => navigator.clipboard.writeText(text),
  scope,
  onOpenChat,
  onDeleteChat,
}: Props) {
  const { t, i18n } = useTranslation();
  /// The name of the saved conversation on screen, or undefined when it has not been saved.
  const openTitle = chats.find((chat) => chat.id === openChatId)?.title;
  /// Character counts in a cut read's warning, grouped the way the reader's language groups them.
  const numbers = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const [input, setInput] = useState("");
  /// Which proposals have been applied, so a card cannot be clicked twice.
  ///
  /// Keyed by turn and position within it. Cleared with the thread, since the keys mean nothing
  /// once the turns behind them are gone.
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);
  /// True while a file from the folder browser is held over the panel, so it can say it will take
  /// it - a drop target that gives no sign until the drop is one people do not try.
  const [dropping, setDropping] = useState(false);
  /// How the last press of Copy response went, shown briefly, or null.
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

  /// The most recent reply with something in it - what Copy response copies. Its markdown as the
  /// model wrote it, not the text the panel rendered from it, so pasting it into a document gives
  /// the same document.
  const lastReply = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.content !== "");

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyReply = async () => {
    if (lastReply === undefined) return;
    try {
      await copyText(lastReply.content);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  /// Whether a drag is something this panel takes: a file from the tree, and only when a question
  /// could be asked with it. The same conditions the Attach button has.
  const takesDrop = (event: React.DragEvent) =>
    models.length > 0 && !streaming && Array.from(event.dataTransfer.types).includes(TREE_FILE_TYPE);

  // A reply arrives a token at a time, so this runs often. It is cheap when it does: a coloured
  // block is marked, and a pass over an unchanged thread is one query.
  useCodeHighlighting(threadRef, fileTypes, turns);

  // The file paths a reply names, made clickable. Runs after every token like the highlighting
  // beside it, and is cheap for the same reason: a span it has already looked at is marked, so a
  // pass over an unchanged thread walks the spans and does nothing.
  //
  // The chat panel only. Preview renders what the USER wrote, and turning their code spans into
  // links would change how their own prose reads.
  useEffect(() => {
    if (threadRef.current !== null) linkifyPaths(threadRef.current, fileTypes, linkWorkspaceId);
  }, [fileTypes, linkWorkspaceId, turns]);

  /// Whether the thread should keep following the newest message.
  ///
  /// True while the user is reading the end of the conversation, which is nearly always. It goes
  /// false the moment they scroll away from the bottom, and that is the whole point: a thread that
  /// jumps to the newest token every time one arrives cannot be read while it is being written, and
  /// a long answer arrives at several tokens a second. The part they were looking at was being
  /// snatched away before they could finish the sentence.
  ///
  /// A ref rather than state: it changes on every scroll event, and nothing renders differently for
  /// it.
  const following = useRef(true);

  /// How close to the bottom still counts as being at it.
  ///
  /// Not zero. Sub-pixel rounding leaves a fraction of a pixel behind after a programmatic scroll,
  /// and a threshold of exactly zero would turn the panel's own scroll into the user scrolling away.
  const FOLLOW_SLACK = 24;

  const onThreadScroll = () => {
    const thread = threadRef.current;
    if (thread === null) return;
    following.current =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight <= FOLLOW_SLACK;
  };

  // Keep the thread on the newest message as tokens stream in - unless the user has scrolled away
  // to read something, in which case they stay where they put themselves.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread === null) return;

    if (!following.current) return;

    thread.scrollTop = thread.scrollHeight;
  }, [turns]);

  const send = () => {
    const prompt = input.trim();
    if (prompt === "" || streaming) return;

    // Asking is not reading. Somebody who scrolled up to re-read an answer and then typed a question
    // wants to see the reply to it, so their own question brings the thread back to the bottom.
    // Decided here rather than by looking at the turns, because the turn that follows a question is
    // the empty assistant one being waited on - the question is not the last thing in the thread by
    // the time the effect runs.
    following.current = true;
    onSend(prompt);
    setInput("");
  };

  return (
    <aside
      aria-label={t("chat.title")}
      style={fill ? undefined : { width }}
      className={`relative flex ${fill ? "min-w-0 grow" : "shrink-0"} flex-col overflow-hidden bg-panel`}
      // A file dragged from the folder browser is added to the conversation, as Attach a file does.
      // Anything else - text, a file from outside the app - is not taken: this panel reads files by
      // their path in an open folder, and only the tree's own drag type carries one.
      onDragOver={(event) => {
        if (!takesDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Leaving for a child of the panel is not leaving the panel.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        if (!takesDrop(event)) return;
        event.preventDefault();
        const path = event.dataTransfer.getData(TREE_FILE_TYPE);
        if (path !== "") scope.onAttach(path);
      }}
    >
      {dropping && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-app/80 text-ui text-ink"
        >
          {t("chat.scope.dropHere")}
        </div>
      )}
      <h2 className="relative flex items-center gap-1 border-b border-rule px-3 py-2 text-xs font-semibold tracking-wide text-ink-4 uppercase">
        {t("chat.title")}
        <span className="ml-auto flex items-center gap-1">
          <ChatModelPicker
            models={models}
            selectedId={selectedId}
            disabled={streaming}
            onSelect={onSelectModel}
          />
          <ChatHistoryMenu
            chats={chats}
            openId={openChatId}
            disabled={streaming}
            onOpen={(id) => {
              setApplied(new Set());
              onOpenChat(id);
            }}
            onDelete={onDeleteChat}
          />
          <button
            type="button"
            onClick={onSaveChat}
            disabled={turns.length === 0 || streaming}
            aria-label={t("chat.history.save")}
            title={t("chat.history.save")}
            className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
          </button>
          <ChatStatsMenu replyStats={replyStats} models={models} onOpenLog={onOpenLog} />
          <button
            type="button"
            onClick={() => void copyReply()}
            // Not while a reply is arriving: half an answer on the clipboard looks like the whole one.
            disabled={lastReply === undefined || streaming}
            aria-label={t("chat.copy.label")}
            title={t("chat.copy.label")}
            className={
              copied === "failed"
                ? "rounded p-1 text-danger hover:bg-hover disabled:opacity-40"
                : "rounded p-1 text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
            }
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {copied === "copied" ? (
                <path d="M5 12l5 5L20 7" />
              ) : (
                <>
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                </>
              )}
            </svg>
          </button>
          {/* Said as well as shown, since a changed icon is not something a screen reader reads. */}
          <span role="status" className="sr-only">
            {copied === "copied"
              ? t("chat.copy.done")
              : copied === "failed"
                ? t("chat.copy.failed")
                : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setApplied(new Set());
              onClear();
            }}
            disabled={turns.length === 0 || streaming}
            aria-label={t("chat.clear")}
            title={t("chat.clear")}
            className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t("panels.collapseChat")}
            title={t("panels.collapseChat")}
            className="rounded p-1 text-ink-4 hover:bg-hover hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </span>
      </h2>

      <div
        ref={threadRef}
        data-testid="chat-thread"
        onScroll={onThreadScroll}
        className="min-h-0 grow space-y-3 overflow-y-auto p-3"
      >
        {/* Which saved conversation this is, once it has been saved or opened - the only place the
            name given to it is shown outside the list. */}
        {openTitle !== undefined && turns.length > 0 && (
          <p className="truncate text-xs text-ink-4" title={openTitle}>
            {t("chat.history.openTitle", { title: openTitle })}
          </p>
        )}
        {models.length === 0 ? (
          <div className="text-ui text-ink-4">
            <p>{t("chat.notConfigured")}</p>
            <button
              type="button"
              onClick={onConfigure}
              className="mt-2 rounded border border-rule px-2 py-1 text-ui text-ink"
            >
              {t("chat.openSettings")}
            </button>
          </div>
        ) : turns.length === 0 ? (
          <p className="text-ui text-ink-4">{t("chat.intro")}</p>
        ) : (
          turns.map((turn, index) => {
            // Nothing has arrived yet for the reply being waited on. Without this the panel shows an
            // empty bubble, which reads as an answer of nothing rather than as an answer coming.
            const waiting =
              turn.role === "assistant" &&
              turn.content === "" &&
              streaming &&
              index === turns.length - 1;

            return (
              <div
                key={index}
                data-role={turn.role}
                className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] rounded-lg bg-accent-strong px-3 py-2 text-ui text-white"
                      : "max-w-full min-w-0 rounded-lg border border-rule bg-app px-3 py-2 text-ui text-ink"
                  }
                >
                  {turn.role === "assistant" ? (
                    waiting ? (
                      <span className="text-ink-4">
                        {activity === null
                          ? t("chat.thinking")
                          : activity.name === READ_TOOL_NAME && activity.detail !== ""
                            ? t("chat.readingFile", { path: activity.detail })
                            : t("chat.usingTool", { tool: activity.name })}
                      </span>
                    ) : turn.content === "" && !streaming ? (
                      // A turn that finished having produced nothing. Reasoning models do this:
                      // they think, and then stop. An empty bubble tells the user nothing at all,
                      // so say what happened and show the thinking if there is any.
                      <p className="text-ui text-ink-4">{t("chat.noAnswer")}</p>
                    ) : streaming && index === turns.length - 1 ? (
                      // Still arriving. Rendered as plain text rather than split into cards: a
                      // half-written block can transiently look complete, and a card that appears
                      // mid-sentence could be applied with truncated content.
                      <span className="whitespace-pre-wrap break-words">{turn.content}</span>
                    ) : (
                      <div className="space-y-2">
                        {/* `complete`: this branch only runs for a turn that has finished, so a
                            block the model never closed is a forgotten fence rather than a
                            half-written one. */}
                        {splitReply(turn.content, { complete: true }).map((part, at) =>
                          part.kind === "edit" ? (
                            <ChatEditCard
                              key={at}
                              edit={part.edit}
                              target={resolveEdit(part.edit)}
                              state={applied.has(`${index}:${at}`) ? "applied" : "offered"}
                              onApply={() => {
                                if (!onApplyEdit(part.edit)) return;
                                setApplied((was) => new Set(was).add(`${index}:${at}`));
                              }}
                            />
                          ) : (
                            <ReplyMarkdown key={at} text={part.text} />
                          ),
                        )}
                      </div>
                    )
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{turn.content}</span>
                  )}

                  {/* What the model thought, per reply and closed. `details` rather than a
                      hand-rolled toggle: it brings keyboard behaviour and the open state to
                      assistive technology for free, and the panel already used one here.

                      PLAIN TEXT, and deliberately not through the renderer or the part splitter. A
                      reply's content becomes edit cards with an Apply button, and a model reasoning
                      about whether to propose an edit writes something that looks exactly like one -
                      so routing thinking through that would offer Apply for a change the model
                      never proposed. */}
                  {turn.role === "assistant" && (turn.reasoning ?? "") !== "" && (
                    <details data-testid="turn-reasoning" className="mt-1.5 text-xs text-ink-4">
                      <summary className="cursor-pointer">{t("chat.showThinking")}</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
                        {turn.reasoning}
                      </pre>
                      {/* Said rather than left to look like a train of thought that stops
                          mid-sentence, which is what a silent truncation reads as. */}
                      {turn.reasoningTruncated === true && (
                        <p className="mt-1 text-2xs text-faint">{t("chat.thinkingShortened")}</p>
                      )}
                    </details>
                  )}

                  {/* Every tool call this reply made, folded away beside the thinking and built the
                      same way, so the two read as a pair. Only once the reply has something to
                      show beside: while the turn is still waiting the bubble already says
                      "Reading a.js" - the live signal - and saying it again in the past tense is
                      two controls for one fact. */}
                  {turn.role === "assistant" && !waiting && (turn.tools?.length ?? 0) > 0 && (
                    <details data-testid="turn-tools" className="mt-1.5 text-xs text-ink-4">
                      {/* A read cut to the model's budget is said on this line as well as on the
                          call, because the block starts closed and a warning inside it would be one
                          nobody sees. */}
                      <summary className="cursor-pointer">
                        {cutCount(turn.tools) === 0
                          ? t("chat.toolCalls", { calls: turn.tools?.length ?? 0 })
                          : t("chat.toolCallsCut", {
                              calls: turn.tools?.length ?? 0,
                              cut: cutCount(turn.tools),
                            })}
                      </summary>
                      <ol className="mt-1 max-h-48 space-y-0.5 overflow-auto">
                        {(turn.tools ?? []).map((call, at) => (
                          <li key={at} className="break-words">
                            <code className="rounded bg-hover px-1 text-ink-3">{call.name}</code>
                            {/* Only the path may break anywhere - it has no spaces to wrap at. The
                                warning beside it is words, and breaking those mid-word is unreadable. */}
                            {call.detail !== "" && <span className="break-all">{` ${call.detail}`}</span>}
                            {call.cut !== undefined && (
                              <span className="text-danger">
                                {" "}
                                {t("chat.toolCallCut", {
                                  sent: numbers.format(call.cut.sent),
                                  total: numbers.format(call.cut.total),
                                })}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* A chat opened against a file that has since gone. The conversation is the user's own
            words and still opens; this says what it was about, so a reply referring to "the
            document" is not a mystery. */}
        {missingFolder !== null && (
          <p className="rounded border border-rule px-2 py-1.5 text-xs text-ink-4">
            {t("chat.history.folderMissing", { folder: missingFolder })}
          </p>
        )}

        {missingFile !== null && (
          <p className="rounded border border-rule px-2 py-1.5 text-xs text-ink-4">
            {t("chat.history.fileMissing", { file: missingFile })}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="rounded border border-danger px-2 py-1.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      {models.length > 0 && (
        <ChatScope
          usage={contextUsage({ tokens: context.tokens, draft: input, limit: context.limit })}
          attachments={scope.attachments}
          files={scope.files}
          includeFolder={scope.includeFolder}
          folderPath={scope.folderPath}
          canUseFolder={scope.canUseFolder}
          disabled={streaming}
          onToggleFolder={scope.onToggleFolder}
          onNeedFiles={scope.onNeedFiles}
          onAttach={scope.onAttach}
          onDetach={scope.onDetach}
          attachFailure={scope.attachFailure ?? null}
          cutShort={scope.cutShort}
        />
      )}

      <div className="flex items-end gap-2 border-t border-rule p-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. The panel is for asking questions, and the
            // common case should not need a second key.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          // A question is prose. The shell's right-click menu can only offer a correction for a word
          // the spellchecker flagged, so this is what puts spelling on that menu here.
          spellCheck
          disabled={models.length === 0}
          placeholder={t("chat.askPlaceholder")}
          aria-label={t("chat.message")}
          // Sized to what is typed, from two lines up to twelve, then it scrolls. The browser does
          // the measuring - `field-sizing` - so there is no height to recompute on every keystroke,
          // and a long paste cannot push the conversation off the panel.
          className="field-sizing-content min-h-[calc(2lh+0.5rem+2px)] max-h-[calc(12lh+0.5rem+2px)] flex-1 resize-none rounded border border-rule bg-app px-2 py-1 text-ui text-ink disabled:opacity-50"
        />

        {/* The send button BECOMES the stop button while a reply is pending, in the same place and
            the same shape - an endpoint that accepts a request and then never streams is otherwise a
            panel that looks broken for as long as the connection takes to give up. */}
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t("chat.stop")}
            title={t("chat.stop")}
            className="flex items-center justify-center rounded bg-danger p-2 text-white"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={input.trim() === "" || models.length === 0}
            aria-label={t("chat.send")}
            title={t("chat.send")}
            className="flex items-center justify-center rounded bg-accent-strong p-2 text-white disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12l16-8-6 16-2-6-8-2z" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}

/// How many of a reply's tool calls read a file that had to be cut to the model's budget.
function cutCount(tools: readonly ToolCall[] | undefined): number {
  return (tools ?? []).filter((call) => call.cut !== undefined).length;
}
