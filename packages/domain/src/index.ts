export { createPathGuard } from "./workspacePath";
export type {
  PathGuard,
  PathGuardOptions,
  PathRejection,
  PathResolution,
} from "./workspacePath";

export { isExternalUrl, linkAction } from "./markdownLink";
export type { LinkAction, LinkRejection } from "./markdownLink";

export { normaliseEndpoint } from "./endpoints";

export {
  MENU_ACTIONS,
  MENU_ACTION_CHANNEL,
  MENU_NAMES,
  MenuActionMessage,
  PopupMenuRequest,
} from "./menus";
export type { MenuAction, MenuName } from "./menus";

export { createSseDecoder } from "./sse";
export type { SseDecoder } from "./sse";

export {
  ChatTurnSchema,
  buildChatRequest,
  completionsUrl,
  composeMessages,
  parseStreamPayload,
} from "./chatCompletion";

export {
  CONTEXT_CHARACTER_LIMIT,
  DEFAULT_OUTLINE_FILE_LIMIT,
  EMPTY_CONTEXT,
  OUTLINE_PATH_LIMIT,
  ChatContextSchema,
  contextTurns,
  resolveChatContext,
} from "./chatContext";
export type {
  AttachedFile,
  ChatContext,
  ContextSource,
  DocumentContext,
  FolderOutline,
} from "./chatContext";

export {
  DEFAULT_SYSTEM_PROMPT,
  PREVIOUS_SYSTEM_PROMPTS,
  effectiveSystemPrompt,
} from "./systemPrompt";

export {
  CHAT_SESSION_VERSION,
  ChatSessionSchema,
  chatTitleFrom,
  loadChatSession,
  summariseSession,
} from "./chatSession";
export type { ChatSession, ChatSessionSummary } from "./chatSession";

export { findHeadings, resolveEdit } from "./documentEdit";
export type { EditOp, EditTarget, Heading, ProposedEdit } from "./documentEdit";

export { EDIT_FENCE_TAG, formatEditBlock, splitReply } from "./editBlocks";

export {
  EDIT_TOOL_NAME,
  READ_CHARACTER_LIMIT,
  READ_TOOL_NAME,
  editFromToolArguments,
  editTools,
  pathFromToolArguments,
  readTools,
} from "./editTools";
export type { ReplyPart } from "./editBlocks";
export type { ChatRequestBody, ChatTurn, RequestMessage, StreamEvent } from "./chatCompletion";

export { loadPersisted } from "./persisted";
export type { LoadFailure, LoadOptions, LoadResult, Migration } from "./persisted";

export {
  ChatProfileListSchema,
  ChatProfileSchema,
  defaultChatProfile,
  parseChatProfiles,
} from "./chat";
export type { ChatProfile } from "./chat";

export {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  EditorModeSchema,
  isEditable,
} from "./editorMode";
export type { EditorMode } from "./editorMode";

export {
  CHARACTERS_PER_TOKEN,
  contextTokens,
  contextUsage,
  estimateTokens,
} from "./contextUsage";
export type { ContextUsage } from "./contextUsage";

export {
  activateDocument,
  activeDocument,
  anyDirty,
  closeDocument,
  dirtyPaths,
  documentName,
  emptyDocumentSet,
  isOpen,
  markSaved,
  openDocument,
  openPaths,
  tabLabels,
  updateContent,
} from "./openDocuments";
export type { DocumentSet, DocumentSource, OpenDocument } from "./openDocuments";

export { isHidden, isMarkdownFile, sortNodes } from "./workspaceTree";
export type { TreeEntry } from "./workspaceTree";

export {
  DEFAULT_SETTINGS,
  SETTINGS_MIGRATIONS,
  SETTINGS_VERSION,
  SettingsSchema,
  chatPanelVisible,
  loadSettings,
} from "./settings";
export type { Settings } from "./settings";

export { downloadAssetFor, isNewerVersion, parseReleaseTag, pickUpdate } from "./updates";
export type { AvailableUpdate, PublishedAsset, PublishedRelease } from "./updates";

export { PANEL_BOUNDS, resolvePanelWidths } from "./panelLayout";
export type { PanelRequest, PanelWidths } from "./panelLayout";

export { countWords, detectLineEnding } from "./documentStats";
export type { LineEnding } from "./documentStats";

export { titleBarLayout, windowTitle } from "./windowChrome";
export type { Platform, TitleBarLayout } from "./windowChrome";

export {
  CHAT_EVENT_CHANNEL,
  CancelChatRequest,
  ChatIdRequest,
  SaveChatRequest,
  ChatEventMessage,
  CLOSE_REQUESTED_CHANNEL,
  ChatEventSchema,
  CloseWindowRequest,
  ConfirmDiscardRequest,
  DeleteSecretRequest,
  DiscardChoiceSchema,
  DocumentDirtyRequest,
  IPC_CHANNELS,
  ListRequest,
  OpenExternalRequest,
  SendChatRequest,
  ReadRequest,
  RevisionSchema,
  SetSecretRequest,
  WINDOW_STATE_CHANNEL,
  WriteSettingsRequest,
  WindowStateSchema,
  WriteRequest,
} from "./ipc";
export type { ChatEvent, DiscardChoice, IpcChannel, WindowState } from "./ipc";

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
