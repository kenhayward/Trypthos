import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatProfile } from "@trypthos/domain";
import {
  conversationTotals,
  summariseReply,
  type ReplyOutcome,
  type ReplyStats,
} from "../lib/replyStats";

interface Props {
  /// Every reply timed in the conversation on screen, oldest first.
  replyStats: readonly ReplyStats[];
  /// The configured models, to name the one a reply went to and find its context window.
  models: readonly ChatProfile[];
  /// Opens the conversation log - every request and response, as they went and came back.
  onOpenLog?: () => void;
}

/// How the most recent reply went, and the conversation so far.
///
/// A popover built like the saved-conversations list beside it rather than a dialog: it is something
/// glanced at, and a window to dismiss would be more ceremony than a handful of numbers deserve.
export default function ChatStatsMenu({ replyStats, models, onOpenLog }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDocument(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const formats = useMemo(
    () => ({
      count: new Intl.NumberFormat(i18n.language),
      seconds: new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      rate: new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
      percent: new Intl.NumberFormat(i18n.language, { style: "percent" }),
    }),
    [i18n.language],
  );

  /// A span of time, in milliseconds under a second and in seconds from there.
  const duration = (ms: number | null) =>
    ms === null
      ? t("chat.stats.notYet")
      : ms < 1000
        ? t("chat.stats.milliseconds", { value: formats.count.format(Math.round(ms)) })
        : t("chat.stats.seconds", { value: formats.seconds.format(ms / 1000) });

  const outcome = (value: ReplyOutcome) => {
    switch (value) {
      case "streaming":
        return t("chat.stats.outcomeStreaming");
      case "stopped":
        return t("chat.stats.outcomeStopped");
      case "failed":
        return t("chat.stats.outcomeFailed");
      default:
        return t("chat.stats.outcomeComplete");
    }
  };

  const last = replyStats.at(-1);
  const profile = last === undefined ? undefined : models.find((m) => m.id === last.profileId);
  const summary =
    last === undefined ? null : summariseReply(last, profile?.contextWindow ?? null);
  const totals = conversationTotals(replyStats);

  const notReported = t("chat.stats.notReported");
  const count = (value: number | null) => (value === null ? notReported : formats.count.format(value));
  /// A token count summed over the reply's requests, saying so when there was more than one. Each
  /// request resends the conversation, so these totals can run far past Context used, which is the
  /// last request alone - and unlabelled that read as a contradiction (#169).
  const acrossRequests = (value: number | null) =>
    value === null || summary === null || summary.requests <= 1
      ? count(value)
      : t("chat.stats.inRequests", {
          value: formats.count.format(value),
          count: formats.count.format(summary.requests),
        });
  /// The finished replies' time, and how many are still arriving - never a bare 0 ms for a
  /// conversation that is under way.
  const conversationTime =
    totals.stillArriving === 0
      ? duration(totals.totalMs)
      : totals.stillArriving === totals.replies
        ? t("chat.stats.notYet")
        : t("chat.stats.plusArriving", {
            value: duration(totals.totalMs),
            count: formats.count.format(totals.stillArriving),
          });

  return (
    // Not positioned itself: the popover hangs from the toolbar's right edge rather than from this
    // button, which sits far enough in that a popover this wide would reach past the panel's left
    // edge - and the panel clips what overflows it.
    <div ref={container}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        aria-label={t("chat.stats.open")}
        title={t("chat.stats.open")}
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("chat.stats.open")}
          className="absolute top-full right-2 z-40 mt-1 max-h-96 w-72 overflow-auto rounded-md border border-rule bg-app px-3 py-2 text-xs font-normal tracking-normal text-ink normal-case shadow-menu"
        >
          {summary === null || last === undefined ? (
            <p className="text-ink-4">{t("chat.stats.empty")}</p>
          ) : (
            <>
              <h3 className="mb-1 font-semibold text-ink-3">{t("chat.stats.lastReply")}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <Row label={t("chat.stats.model")} value={profile?.label ?? t("chat.stats.unknownModel")} />
                <Row label={t("chat.stats.outcome")} value={outcome(summary.outcome)} />
                <Row label={t("chat.stats.timeToFirstToken")} value={duration(summary.timeToFirstTokenMs)} />
                <Row label={t("chat.stats.totalTime")} value={duration(summary.totalMs)} />
                <Row label={t("chat.stats.writingTime")} value={duration(summary.writingMs)} />
                <Row
                  label={t("chat.stats.tokensPerSecond")}
                  value={
                    summary.tokensPerSecond === null
                      ? t("chat.stats.notYet")
                      : formats.rate.format(summary.tokensPerSecond)
                  }
                />
                <Row label={t("chat.stats.sent")} value={acrossRequests(summary.sentTokens)} />
                <Row
                  label={t("chat.stats.returned")}
                  value={
                    summary.usageReported
                      ? acrossRequests(summary.returnedTokens)
                      : t("chat.stats.about", { value: formats.count.format(summary.returnedTokens) })
                  }
                />
                <Row label={t("chat.stats.total")} value={acrossRequests(summary.totalTokens)} />
                {summary.requests > 1 && summary.lastSentTokens !== null && (
                  <Row label={t("chat.stats.lastSent")} value={count(summary.lastSentTokens)} />
                )}
                <Row
                  label={t("chat.stats.context")}
                  value={
                    summary.contextUsed === null
                      ? notReported
                      : summary.contextLimit === null || summary.contextFraction === null
                        ? t("chat.stats.contextNoLimit", {
                            used: formats.count.format(summary.contextUsed),
                          })
                        : t("chat.stats.contextOf", {
                            used: formats.count.format(summary.contextUsed),
                            limit: formats.count.format(summary.contextLimit),
                            percent: formats.percent.format(summary.contextFraction),
                          })
                  }
                />
                <Row label={t("chat.stats.requests")} value={count(summary.usageReported ? summary.requests : null)} />
                <Row label={t("chat.stats.toolCalls")} value={formats.count.format(summary.toolCalls)} />
              </dl>
              {!summary.usageReported && (
                <p className="mt-1.5 text-2xs text-ink-4">{t("chat.stats.estimatedNote")}</p>
              )}

              <h3 className="mt-2.5 mb-1 font-semibold text-ink-3">{t("chat.stats.conversation")}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <Row label={t("chat.stats.replies")} value={formats.count.format(totals.replies)} />
                <Row label={t("chat.stats.sent")} value={count(totals.sentTokens)} />
                <Row
                  label={t("chat.stats.returned")}
                  value={
                    totals.returnedEstimated
                      ? t("chat.stats.about", { value: formats.count.format(totals.returnedTokens) })
                      : formats.count.format(totals.returnedTokens)
                  }
                />
                <Row label={t("chat.stats.totalTime")} value={conversationTime} />
              </dl>
              <p className="mt-1.5 text-2xs text-ink-4">{t("chat.stats.notSaved")}</p>
            </>
          )}
          {/* Offered even before a reply: the log also shows the thread, and a conversation reopened
              from disk has one with no replies timed. */}
          {onOpenLog !== undefined && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenLog();
              }}
              className="mt-2 w-full rounded border border-rule px-2 py-1 text-left text-ui text-ink hover:bg-hover"
            >
              {t("chat.log.open")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-4">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
