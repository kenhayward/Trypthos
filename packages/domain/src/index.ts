export { createPathGuard } from "./workspacePath";
export type {
  PathGuard,
  PathGuardOptions,
  PathRejection,
  PathResolution,
} from "./workspacePath";

export {
  FLAVOUR_SCAN_LIMIT,
  FLAVOUR_SIGNALS,
  GITHUB_ALERT_TYPES,
  detectFlavour,
  effectiveFlavour,
} from "./markdownFlavour";
export type { DetectedFlavour, FlavourChoice, FlavourSignal, MarkdownFlavour } from "./markdownFlavour";
export { splitFrontMatter } from "./frontMatter";
export type { FrontMatterProperty, FrontMatterSplit } from "./frontMatter";
export { parseWikiLink, pickWikiTarget, wikiLinkFileName } from "./wikiLink";
export { embeddedSection } from "./noteEmbed";
export type { WikiLink } from "./wikiLink";
export { extractReferences, maskIgnored } from "./vaultLinks";
export type { NoteReference, NoteReferences } from "./vaultLinks";
export { imageSource, isExternalUrl, isUnsupportedScheme, linkAction } from "./markdownLink";
export type { ImageSource, LinkAction, LinkRejection } from "./markdownLink";

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
  parseCompletionPayload,
  parseStreamPayload,
} from "./chatCompletion";

export {
  CONTEXT_CHARACTER_LIMIT,
  DEFAULT_OUTLINE_FILE_LIMIT,
  EMPTY_CONTEXT,
  MAX_CONTEXT_CHARACTER_LIMIT,
  OUTLINE_PATH_LIMIT,
  ChatContextSchema,
  attachmentsCutShort,
  contextCharacters,
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
  SAVED_REASONING_LIMIT,
  cappedForSaving,
  ChatSessionSchema,
  chatTitleFrom,
  loadChatSession,
  summariseSession,
} from "./chatSession";
export type { ChatSession, ChatSessionSummary, SessionAttachment } from "./chatSession";

export { findHeadings, resolveEdit } from "./documentEdit";
export type { EditOp, EditTarget, Heading, ProposedEdit } from "./documentEdit";

export { EDIT_FENCE_TAG, formatEditBlock, splitReply } from "./editBlocks";

export {
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  capRead,
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
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
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
  DOCUMENT_CONTEXT_SHARE,
  contextCharacterBudget,
  contextTokens,
  contextUsage,
  estimateTokens,
} from "./contextUsage";
export type { ContextUsage } from "./contextUsage";

export {
  CONVERSATION_LOG_PATH,
  GUIDE_PATH,
  activateDocument,
  activeDocument,
  anyDirty,
  closeDocument,
  dirtyPaths,
  documentName,
  emptyDocumentSet,
  isOpen,
  markSaved,
  movedPath,
  movePaths,
  openDocument,
  openPaths,
  TAB_CLOSE_ACTIONS,
  renameDocument,
  showReadOnly,
  tabLabels,
  tabsToClose,
  updateContent,
} from "./openDocuments";
export type { DocumentSet, DocumentSource, OpenDocument, TabCloseAction } from "./openDocuments";

export {
  RECENT_FILES_LIMIT,
  RecentFileSchema,
  noteRecentFile,
  recentFileLabel,
} from "./recentFiles";
export type { RecentFile } from "./recentFiles";

export {
  CREATE_CHARACTER_LIMIT,
  CREATE_TOOL_NAME,
  DIFF_LINE_LIMIT,
  DIFF_TOOL_NAME,
  LIST_ENTRY_LIMIT,
  RECURSIVE_LIST_FOLDER_LIMIT,
  RECURSIVE_LIST_LIMIT,
  SKIPPED_WHEN_WALKING,
  isSkippedWhenWalking,
  LIST_TOOL_NAME,
  OPEN_TOOL_NAME,
  SEARCH_LINE_LIMIT,
  SEARCH_MATCH_LIMIT,
  SEARCH_TOOL_NAME,
  actingTools,
  createArguments,
  diffArguments,
  folderTools,
  listArguments,
  openArguments,
  searchArguments,
  searchExpression,
  withinFolder,
} from "./folderTools";
export { toolCallDetail } from "./toolCallDetail";
export { diffLines } from "./lineDiff";
export type { DiffResult } from "./lineDiff";

