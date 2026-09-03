import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_CONTEXT,
  resolveChatContext,
  type ChatContext,
  type FolderOutline,
} from "@trypthos/domain";

/// What chat is allowed to see, beyond the document.
///
/// Two things the user chooses, and they answer different questions:
///
///   - **Attachments** are "also look at this one", and are read in full. Explicit because guessing
///     which other files are relevant is how a chat quietly spends somebody's context window, and on
///     a hosted endpoint their money.
///   - **The folder** is a map: paths only, so the model can say "that will be in notes/plan.md" and
///     the user can attach it. Its contents are never sent - a notes folder can be thousands of
///     files, and sending them would bury the document the question was about.
///
/// Both are held here rather than in `useChat`, which owns the conversation. The two meet only when
/// a turn is sent.

export interface ScopeBridge {
  /// The markdown files in the open folder. The walk happens in the shell, where the workspace is.
  workspaceOutline(): Promise<
    { ok: true; outline: FolderOutline } | { ok: false; reason: string }
  >;
  readFile(path: string): Promise<{ ok: true; content: string } | { ok: false; reason: string }>;
}

export interface ScopeSource {
  selection: string;
  file: { path: string; content: string } | null;
}

export function useChatScope(bridge: ScopeBridge | null, source: () => ScopeSource) {
  /// Files the user attached, with their contents at the moment they were attached.
  const [attachments, setAttachments] = useState<{ path: string; content: string }[]>([]);
  const [includeFolder, setIncludeFolder] = useState(false);
  const [outline, setOutline] = useState<FolderOutline | null>(null);
  /// The folder's files, for the attachment picker. Fetched on demand and independently of
  /// `includeFolder`: picking a file to attach is not the same as sending the whole map.
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!includeFolder || bridge === null) return;

    let cancelled = false;
    void bridge.workspaceOutline().then((result) => {
      if (cancelled || !result.ok) return;
      setOutline(result.outline);
    });

    return () => {
      cancelled = true;
    };
  }, [bridge, includeFolder]);

  /// Fetches the folder's files for the picker, if they are not already known.
  ///
  /// Once per panel rather than on every open: the walk is not free, and a folder does not usually
  /// change between one attachment and the next. Reopening Trypthos re-reads it.
  const loadFiles = useCallback(async () => {
    if (bridge === null || files.length > 0) return;

    const result = await bridge.workspaceOutline();
    if (result.ok) setFiles(result.outline.paths);
  }, [bridge, files.length]);

  const attach = useCallback(
    async (path: string) => {
      if (bridge === null) return;

      const result = await bridge.readFile(path);
      if (!result.ok) return;

      // Deduplicated inside the update rather than before the read. Two attaches in quick
      // succession both see the same captured list, so a check outside here lets the second one
      // through - and the file is then sent twice, spending the budget on a duplicate.
      setAttachments((current) =>
        current.some((attachment) => attachment.path === path)
          ? current
          : [...current, { path, content: result.content }],
      );
    },
    [bridge],
  );

  const detach = useCallback((path: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.path !== path));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setIncludeFolder(false);
  }, []);

  /// Built when a turn is sent, so it sees the selection and the buffer as they are then.
  const context = useCallback((): ChatContext => {
    const { selection, file } = source();
    if (bridge === null) return EMPTY_CONTEXT;

    return resolveChatContext({
      selection,
      file,
      attachments,
      folder: includeFolder ? outline : null,
    });
  }, [attachments, bridge, includeFolder, outline, source]);

  const paths = useMemo(() => attachments.map((attachment) => attachment.path), [attachments]);

  return {
    attachments: paths,
    files,
    loadFiles,
    includeFolder,
    setIncludeFolder,
    attach,
    detach,
    clear,
    context,
  };
}
