export { createPathGuard } from "./workspacePath";
export type {
  PathGuard,
  PathGuardOptions,
  PathRejection,
  PathResolution,
} from "./workspacePath";

export { loadPersisted } from "./persisted";
export type { LoadFailure, LoadOptions, LoadResult, Migration } from "./persisted";

export { ChatProfileSchema, parseChatProfiles } from "./chat";
export type { ChatProfile } from "./chat";

export { isHidden, isMarkdownFile, sortNodes } from "./workspaceTree";
export type { TreeEntry } from "./workspaceTree";

export { countWords, detectLineEnding } from "./documentStats";
export type { LineEnding } from "./documentStats";

export { titleBarLayout, windowTitle } from "./windowChrome";
export type { Platform, TitleBarLayout } from "./windowChrome";

export {
  IPC_CHANNELS,
  ListRequest,
  ReadRequest,
  RevisionSchema,
  WINDOW_STATE_CHANNEL,
  WindowStateSchema,
  WriteRequest,
} from "./ipc";
export type { IpcChannel, WindowState } from "./ipc";

export type {
  ListPage,
  ListResult,
  NodeMeta,
  ProviderError,
  ReadResult,
  Revision,
  StorageProvider,
  WriteResult,
} from "./provider";
