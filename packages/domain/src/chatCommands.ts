import { EDIT_TOOL_NAME, READ_TOOL_NAME } from "./editTools";

/// The commands you can type into the chat box instead of a question.
///
/// A command is answered by the app rather than by the model: it says something about Trypthos,
/// which no endpoint can be expected to know and none should be paid to guess at.
///
/// **Keys, not wording.** This module is data about what exists; what each one SAYS lives in the
/// catalogue, and the panel translates at the edge - the same split as `fileTypes.ts`.

export interface ChatCommand {
  /// What the user types after the slash, lower case.
  readonly name: string;
  /// Other words that reach the same command. `/help` is what people try first.
  readonly aliases: readonly string[];
  readonly descriptionKey: string;
}

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  { name: "commands", aliases: ["help"], descriptionKey: "chat.slash.commands" },
  { name: "tools", aliases: [], descriptionKey: "chat.slash.tools" },
];

/// The command a message is, or null when it is an ordinary question.
///
/// **A message is a command only when it is NOTHING BUT the command**, and that is the whole guard
/// rather than a nicety. A leading slash is an ordinary way to start a sentence - a path, a fraction,
/// a date - so anything looser would quietly swallow somebody's question and answer a different one.
/// "/tools are great, which do you have?" is a question about tools, not a request for the list.
export function parseChatCommand(text: string): ChatCommand | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return null;

  const word = trimmed.slice(1);
  return (
    CHAT_COMMANDS.find(
      (command) => command.name === word || command.aliases.includes(word),
    ) ?? null
  );
}

/// The tools the model may be given, described for the person reading `/tools`.
///
/// **Two audiences, and they are deliberately different text.** The descriptions in `editTools` are
/// written FOR THE MODEL and are part of the request it receives; these are written for somebody
/// deciding whether to trust an answer. What must not drift is which tools exist, which is asserted
/// against the definitions themselves.
export interface ChatToolSummary {
  readonly name: string;
  readonly descriptionKey: string;
}

export const CHAT_TOOLS: readonly ChatToolSummary[] = [
  { name: READ_TOOL_NAME, descriptionKey: "chat.tools.get_file_contents" },
  { name: EDIT_TOOL_NAME, descriptionKey: "chat.tools.propose_edit" },
];
