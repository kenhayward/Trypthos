export { createPathGuard } from "./workspacePath";
export type {
  PathGuard,
  PathGuardOptions,
  PathRejection,
  PathResolution,
} from "./workspacePath";

export { normaliseEndpoint } from "./endpoints";

export { loadPersisted } from "./persisted";
export type { LoadFailure, LoadOptions, LoadResult, Migration } from "./persisted";

export {
  ChatProfileListSchema,
  ChatProfileSchema,
  defaultChatProfile,
  parseChatProfiles,
} from "./chat";
export type { ChatProfile } from "./chat";

export { isHidden, isMarkdownFile, sortNodes } from "./workspaceTree";
export type { TreeEntry } from "./workspaceTree";

export {
  DEFAULT_SETTINGS,
  SETTINGS_MIGRATIONS,
  SETTINGS_VERSION,
  SettingsSchema,
  loadSettings,
} from "./settings";
export type { Settings } from "./settings";

export { isNewerVersion, parseReleaseTag, pickUpdate } from "./updates";
export type { AvailableUpdate, PublishedRelease } from "./updates";

export { PANEL_BOUNDS, resolvePanelWidths } from "./panelLayout";
export type { PanelRequest, PanelWidths } from "./panelLayout";

export { countWords, detectLineEnding } from "./documentStats";
export type { LineEnding } from "./documentStats";

export { titleBarLayout, windowTitle } from "./windowChrome";
export type { Platform, TitleBarLayout } from "./windowChrome";

export {
  DeleteSecretRequest,
  IPC_CHANNELS,
  ListRequest,
  ReadRequest,
  RevisionSchema,
  SetSecretRequest,
  WINDOW_STATE_CHANNEL,
  WriteSettingsRequest,
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
