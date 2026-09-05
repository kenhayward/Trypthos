import type { Revision, Settings } from "@trypthos/domain";
import type { ChatBridge } from "../hooks/useChat";
import type { ChatHistoryBridge } from "../hooks/useChatHistory";
import type { KeyBridge } from "../hooks/useApiKeys";
import type { SettingsBridge } from "../hooks/useSettings";

/// The renderer's view of the shell.
///
/// Thin on purpose: transport only, no policy. Everything this calls is enumerated in the preload
/// bridge, and the renderer cannot name a workspace root - it can only ask the user to choose one.

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface RemoteNode {
  id: string;
  name: string;
  kind: "file" | "directory";
}

export type Failure = { ok: false; reason: string };

export type OpenResult = { ok: true; workspace: WorkspaceInfo } | Failure;
export type ListResult = { ok: true; nodes: RemoteNode[] } | Failure;
export type ReadResult =
  | { ok: true; content: string; revision: Revision }
  /// Carries its numbers, so the refusal can name the file's size and the app's limit. Mirrors the
  /// domain's `ReadResult` - the shell returns that shape and this is where the renderer sees it.
  | { ok: false; reason: "too-large"; sizeBytes: number; limitBytes: number }
  | Failure;
export type WriteResult =
  | { ok: true; revision: Revision }
  | { ok: false; reason: "conflict"; theirs: Revision }
  | Failure;

export interface WorkspaceClient {
  /// The files in ONE folder of the workspace, for chat to use as a map. Paths only.
  ///
  /// The folder is the one selected in the tree, "" being the root. Validated in the main process
  /// like every other path the renderer names.
  workspaceOutline(
    path: string,
  ): Promise<{ ok: true; outline: { path: string; paths: string[]; truncated: boolean } } | Failure>;
  openWorkspace(): Promise<OpenResult>;
  /// Reopens a remembered folder without asking. The shell still checks it exists and is a
  /// directory - a stored path can have been deleted, renamed or moved to another machine.
  reopenWorkspace(root: string): Promise<OpenResult>;
  listDirectory(path: string): Promise<ListResult>;
  readFile(path: string): Promise<ReadResult>;
  writeFile(path: string, content: string, expectedRevision: Revision | null): Promise<WriteResult>;
}

interface TrypthosBridge extends WorkspaceClient, KeyBridge, ChatBridge, ChatHistoryBridge {
  platform: string;
  isDesktop: true;
  explorerIntegration(): Promise<IntegrationStatus>;
  setExplorerIntegration(enabled: boolean): Promise<IntegrationStatus>;
  readSettings(): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }>;
  writeSettings(settings: Settings): Promise<unknown>;
}

/// Trypthos's entries in File Explorer's right-click menu.
///
/// Two calls and no state: the registry is the record, and the renderer asks rather than remembering
/// - a user can take the keys away by hand, which no stored copy of the answer would know about.
export interface IntegrationStatus {
  ok: boolean;
  /// Whether the entries can exist at all: a packaged Windows build, and nothing else.
  supported: boolean;
  registered: boolean;
}

export interface IntegrationBridge {
  status(): Promise<IntegrationStatus>;
  set(enabled: boolean): Promise<IntegrationStatus>;
}

/// The Explorer half of the bridge, or null outside the desktop shell.
///
/// Null rather than a stub: a browser tab has no registry to write to, and a switch that reported
/// success would be one that claims to have changed something on a machine it cannot reach.
export function integrationBridge(): IntegrationBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.explorerIntegration) return null;
  return {
    status: bridge.explorerIntegration,
    set: bridge.setExplorerIntegration,
  };
}

/// The settings half of the bridge, or null outside the desktop shell.
///
/// Null rather than a stub, so the hook can tell "no shell, never write" from "write failed" - the
/// browser preview should keep defaults, not silently pretend to save them.
export function settingsBridge(): SettingsBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.readSettings) return null;
  return { readSettings: bridge.readSettings, writeSettings: bridge.writeSettings };
}

/// The chat half of the bridge, or null outside the desktop shell.
///
/// Null rather than a stub: the browser preview has no main process to make the provider call, and a
/// stub would give the panel a send button that silently does nothing.
export function chatBridge(): ChatBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.sendChat) return null;
  return {
    sendChat: bridge.sendChat,
    cancelChat: bridge.cancelChat,
    onChatEvent: bridge.onChatEvent,
  };
}

/// The saved-conversations half of the bridge, or null outside the desktop shell.
///
/// Null rather than a stub: the browser preview has nowhere to save to, and a Save button that
/// silently discarded a conversation would be worse than one that is absent.
export function chatHistoryBridge(): ChatHistoryBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.listChats) return null;
  return {
    listChats: bridge.listChats,
    loadChat: bridge.loadChat,
    saveChat: bridge.saveChat,
    deleteChat: bridge.deleteChat,
  };
}

/// The API key half of the bridge, or null outside the desktop shell.
///
/// Null rather than a stub for the same reason as settings: the browser preview has nowhere to store
/// a key, and a stub that reported success would show "Key stored" against a key that went nowhere.
export function keyBridge(): KeyBridge | null {
  const bridge = window.trypthos;
  if (!bridge?.listKeyedEndpoints) return null;
  return {
    listKeyedEndpoints: bridge.listKeyedEndpoints,
    setApiKey: bridge.setApiKey,
    deleteApiKey: bridge.deleteApiKey,
  };
}

declare global {
  interface Window {
    trypthos?: TrypthosBridge;
  }
}

/// True only inside the desktop shell.
///
/// The app is also served by the Vite dev server in an ordinary browser tab, where there is no
/// filesystem and no bridge. That is a supported way to work on the UI, so the absence has to be a
/// state the interface can show rather than a crash - and a stub that pretended to work would be
/// worse than either.
export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.trypthos?.isDesktop === true;
}

const unavailable = (): Failure => ({ ok: false, reason: "not-desktop" });

export const browserClient: WorkspaceClient = {
  workspaceOutline: async () => unavailable(),
  openWorkspace: async () => unavailable(),
  reopenWorkspace: async () => unavailable(),
  listDirectory: async () => unavailable(),
  readFile: async () => unavailable(),
  writeFile: async () => unavailable(),
};

export function workspaceClient(): WorkspaceClient {
  return window.trypthos ?? browserClient;
}
