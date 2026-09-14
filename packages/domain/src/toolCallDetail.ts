import { READ_TOOL_NAME, pathFromToolArguments } from "./editTools";
import {
  CREATE_TOOL_NAME,
  DIFF_TOOL_NAME,
  LIST_TOOL_NAME,
  OPEN_TOOL_NAME,
  SEARCH_TOOL_NAME,
  createArguments,
  diffArguments,
  listArguments,
  openArguments,
  searchArguments,
} from "./folderTools";

/// What one tool call was aimed at, in a line short enough to list under a reply.
///
/// Computed in the main process, where the arguments are, and sent with the `tool` event - the
/// renderer never sees a call's raw arguments, and `create_file`'s would carry a whole file.
///
/// Built on the same readers that decide whether a call can be carried out, so the panel names what
/// the app actually acted on rather than a second interpretation of the same JSON. Empty when there
/// is nothing to name: a listing of the attached folder, arguments cut off mid-object, a tool this
/// does not know.
export function toolCallDetail(name: string, json: string): string {
  switch (name) {
    case READ_TOOL_NAME:
      return pathFromToolArguments(json) ?? "";
    case LIST_TOOL_NAME:
      return listArguments(json)?.path ?? "";
    case SEARCH_TOOL_NAME: {
      const args = searchArguments(json);
      if (args === null) return "";
      return args.path === null ? args.pattern : `${args.pattern} in ${args.path}`;
    }
    case DIFF_TOOL_NAME: {
      const args = diffArguments(json);
      return args === null ? "" : `${args.left}, ${args.right}`;
    }
    case OPEN_TOOL_NAME:
      return openArguments(json)?.path ?? "";
    case CREATE_TOOL_NAME:
      return createArguments(json)?.path ?? "";
    default:
      return "";
  }
}
