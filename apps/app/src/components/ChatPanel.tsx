import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { splitReply, type ChatProfile, type EditTarget, type ProposedEdit } from "@trypthos/domain";
import { renderMarkdown } from "../lib/markdown";
import type { Turn } from "../lib/conversation";
import ChatEditCard from "./ChatEditCard";
import ChatModelPicker from "./ChatModelPicker";

interface Props {
  width: number;
  onCollapse: () => void;
  models: readonly ChatProfile[];
  selectedId: string | null;
  onSelectModel: (id: string) => void;
  turns: readonly Turn[];
  streaming: boolean;
  error: string | null;
  /// What the model thought, when it produced no answer. See the empty-reply branch below.
  reasoning: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  /// Opens Preferences, which is the only way out of having no model configured.
  onConfigure: () => void;
  /// Where a proposed edit would land in the document as it is NOW, or why it cannot.
  ///
  /// Passed in rather than computed here because the panel does not hold the document. Called on
  /// every render, so a heading renamed while the user reads the proposal turns Apply off.
  resolveEdit: (edit: ProposedEdit) => EditTarget;
  /// Applies an edit the user accepted. Returns true if it landed.
  onApplyEdit: (edit: ProposedEdit) => boolean;
}

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
  onCollapse,
  models,
  selectedId,
  onSelectModel,
  turns,
  streaming,
  error,
  reasoning,
  onSend,
  onStop,
  onClear,
  onConfigure,
  resolveEdit,
  onApplyEdit,
}: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  /// Which proposals have been applied, so a card cannot be clicked twice.
  ///
  /// Keyed by turn and position within it. Cleared with the thread, since the keys mean nothing
  /// once the turns behind them are gone.
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);

  // Keep the thread pinned to the newest message as tokens stream in.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [turns]);

  const send = () => {
    const prompt = input.trim();
    if (prompt === "" || streaming) return;
    onSend(prompt);
    setInput("");
  };

  return (
    <aside
      aria-label={t("chat.title")}
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-panel"
    >
      <h2 className="flex items-center gap-1 border-b border-rule px-3 py-2 text-xs font-semibold tracking-wide text-ink-4 uppercase">
        {t("chat.title")}
        <span className="ml-auto flex items-center gap-1">
          <ChatModelPicker
            models={models}
            selectedId={selectedId}
            disabled={streaming}
            onSelect={onSelectModel}
          />
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

      <div ref={threadRef} data-testid="chat-thread" className="min-h-0 grow space-y-3 overflow-y-auto p-3">
        {models.length === 0 ? (
          <div className="text-ui text-ink-4">
            <p>{t("chat.notConfigured")}</p>
            <button
              type="button"
              onClick={onConfigure}
              className="mt-2 rounded border border-rule px-2 py-1 text-ui text-ink"
            >
              {t("chat.openPreferences")}
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
                      <span className="text-ink-4">{t("chat.thinking")}</span>
                    ) : turn.content === "" && !streaming ? (
                      // A turn that finished having produced nothing. Reasoning models do this:
                      // they think, and then stop. An empty bubble tells the user nothing at all,
                      // so say what happened and show the thinking if there is any.
                      <div className="space-y-2">
                        <p className="text-ui text-ink-4">{t("chat.noAnswer")}</p>
                        {reasoning !== "" && (
                          <details className="text-xs text-ink-4">
                            <summary className="cursor-pointer">{t("chat.showThinking")}</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
                              {reasoning}
                            </pre>
                          </details>
                        )}
                      </div>
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
                            <div
                              key={at}
                              className="chat-md break-words [&_a]:underline [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_pre]:overflow-x-auto"
                              // Sanitised in renderMarkdown (DOMPurify) before injection. This is a
                              // model's output: text the app did not write, and treated as data
                              // rather than markup for the same reason a workspace file is.
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
                            />
                          ),
                        )}
                      </div>
                    )
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{turn.content}</span>
                  )}
                </div>
              </div>
            );
          })
        )}

        {error !== null && (
          <p role="alert" className="rounded border border-danger px-2 py-1.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>

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
          disabled={models.length === 0}
          placeholder={t("chat.askPlaceholder")}
          aria-label={t("chat.message")}
          className="min-h-0 flex-1 resize-none rounded border border-rule bg-app px-2 py-1 text-ui text-ink disabled:opacity-50"
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
