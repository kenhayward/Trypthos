import { CHAT_COMMANDS, CHAT_TOOLS, type ChatCommand } from "@trypthos/domain";

/// What the app answers when you type a slash command.
///
/// Markdown, because the panel already renders markdown and a table is the shape both of these
/// answers want. Built here rather than in the component so it can be tested without rendering, and
/// so the component stays what it is - a thing that shows turns.
///
/// `t` is passed in rather than imported: this is the edge where keys become wording, and a module
/// that reached for i18next itself would need it booted to be tested at all.

export type Translate = (key: string) => string;

/// A markdown table with two columns and however many rows. Cells are not escaped, and do not need
/// to be: every one of them comes from our own catalogue.
function table(headings: [string, string], rows: [string, string][]): string {
  return [
    `| ${headings[0]} | ${headings[1]} |`,
    "| --- | --- |",
    ...rows.map(([left, right]) => `| ${left} | ${right} |`),
  ].join("\n");
}

/// Every word that reaches one command, as the list shows it: `/commands`, `/help`.
function typedAs(command: ChatCommand): string {
  return [command.name, ...command.aliases].map((word) => `\`/${word}\``).join(", ");
}

export function commandsAnswer(t: Translate): string {
  return [
    `**${t("chat.slash.title")}**`,
    "",
    table(
      [t("chat.slash.column"), t("chat.slash.descriptionColumn")],
      CHAT_COMMANDS.map((command) => [typedAs(command), t(command.descriptionKey)]),
    ),
  ].join("\n");
}

export function toolsAnswer(t: Translate): string {
  return [
    `**${t("chat.tools.title")}**`,
    "",
    table(
      [t("chat.tools.column"), t("chat.tools.descriptionColumn")],
      CHAT_TOOLS.map((tool) => [`\`${tool.name}\``, t(tool.descriptionKey)]),
    ),
    "",
    // Said plainly, because the table alone reads as a list of what the model WILL do rather than
    // what it may be offered - and which of these it gets depends on the model and on what is
    // attached to the question.
    t("chat.tools.hint"),
  ].join("\n");
}

/// The answer to one command, or null for a command nothing answers.
///
/// Null rather than a fallback string: a command in `CHAT_COMMANDS` with no answer here is a bug,
/// and `commandAnswers.test.ts` asserts every one of them produces something.
export function answerFor(command: ChatCommand, t: Translate): string | null {
  if (command.name === "commands") return commandsAnswer(t);
  if (command.name === "tools") return toolsAnswer(t);
  return null;
}
