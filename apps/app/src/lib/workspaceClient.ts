import type { Revision } from "@trypthos/domain";

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
export type ReadResult = { ok: true; content: string; revision: Revision } | Failure;
export type WriteResult =
  | { ok: true; revision: Revision }
  | { ok: false; reason: "conflict"; theirs: Revision }
  | Failure;

export interface WorkspaceClient {
  openWorkspace(): Promise<OpenResult>;
  listDirectory(path: string): Promise<ListResult>;
  readFile(path: string): Promise<ReadResult>;
  writeFile(path: string, content: string, expectedRevision: Revision | null): Promise<WriteResult>;
}

interface TrypthosBridge extends WorkspaceClient {
  platform: string;
  isDesktop: true;
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
  openWorkspace: async () => unavailable(),
  listDirectory: async () => unavailable(),
  readFile: async () => unavailable(),
  writeFile: async () => unavailable(),
};

export function workspaceClient(): WorkspaceClient {
  return window.trypthos ?? browserClient;
}
