import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, CHAT_TOOLS } from "@trypthos/domain";
import en from "../locales/en.json";
import { answerFor, commandsAnswer, toolsAnswer } from "./commandAnswers";

/// The answers to slash commands, which the app writes rather than the model.
///
/// Tested against the REAL catalogue rather than a fake `t`, because half of what can go wrong here
/// is a key that does not exist: i18next answers a missing key with the key itself, so the failure
/// is `chat.slash.tools` sitting in a table where a sentence should be. A fake would have hidden
/// exactly that.
const t = (key: string): string => {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
  if (typeof value !== "string") throw new Error(`No catalogue entry for ${key}`);
  return value;
};

describe("commandsAnswer", () => {
  it("lists every command, with every word that reaches it", () => {
    const answer = commandsAnswer(t);

    for (const command of CHAT_COMMANDS) {
      for (const word of [command.name, ...command.aliases]) {
        expect(answer).toContain(`\`/${word}\``);
      }
      expect(answer).toContain(t(command.descriptionKey));
    }
  });

  it("is a markdown table, because the panel renders markdown", () => {
    expect(commandsAnswer(t)).toContain("| --- | --- |");
  });
});

describe("toolsAnswer", () => {
  it("names every tool the model may be given", () => {
    const answer = toolsAnswer(t);

    for (const tool of CHAT_TOOLS) {
      expect(answer).toContain(`\`${tool.name}\``);
      expect(answer).toContain(t(tool.descriptionKey));
    }
  });

  // The table alone reads as a list of what the model WILL do. Which of these it is actually given
  // depends on the model and on what is attached to the question, and that has to be said.
  it("says these are offered rather than guaranteed", () => {
    expect(toolsAnswer(t)).toContain(t("chat.tools.hint"));
  });
});

describe("answerFor", () => {
  // A command in the list with no answer here is a command that would appear in `/commands` and
  // then do nothing when typed.
  it("answers every command that is offered", () => {
    for (const command of CHAT_COMMANDS) {
      expect(answerFor(command, t)).not.toBeNull();
    }
  });
});