export {
  IMAGE_TYPE_ID,
  MAX_IMAGE_FILE_BYTES,
  imageMediaType,
  isImageName,
} from "./imageFiles";
export { MAX_ENTRY_NAME_LENGTH, RENAME_PROBLEMS, renameTarget } from "./entryName";
export type { RenameProblem, RenameTarget } from "./entryName";
export { DRAFT_PREFIX, draftPath, isDraftPath, newFileName, newFileTypes, newFolderName } from "./newFile";
export type { NewFileType } from "./newFile";

export { CHAT_COMMANDS, CHAT_TOOLS, parseChatCommand } from "./chatCommands";
export type { ChatCommand, ChatToolSummary } from "./chatCommands";

export { INLINE_ACTIONS, TOOLBAR_ACTIONS, lineSpan, toolbarEdit } from "./markdownToolbar";
export type { TextRange, ToolbarAction, ToolbarEdit } from "./markdownToolbar";

export { READ_FENCE_TAG, readRequestIn } from "./readBlocks";

export { isHidden, sortNodes } from "./workspaceTree";

export {
  DEFAULT_FILE_TYPES,
  FILE_TYPES,
  FILE_TYPE_GROUPS,
  MARKDOWN_FILE_TYPE,
  enabledFileTypes,
  fileTypeFor,
  isOpenable,
  matchesFileType,
} from "./fileTypes";
export type { FileType, FileTypeGroup, FileTypeId, FileTypeKind } from "./fileTypes";
export type { TreeEntry } from "./workspaceTree";

export {
  BINARY_SNIFF_BYTES,
  MAX_TEXT_FILE_BYTES,
  decodeTextFile,
  encodeTextFile,
  formatBytes,
  hasUtf8Bom,
} from "./textFile";
export type { DecodedText, TextRefusal } from "./textFile";

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

export { PANEL_BOUNDS, chatWidthLimit, resolvePanelWidths } from "./panelLayout";
export type { PanelRequest, PanelWidths } from "./panelLayout";

export { qualifyPath, splitQualified, workspaceIdFor } from "./qualifiedPath";

export {
  FIND_FILE_LIMIT,
  FIND_MATCH_LIMIT,
  FIND_MAX_DEPTH,
  FindRequest,
  fileHits,
  findMatches,
  searchScopeFolder,
} from "./find";
export type { FileHit, FindMatch, FindOptions } from "./find";

export {
  FILTER_FOLDER_LIMIT,
  FILTER_MATCH_LIMIT,
  FilterRequest,
  hasWildcards,
  matchesName,
} from "./nameFilter";

export { countWords, detectLineEnding } from "./documentStats";
export type { LineEnding } from "./documentStats";

export { titleBarLayout, windowTitle } from "./windowChrome";
export type { Platform, TitleBarLayout } from "./windowChrome";

