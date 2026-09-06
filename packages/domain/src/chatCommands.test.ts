import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, CHAT_TOOLS, parseChatCommand } from "./chatCommands";
import { EDIT_TOOL_NAME, READ_TOOL_NAME, editTools, readTools } from "./editTools";
import { folderTools } from "./folderTools";

describe("parseChatCommand", () => {
  it("recognises a command", () => {
    expect(parseChatCommand("/tools")?.name).toBe("tools");
  });

  it("ignores the case it was typed in, and the space around it", () => {
    expect(parseChatCommand("  /TOOLS  ")?.name).toBe("tools");
  });

  it("answers to an alias", () => {
    expect(parseChatCommand("/help")?.name).toBe("commands");
    expect(parseChatCommand("/commands")?.name).toBe("commands");
  });

  // A message is a command only when it is NOTHING BUT the command. This is the whole guard against
  // swallowing somebody's question: a path is a perfectly ordinary way to start a sentence, and a
  // question that merely mentions one has to reach the model.
  it("leaves a question that merely starts with a slash alone", () => {
    expect(parseChatCommand("/usr/local/bin is where it lives, why?")).toBeNull();
    expect(parseChatCommand("/tools are great, which do you have?")).toBeNull();
  });

  it("leaves an ordinary question alone", () => {
    expect(parseChatCommand("What does this file do?")).toBeNull();
    expect(parseChatCommand("")).toBeNull();
  });

  it("does not invent a command nobody wrote", () => {
    expect(parseChatCommand("/toolss")).toBeNull();
    expect(parseChatCommand("/")).toBeNull();
  });
});

describe("CHAT_COMMANDS", () => {
  it("names every command it offers, and its description", () => {
    for (const command of CHAT_COMMANDS) {
      expect(command.name).not.toBe("");
      expect(command.descriptionKey.startsWith("chat.slash.")).toBe(true);
    }
  });

  it("has no two commands answering to the same word", () => {
    const words = CHAT_COMMANDS.flatMap((command) => [command.name, ...command.aliases]);
    expect(new Set(words).size).toBe(words.length);
  });

  // Every command listed can be typed, and everything typeable is listed. A command missing from
  // its own list is one nobody will find.
  it("is reachable by every word it lists", () => {
    for (const command of CHAT_COMMANDS) {
      for (const word of [command.name, ...command.aliases]) {
        expect(parseChatCommand(`/${word}`)?.name).toBe(command.name);
      }
    }
  });
});

/// The tools the model may be given, as the user is told about them.
///
/// Two audiences, deliberately: the descriptions in `editTools` are written FOR THE MODEL and are
/// part of the request, while these are written for a person reading `/tools`. What must not drift
/// is which tools exist.
describe("CHAT_TOOLS", () => {
  it("describes every tool the app actually offers", () => {
    const offered = [...readTools(), ...folderTools(), ...editTools()]
      .map((tool) => tool.function.name)
      .sort();
    const described = CHAT_TOOLS.map((tool) => tool.name).sort();

    expect(described).toEqual(offered);
  });

  it("names the ones there are", () => {
    expect(CHAT_TOOLS.map((tool) => tool.name)).toEqual([
      READ_TOOL_NAME,
      "list_directory",
      "search_contents",
      "diff_files",
      EDIT_TOOL_NAME,
    ]);
  });

  it("carries a description key for each", () => {
    for (const tool of CHAT_TOOLS) {
      expect(tool.descriptionKey.startsWith("chat.tools.")).toBe(true);
    }
  });
});
