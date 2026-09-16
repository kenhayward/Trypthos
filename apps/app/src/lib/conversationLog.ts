import type { ChatProfile } from "@trypthos/domain";
import type { Turn } from "./conversation";
import { summariseReply, type ReplyOutcome, type ReplyStats } from "./replyStats";

/// A translation function with interpolation - `t` from react-i18next, or i18next's own.
export type TranslateWith = (key: string, values?: Record<string, unknown>) => string;

/// The conversation log: the thread as the panel holds it, then every reply's requests exactly as
/// they went and came back.
///
/// For finding out what really happened to a reply - most often one the panel shows as empty while
/// the endpoint reported tokens. So everything the endpoint sent is shown **as text, in fences**,
/// never rendered: a log that turned a model's markdown into formatting would be showing what the
/// panel made of it again, which is the thing being checked.
///
/// Built from what the renderer already holds. The traces arrive with the key removed by the shell,
/// and nothing here adds anything the renderer could not already see.
export function conversationLog({
  turns,
  replyStats,
  models,
  t,
  language,
}: {
  turns: readonly Turn[];
  replyStats: readonly ReplyStats[];
  models: readonly ChatProfile[];
  t: TranslateWith;
  language: string;
}): string {
  const number = new Intl.NumberFormat(language);
  const lines: string[] = [`# ${t("chat.log.title")}`, "", t("chat.log.intro"), ""];

  if (turns.length === 0 && replyStats.length === 0) {
    lines.push(t("chat.log.empty"), "");
    return lines.join("\n");
  }

  lines.push(`## ${t("chat.log.thread")}`, "");
  turns.forEach((turn, index) => {
    const who = turn.role === "user" ? t("chat.log.you") : t("chat.log.reply");
    lines.push(`### ${index + 1}. ${who}`, "");
    if (turn.local === true) lines.push(`_${t("chat.log.local")}_`, "");
    lines.push(fence(turn.content, "text"), "");
    if ((turn.reasoning ?? "") !== "") {
      lines.push(`**${t("chat.log.thinking")}**`, "", fence(turn.reasoning ?? "", "text"), "");
    }
    if ((turn.tools?.length ?? 0) > 0) {
      lines.push(`**${t("chat.log.toolCalls")}**`, "");
      for (const call of turn.tools ?? []) {
        lines.push(`- \`${call.name}\`${call.detail === "" ? "" : ` ${call.detail}`}`);
      }
      lines.push("");
    }
  });

  if (replyStats.length === 0) return lines.join("\n");

  lines.push(`## ${t("chat.log.replies")}`, "");
  replyStats.forEach((stats, index) => {
    const profile = models.find((model) => model.id === stats.profileId);
    const summary = summariseReply(stats, profile?.contextWindow ?? null);
    const answerCharacters = stats.characters - stats.reasoningCharacters;

    lines.push(`### ${t("chat.log.replyNumber", { number: index + 1 })}`, "");
    lines.push(`**${t("chat.log.question")}**`, "", fence(stats.question, "text"), "");
    lines.push(
      `- ${t("chat.log.model", {
        model:
          profile === undefined ? t("chat.stats.unknownModel") : `${profile.label} (${profile.model})`,
      })}`,
      `- ${t("chat.log.outcome", { outcome: outcomeLabel(summary.outcome, t) })}`,
      `- ${t("chat.log.tokens", {
        sent: summary.sentTokens === null ? t("chat.stats.notReported") : number.format(summary.sentTokens),
        returned: summary.usageReported
          ? number.format(summary.returnedTokens)
          : t("chat.stats.notReported"),
      })}`,
      `- ${t("chat.log.characters", {
        answer: number.format(answerCharacters),
        thinking: number.format(stats.reasoningCharacters),
      })}`,
    );
    if (stats.resets > 0) {
      lines.push(`- ${t("chat.log.resets", { count: number.format(stats.resets) })}`);
    }
    lines.push("");

    // The case this log exists for, said outright rather than left to be worked out from the numbers.
    if (summary.usageReported && summary.returnedTokens > 0 && answerCharacters === 0) {
      lines.push(
        `> ${t("chat.log.noAnswer", {
          tokens: number.format(summary.returnedTokens),
          thinking: number.format(stats.reasoningCharacters),
        })}`,
        "",
      );
    }

    if (stats.errors.length > 0) {
      lines.push(`**${t("chat.log.errors")}**`, "", ...stats.errors.map((error) => `- ${error}`), "");
    }

    if (stats.traces.length === 0) {
      lines.push(t("chat.log.noRequests"), "");
      return;
    }

    for (const trace of stats.traces) {
      const status =
        trace.status === null
          ? t("chat.log.notReached")
          : t("chat.log.status", { status: trace.status });
      lines.push(`#### ${t("chat.log.request", { number: trace.round + 1 })} - ${status}`, "");
      lines.push(`${t("chat.log.sentTo")} \`${trace.url}\``, "");
      if (trace.notes.length > 0) {
        lines.push(`**${t("chat.log.notes")}**`, "", ...trace.notes.map((note) => `- ${note}`), "");
      }
      lines.push(`**${t("chat.log.requestBody")}**`, "", fence(trace.request, "json"), "");
      lines.push(
        `**${t("chat.log.response")}**`,
        "",
        trace.response === "" ? `_${t("chat.log.nothing")}_` : fence(trace.response, "text"),
        "",
      );
    }
  });

  return lines.join("\n");
}

function outcomeLabel(outcome: ReplyOutcome, t: TranslateWith): string {
  switch (outcome) {
    case "streaming":
      return t("chat.stats.outcomeStreaming");
    case "stopped":
      return t("chat.stats.outcomeStopped");
    case "failed":
      return t("chat.stats.outcomeFailed");
    default:
      return t("chat.stats.outcomeComplete");
  }
}

/// A fenced block that `text` cannot close early.
///
/// One backtick longer than the longest run in the text, and never fewer than three: a response that
/// carries a fence of its own - a proposed edit does - would otherwise end the block, and everything
/// after it would render as markdown.
function fence(text: string, language: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(Math.max(3, longest + 1));
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return `${marks}${language}\n${body}\n${marks}`;
}
