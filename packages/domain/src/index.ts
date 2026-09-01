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

export { IPC_CHANNELS, ListRequest, ReadRequest, RevisionSchema, WriteRequest } from "./ipc";
export type { IpcChannel } from "./ipc";

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