export {
  CHAT_EVENT_CHANNEL,
  CancelChatRequest,
  ChatIdRequest,
  SaveChatRequest,
  CHAT_TITLE_LIMIT,
  ChatEventMessage,
  CLOSE_REQUESTED_CHANNEL,
  ChatEventSchema,
  ChatTraceSchema,
  CloseWindowRequest,
  ConfirmDiscardRequest,
  DeleteSecretRequest,
  DiscardChoiceSchema,
  DocumentDirtyRequest,
  IPC_CHANNELS,
  OPEN_TARGET_CHANNEL,
  OpenTargetSchema,
  SetIntegrationRequest,
  ListRequest,
  CreateDirectoryRequest,
  RenameRequest,
  RevealRequest,
  OutlineRequest,
  OpenExternalRequest,
  SendChatRequest,
  ReadImageRequest,
  CloseWorkspaceRequest,
  ReadRequest,
  SaveAsRequest,
  RevisionSchema,
  SetSecretRequest,
  WINDOW_STATE_CHANNEL,
  WriteSettingsRequest,
  WindowStateSchema,
  WriteRequest,
  DocumentDraftSchema,
  OpenInNewWindowRequest,
  TakeDraftResponse,
  OpenWorkspaceRefRequest,
  OpenVaultRequest,
  ConnectGitHubRequest,
  BranchesRequest,
  ListReposRequest,
  RepoInfoRequest,
  RefreshWorkspaceRequest,
  SetBranchRequest,
  GRAPH_CHANGED_CHANNEL,
  GRAPH_PROGRESS_CHANNEL,
  GraphChangedSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  GraphProgressSchema,
  GraphRequest,
  GraphSnapshotSchema,
  GraphStateSchema,
  NewNoteLocationSchema,
} from "./ipc";
export type {
  ChatEvent,
  ChatTrace,
  DiscardChoice,
  DocumentDraft,
  IpcChannel,
  OpenTarget,
  WindowState,
  GraphProgress,
  GraphSnapshot,
  GraphState,
} from "./ipc";

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

export {
  PROVIDER_KINDS,
  GitHubWorkspaceRefSchema,
  LocalWorkspaceRefSchema,
  WorkspaceRefSchema,
  sameWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefMark,
  workspaceRefName,
} from "./workspaceRef";
export type { ProviderKind, WorkspaceMark, WorkspaceRef } from "./workspaceRef";

export { ObsidianVaultIdSchema, obsidianVaultsFrom } from "./obsidianVaults";
export type { ObsidianVault } from "./obsidianVaults";

export {
  API_VERSION,
  GITHUB_API,
  GitHubBlobSchema,
  GitHubBranchSchema,
  GitHubCommitPullsSchema,
  GitHubCommitSchema,
  GitHubRepoDetailSchema,
  GitHubRepoListSchema,
  GitHubBranchListSchema,
  GitHubComparisonSchema,
  GitHubContentMetaSchema,
  GitHubRefListSchema,
  GitHubRefSchema,
  GitHubRepoSchema,
  GitHubTreeSchema,
  GitHubUserSchema,
  GitHubWriteSchema,
  RATE_LIMIT_HEADER,
  USER_AGENT,
  blobEntryFor,
  blobUrl,
  branchCountUrl,
  branchListUrl,
  branchNameFor,
  branchUrl,
  arrivalOf,
  commitCompareUrl,
  commitMessageFor,
  commitPullsUrl,
  commitSummary,
  commitUrl,
  compareUrl,
  contentsUrl,
  countFromLink,
  githubErrorFor,
  githubWriteErrorFor,
  isSafeRef,
  isValidBranchName,
  refsUrl,
  matchRepos,
  ownedRepos,
  repoRefFor,
  repoStats,
  repoUrl,
  reposUrl,
  tagCountUrl,
  treeNodesAt,
  treeUrl,
  userUrl,
} from "./github";
export type {
  GitHubTreeEntry,
  RepoArrival,
  RepoCommit,
  RepoPin,
  RepoDivergence,
  RepoExtras,
  RepoOwner,
  RepoParent,
  RepoStats,
  RepoSummary,
} from "./github";

export {
  REPO_PAGE_PREFIX,
  isRepoPagePath,
  readmeNameIn,
  repoPagePath,
  repoPageWorkspaceId,
} from "./repoPage";

export { applyIndexChange, buildGraph, EMPTY_INDEX, isNotePath, neighbourhood } from "./vaultGraph";
export type { GraphEdge, GraphNode, GraphNodeKind, IndexChange, VaultGraph, VaultIndexInput } from "./vaultGraph";

export { GRAPH_PAGE_PREFIX, graphPagePath, graphPageWorkspaceId, isGraphPagePath } from "./graphPage";
export { newNoteDirectory, newNoteLocationFrom, OBSIDIAN_APP_CONFIG } from "./obsidianAppConfig";
export type { NewNoteLocation } from "./obsidianAppConfig";
