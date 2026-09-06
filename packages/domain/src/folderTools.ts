import { z } from "zod";

/// The tools that let a model look around the folder you attached, rather than only at the list it
/// was given.
///
/// **What they widen, said plainly.** Until now the model could read the files named in the folder
/// outline and nothing else - ten files, chosen by walking one level. These let it list a subfolder,
/// search for text, and compare two files, which means it can reach files that were never on that
/// list.
///
/// **What bounds them.** The folder the user selected, and everything under it. Not the workspace:
/// attaching a folder is the consent gesture this app already has, and honouring it is the
/// difference between "you showed me this folder" and "you opened this app". Every path still goes
/// through the workspace guard as well, so the folder bound is a second fence inside the first one.
///
/// They are offered only when a folder is attached, for the same reason `get_file_contents` is: with
/// nothing attached there is nothing to look around, and offering a tool that can only be refused
/// invites calls that waste a turn.

export const LIST_TOOL_NAME = "list_directory";
export const SEARCH_TOOL_NAME = "search_contents";
export const DIFF_TOOL_NAME = "diff_files";

/// How many entries one listing names. A directory of ten thousand files is not a menu, and the
/// whole reply has to fit in a context window beside everything else.
export const LIST_ENTRY_LIMIT = 200;

/// How many matching lines one search answers with, and how much of each line.
///
/// Both caps exist for the same reason: a search for "e" across a source tree would otherwise return
/// the tree. Truncation is always MARKED, never silent - a model told it has everything when it has
/// a hundredth of it will answer confidently and wrongly.
export const SEARCH_MATCH_LIMIT = 60;
export const SEARCH_LINE_LIMIT = 300;

/// How many lines of difference one comparison answers with.
export const DIFF_LINE_LIMIT = 400;

/// The descriptions below are read BY THE MODEL and are part of the request. They are written to be
/// acted on rather than admired: what the tool does, what it may reach, and what it refuses.
export function folderTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: LIST_TOOL_NAME,
        description:
          "List the files and folders in one directory of the attached folder. Use it to find a " +
          "file whose name you do not know. Only the attached folder and directories under it can " +
          "be listed; anything else is refused.",
        parameters: {
          type: "object" as const,
          properties: {
            path: {
              type: "string" as const,
              description:
                "The directory to list, relative to the workspace, as the folder outline writes " +
                "paths. Omit it to list the attached folder itself.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: SEARCH_TOOL_NAME,
        description:
          "Search the text of the files in the attached folder and below for a regular expression. " +
          "Answers with the matching lines and the file and line number of each. Use it to find " +
          "which file contains something.",
        parameters: {
          type: "object" as const,
          properties: {
            pattern: {
              type: "string" as const,
              description:
                "A JavaScript regular expression. A plain word works and matches literally.",
            },
            path: {
              type: "string" as const,
              description:
                "The directory to search under, relative to the workspace. Omit it to search the " +
                "whole attached folder.",
            },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: DIFF_TOOL_NAME,
        description:
          "Compare two text files line by line and answer with the differences between them. Use " +
          "it to see what changed between two versions of something.",
        parameters: {
          type: "object" as const,
          properties: {
            left: { type: "string" as const, description: "The first file, workspace-relative." },
            right: { type: "string" as const, description: "The second file, workspace-relative." },
          },
          required: ["left", "right"],
        },
      },
    },
  ];
}

/// The arguments of one call, or null when the call cannot be used.
///
/// Total, like every other reader of a provider response: a call cut off mid-object is an ordinary
/// outcome rather than an error, and `null` means "answer that this cannot be done" rather than
/// "throw". `looseObject` because a model may add fields nobody asked for, and dropping them is
/// kinder than refusing the call over them.
function parse<T extends z.ZodTypeAny>(json: string, schema: T): z.infer<T> | null {
  try {
    const result = schema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/// A path argument, normalised. An absent or empty one means "where you told me to look" - which the
/// caller resolves, because only it knows which folder was attached.
const optionalPath = z.string().optional();

export function listArguments(json: string): { path: string | null } | null {
  const args = parse(json, z.looseObject({ path: optionalPath }));
  if (args === null) return null;
  const path = (args.path ?? "").trim();
  return { path: path === "" ? null : path };
}

export function searchArguments(
  json: string,
): { pattern: string; path: string | null } | null {
  const args = parse(json, z.looseObject({ pattern: z.string(), path: optionalPath }));
  if (args === null) return null;

  const pattern = args.pattern.trim();
  if (pattern === "") return null;

  const path = (args.path ?? "").trim();
  return { pattern, path: path === "" ? null : path };
}

export function diffArguments(json: string): { left: string; right: string } | null {
  const args = parse(json, z.looseObject({ left: z.string(), right: z.string() }));
  if (args === null) return null;

  const left = args.left.trim();
  const right = args.right.trim();
  return left === "" || right === "" ? null : { left, right };
}

/// Whether a workspace-relative path is inside a folder, or is that folder.
///
/// The second fence, inside the workspace guard rather than instead of it. "" is the workspace root
/// and contains everything; anything else must match a whole segment, or "docs" would contain
/// "docs-archive" - the same prefix trap the path guard has, and the same answer.
export function withinFolder(folder: string, path: string): boolean {
  if (folder === "") return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/// Turns a user's pattern into a regular expression, or null when it is not one.
///
/// Null rather than throwing, and null rather than falling back to a literal search: a model that
/// wrote a broken expression should be told so, not quietly given the results of a different search.
///
/// Case-insensitive and multiline, because that is what somebody searching a folder means. Not
/// global: the flag makes `RegExp` stateful across calls, and a shared `lastIndex` is how a search
/// starts skipping every other line.
export function searchExpression(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "im");
  } catch {
    return null;
  }
}
